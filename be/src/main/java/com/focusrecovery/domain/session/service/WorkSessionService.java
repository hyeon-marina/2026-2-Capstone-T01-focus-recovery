package com.focusrecovery.domain.session.service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.focusrecovery.domain.analysis.service.AnalysisRequestService;
import com.focusrecovery.domain.session.dto.EndWorkSessionRequest;
import com.focusrecovery.domain.session.dto.WorkSessionResponse;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.entity.WorkSessionStatus;
import com.focusrecovery.domain.session.exception.IdempotencyKeyMismatchException;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.service.PageVisitService;
import com.focusrecovery.global.config.V2StorageGate;



@Service
public class WorkSessionService {

	private final WorkSessionRepository workSessionRepository;
	private final V2StorageGate v2Gate;
	private final PageVisitService pageVisitService;
	private final AnalysisRequestService analysisRequestService;
	private final com.focusrecovery.domain.alert.service.V2AlertService v2Alerts;

	public WorkSessionService(WorkSessionRepository workSessionRepository, PageVisitService pageVisitService,
		AnalysisRequestService analysisRequestService, V2StorageGate v2Gate, com.focusrecovery.domain.alert.service.V2AlertService v2Alerts) {
		this.v2Alerts = v2Alerts; this.v2Gate = v2Gate;
		this.workSessionRepository = workSessionRepository;
		this.pageVisitService = pageVisitService;
		this.analysisRequestService = analysisRequestService;
	}

	// 트랜잭션을 걸지 않는다: 동시 요청으로 유니크 제약이 위반되면 저장 트랜잭션이 끝난 뒤 다시 조회해야 한다
	public WorkSessionResponse create(String goalText, String idempotencyKey) {
		return create(goalText, idempotencyKey, null);
	}

	public WorkSessionResponse create(String goalText, String idempotencyKey, String requestedVersion) {
		String version = v2Gate.version(requestedVersion);
		String strippedGoal = goalText.strip();
		// 키의 버전 충돌은 기능 비활성화 상태에서도 기존 충돌로 보고한다.
		if (idempotencyKey != null) {
			var existing = workSessionRepository.findByIdempotencyKey(idempotencyKey);
			if (existing.isPresent()) return replay(existing.get(), strippedGoal, version);
		}
		if ("2.0".equals(version)) v2Gate.requireEnabled();
		if (idempotencyKey == null) {
			return WorkSessionResponse.from(workSessionRepository.save(WorkSession.start(strippedGoal, null, version)));
		}
		try {
			return WorkSessionResponse.from(workSessionRepository.saveAndFlush(WorkSession.start(strippedGoal, idempotencyKey, version)));
		} catch (DataIntegrityViolationException e) {
			WorkSession existing = workSessionRepository.findByIdempotencyKey(idempotencyKey).orElseThrow(() -> e);
			return replay(existing, strippedGoal, version);
		}
	}

	private WorkSessionResponse replay(WorkSession existing, String goalText, String version) {
		if (!existing.getGoalText().equals(goalText) || !existing.getCollectionSpecVersion().equals(version)) {
			throw new IdempotencyKeyMismatchException();
		}
		v2Gate.checkAccess(existing);
		return WorkSessionResponse.from(existing);
	}

	// 세션 행을 배타 잠금으로 조회하므로 방문 저장·갱신(공유 잠금)과 동시 종료 요청이 모두 직렬화된다
	// 이미 종료된 세션은 재시도로 보고 finalBehaviors를 반영하지 않은 채 기존 결과를 돌려준다
	@Transactional
	public WorkSessionResponse end(UUID sessionId, List<EndWorkSessionRequest.FinalBehavior> finalBehaviors) {
		WorkSession session = workSessionRepository.findForUpdateBySessionId(sessionId)
			.orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		if (session.getStatus() == WorkSessionStatus.ENDED) {
			return WorkSessionResponse.from(session);
		}
		Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		if (finalBehaviors != null) {
			pageVisitService.applyFinalBehaviors(sessionId, finalBehaviors, now);
		}
		session.end(now);
		if (session.isV2()) v2Alerts.invalidateSessionPending(sessionId, now);
		// 세션 종료로 모든 방문의 행동 정보가 확정되므로 아직 분석을 요청하지 않은 구간을 요청한다(수집 명세 8항)
		if (!session.isV2()) analysisRequestService.requestAllWindows(sessionId, now);
		return WorkSessionResponse.from(session);
	}

	@Transactional(readOnly = true)
	public WorkSessionResponse get(UUID sessionId) {
		return workSessionRepository.findById(sessionId)
			.map(session -> { v2Gate.checkAccess(session); return WorkSessionResponse.from(session); })
			.orElseThrow(SessionNotFoundException::new);
	}
}
