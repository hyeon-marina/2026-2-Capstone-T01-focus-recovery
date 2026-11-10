package com.focusrecovery.domain.visit.service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.focusrecovery.domain.analysis.service.AnalysisRequestService;
import com.focusrecovery.domain.privacy.repository.VisitTombstoneRepository;
import com.focusrecovery.domain.session.dto.EndWorkSessionRequest;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.entity.WorkSessionStatus;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;
import com.focusrecovery.domain.visit.dto.PageVisitPageResponse;
import com.focusrecovery.domain.visit.dto.PageVisitResponse;
import com.focusrecovery.domain.visit.dto.UpdateVisitBehaviorRequest;
import com.focusrecovery.domain.visit.dto.VisitBehaviorResponse;
import com.focusrecovery.domain.visit.dto.VisitJsonCapture;
import com.focusrecovery.domain.visit.entity.PageVisit;
import com.focusrecovery.domain.visit.exception.VisitNotFoundException;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.service.AnalysisWindowService;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.exception.InvalidRequestException;

import jakarta.validation.Validator;

import tools.jackson.databind.json.JsonMapper;



@Service
public class PageVisitService {

	private final WorkSessionRepository workSessionRepository;
	private final PageVisitRepository pageVisitRepository;
	private final TransactionTemplate transactionTemplate;
	private final AnalysisWindowService analysisWindowService;
	private final AnalysisRequestService analysisRequestService;
	private final V2StorageGate v2Gate;
	private final VisitTombstoneRepository tombstones;
	private final JsonMapper jsonMapper;
	private final Validator validator;
	private final com.focusrecovery.domain.window.service.WindowDecisionService decisions;

	public PageVisitService(WorkSessionRepository workSessionRepository, PageVisitRepository pageVisitRepository,
		TransactionTemplate transactionTemplate, AnalysisWindowService analysisWindowService,
		AnalysisRequestService analysisRequestService, V2StorageGate v2Gate,
		VisitTombstoneRepository tombstones, JsonMapper jsonMapper, Validator validator, com.focusrecovery.domain.window.service.WindowDecisionService decisions) {
		this.decisions = decisions; this.jsonMapper = jsonMapper; this.validator = validator;
		this.v2Gate = v2Gate; this.tombstones = tombstones;
		this.workSessionRepository = workSessionRepository;
		this.pageVisitRepository = pageVisitRepository;
		this.transactionTemplate = transactionTemplate;
		this.analysisWindowService = analysisWindowService;
		this.analysisRequestService = analysisRequestService;
	}

	public record SaveResult(PageVisitResponse visit, boolean created) {
	}

	// 동시 저장으로 PK·UNIQUE 제약이 위반되면 그 트랜잭션은 롤백되므로, 새 트랜잭션에서 먼저 저장된 방문을 기준으로 다시 판단한다
	public SaveResult save(UUID sessionId, CreatePageVisitRequest request) {
		if (request == null || !validator.validate(request).isEmpty())
			throw new InvalidRequestException("방문 요청이 유효하지 않습니다.");
		PageVisit candidate = request.toEntity(sessionId);
		try {
			return transactionTemplate.execute(status -> saveOrReplay(candidate, request));
		} catch (DataIntegrityViolationException e) {
			return transactionTemplate.execute(status -> {
				WorkSession session = workSessionRepository.findForUpdateBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
				v2Gate.checkAccess(session);
				if (session.isV2() && tombstones.existsById(candidate.getVisitId())) throw privacyRetracted();
				return replayOrConflict(candidate).orElseThrow(() -> e);
			});
		}
	}

	// 구간 생성을 세션 단위로 직렬화하려고 처음부터 세션 쓰기 잠금을 잡는다(종료와 같은 세션→방문 순서, 공유→쓰기 전환 없음)
	private SaveResult saveOrReplay(PageVisit candidate, CreatePageVisitRequest request) {
		WorkSession session = workSessionRepository.findForUpdateBySessionId(candidate.getSessionId())
			.orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		if (session.isV2()) {
			if (tombstones.existsById(candidate.getVisitId())) throw privacyRetracted();
			VisitJsonCapture.validateV2(jsonMapper);
			request.validateV2();
		} else if (request.extractionStatus() != null) {
			throw new ConflictException("COLLECTION_VERSION_MISMATCH", "v2 방문을 v1 세션에 저장할 수 없습니다.");
		}
		Optional<SaveResult> replay = replayOrConflict(candidate);
		if (replay.isPresent()) {
			return replay.get();
		}
		if (session.getStatus() == WorkSessionStatus.ENDED) {
			throw sessionEnded();
		}
		if (session.isV2()) {
			if (candidate.getSequence() <= session.getLastAcceptedSequence())
				throw new ConflictException("VISIT_SEQUENCE_OUT_OF_ORDER", "마지막 수락 순서보다 큰 새 방문만 저장할 수 있습니다.");
			session.acceptSequence(candidate.getSequence());
		} else analysisWindowService.checkOrder(candidate.getSessionId(), candidate.getSequence());
		pageVisitRepository.saveAndFlush(candidate);
		Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		if (!session.isV2()) {
			analysisWindowService.createWindows(candidate.getSessionId(), now);
			analysisRequestService.requestReadyWindows(candidate.getSessionId(), now);
		}
		return new SaveResult(PageVisitResponse.from(candidate), true);
	}

	private Optional<SaveResult> replayOrConflict(PageVisit candidate) {
		Optional<PageVisit> existing = pageVisitRepository.findById(candidate.getVisitId());
		if (existing.isPresent()) {
			if (!existing.get().hasSameOriginal(candidate)) {
				throw new ConflictException("VISIT_ID_CONFLICT", "같은 방문 ID로 다른 방문 정보가 전달되었습니다.");
			}
			return Optional.of(new SaveResult(PageVisitResponse.from(existing.get()), false));
		}
		if (pageVisitRepository.existsBySessionIdAndSequence(candidate.getSessionId(), candidate.getSequence())) {
			throw new ConflictException("VISIT_SEQUENCE_CONFLICT", "같은 세션의 방문 순서가 이미 다른 방문에 사용되었습니다.");
		}
		return Optional.empty();
	}

	// 방문 행을 FOR UPDATE로 잠근 뒤 버전을 비교하므로 동시 요청에서도 낮은 버전이 높은 버전을 덮어쓰지 않는다
	@Transactional
	public VisitBehaviorResponse updateBehavior(UUID sessionId, UUID visitId, UpdateVisitBehaviorRequest request) {
		WorkSession session = workSessionRepository.findForShareBySessionId(sessionId)
			.orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		if (session.isV2()) {
			if (tombstones.existsById(visitId)) throw privacyRetracted();
			if (request == null || !validator.validate(request).isEmpty())
				throw new InvalidRequestException("v2 행동 요청이 유효하지 않습니다.");
			validateV2Behavior(request.activeDurationMs(), request.behaviorVersion());
		}
		PageVisit visit = pageVisitRepository.findForUpdateByVisitIdAndSessionId(visitId, sessionId)
			.orElseThrow(VisitNotFoundException::new);
		if (session.getStatus() == WorkSessionStatus.ENDED) {
			throw sessionEnded();
		}

		Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		boolean applied = applyBehavior(visit, request.activeDurationMs(), request.tabSwitchCount(),
			request.behaviorVersion(), now);
		if (applied && session.isV2()) decisions.markVisitDirty(sessionId, visitId);
		if (applied && !session.isV2()) {
			analysisRequestService.requestWindowsEndingAt(sessionId, visitId, now);
		}
		return VisitBehaviorResponse.of(visit, applied);
	}

	// 세션 종료 트랜잭션 안에서만 호출한다: 하나라도 실패하면 예외로 행동 정보와 종료가 함께 롤백된다
	@Transactional(propagation = Propagation.MANDATORY)
	public void applyFinalBehaviors(UUID sessionId, List<EndWorkSessionRequest.FinalBehavior> behaviors, Instant now) {
		WorkSession session = workSessionRepository.findById(sessionId).orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		for (EndWorkSessionRequest.FinalBehavior behavior : behaviors) {
			if (session.isV2()) validateV2Behavior(behavior.activeDurationMs(), behavior.behaviorVersion());
			PageVisit visit = pageVisitRepository.findForUpdateByVisitIdAndSessionId(UUID.fromString(behavior.visitId()), sessionId)
				.orElseThrow(VisitNotFoundException::new);
			boolean applied = applyBehavior(visit, behavior.activeDurationMs(), behavior.tabSwitchCount(), behavior.behaviorVersion(), now);
			if (applied && session.isV2()) decisions.markVisitDirty(sessionId, visit.getVisitId());
		}
	}

	private boolean applyBehavior(PageVisit visit, long duration, int tabSwitches, long version, Instant now) {
		if (version < visit.getBehaviorVersion()) {
			return false;
		}
		if (version == visit.getBehaviorVersion()) {
			if (duration == visit.getActiveDurationMs() && tabSwitches == visit.getTabSwitchCount()) {
				return false;
			}
			throw new ConflictException("BEHAVIOR_VERSION_CONFLICT", "같은 행동 갱신 버전에 다른 값이 전달되었습니다.");
		}
		if (duration < visit.getActiveDurationMs() || tabSwitches < visit.getTabSwitchCount()) {
			throw new ConflictException("BEHAVIOR_COUNTER_DECREASED", "더 높은 버전에서 누적값이 감소했습니다.");
		}
		visit.updateBehavior(duration, tabSwitches, version, now);
		return true;
	}

	@Transactional(readOnly = true)
	public PageVisitPageResponse list(UUID sessionId, int page, int size) {
		v2Gate.checkAccess(workSessionRepository.findById(sessionId).orElseThrow(SessionNotFoundException::new));
		return PageVisitPageResponse.from(
			pageVisitRepository.findSummariesBySessionId(sessionId, PageRequest.of(page, size)));
	}

	private static void validateV2Behavior(long duration, long version) {
		if (duration < 5000 || duration > 9007199254740991L || version < 0 || version > 9007199254740991L)
			throw new InvalidRequestException("v2 행동 요청이 유효하지 않습니다.");
	}
	private static ConflictException privacyRetracted() { return new ConflictException("PRIVACY_RETRACTED", "개인정보 격리 대상입니다."); }

	private static ConflictException sessionEnded() {
		return new ConflictException("SESSION_ENDED", "종료된 작업 세션입니다.");
	}
}
