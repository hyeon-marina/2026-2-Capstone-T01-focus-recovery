package com.focusrecovery.domain.privacy.service;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.focusrecovery.domain.privacy.dto.Retraction;
import com.focusrecovery.domain.privacy.entity.*;
import com.focusrecovery.domain.privacy.repository.*;
import com.focusrecovery.domain.composition.repository.ComposeRequestRepository;
import com.focusrecovery.domain.analysis.repository.AnalysisOutboxRepository;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.exception.VisitNotFoundException;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.exception.InvalidRequestException;
import com.focusrecovery.global.util.CanonicalJson;

// 외부 Controller 없음. 인증·소유권/END_PENDING/삭제 정책 승인 전 내부 합성 테스트만 허용한다.
@Service
public class PrivacyRetractionService {
	private final WorkSessionRepository sessions;
	private final PageVisitRepository visits;
	private final AnalysisWindowRepository windows;
	private final AnalysisResultRepository analyses;
	private final AnalysisOutboxRepository outbox;
	private final ComposeRequestRepository compose;
	private final PrivacyRetractionRepository retractions;
	private final VisitTombstoneRepository tombstones;
	private final RetractionTargetRepository targets;
	private final V2StorageGate gate;
	private final CanonicalJson json;
	private final Clock clock;
	public PrivacyRetractionService(WorkSessionRepository sessions, PageVisitRepository visits,
		AnalysisWindowRepository windows, AnalysisResultRepository analyses, AnalysisOutboxRepository outbox,
		ComposeRequestRepository compose, PrivacyRetractionRepository retractions, VisitTombstoneRepository tombstones,
		RetractionTargetRepository targets, V2StorageGate gate, CanonicalJson json, Clock clock) {
		this.sessions = sessions; this.visits = visits; this.windows = windows; this.analyses = analyses;
		this.outbox = outbox; this.compose = compose; this.retractions = retractions; this.tombstones = tombstones;
		this.targets = targets; this.gate = gate; this.json = json; this.clock = clock;
	}
	@Transactional
	public Retraction.Receipt quarantine(UUID sessionId, Retraction.Request request) {
		gate.requireEnabled();
		var session = sessions.findForUpdateBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		gate.requireV2(session);
		if (request == null || request.retractionId() == null || request.retractionId().version() != 4
			|| request.visitId() == null || request.visitId().version() != 4 || request.observedAt() == null
			|| !request.observedAt().equals(request.observedAt().truncatedTo(ChronoUnit.MILLIS))
			|| request.reasonCode() == null || !Set.of("SENSITIVE_CONTENT", "CONSENT_WITHDRAWN").contains(request.reasonCode()))
			throw new InvalidRequestException("회수 작업 입력이 유효하지 않습니다.");
		String fingerprint = json.fingerprint(Map.of("sessionId", sessionId, "request", request));
		var existing = retractions.findById(request.retractionId());
		if (existing.isPresent()) {
			if (!existing.get().getSessionId().equals(sessionId) || !existing.get().getInputFingerprint().equals(fingerprint))
				throw new ConflictException("RETRACTION_ID_CONFLICT", "같은 회수 ID로 다른 요청이 전달되었습니다.");
			return receipt(existing.get());
		}
		visits.findById(request.visitId()).ifPresent(visit -> {
			if (!visit.getSessionId().equals(sessionId)) throw new VisitNotFoundException();
		});
		tombstones.findById(request.visitId()).ifPresent(t -> {
			if (!t.getSessionId().equals(sessionId)) throw new VisitNotFoundException();
		});
		var now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
		var job = retractions.saveAndFlush(PrivacyRetraction.quarantined(request.retractionId(), sessionId, request.visitId(),
			request.reasonCode(), request.observedAt(), fingerprint, now));
		if (!tombstones.existsById(request.visitId())) {
			tombstones.saveAndFlush(new VisitTombstone(request.visitId(), sessionId, request.retractionId(), now));
			session.quarantine();
		}
		target(job, "PAGE_VISIT", request.visitId().toString());
		// 전체 세션의 분석을 격리한다. 직접 영향 Window는 별도 대상 목록으로 식별한다.
		for (var window : windows.findBySessionIdOrderByWindowIndex(sessionId)) {
			window.invalidate();
			if (window.getVisitIds().contains(request.visitId())) target(job, "WINDOW", window.getWindowId().toString());
			analyses.findByWindowId(window.getWindowId()).ifPresent(analysis -> {
				analysis.invalidate(now);
				target(job, "ANALYSIS_PAYLOAD", analysis.getAnalysisId().toString());
				target(job, "WINDOW_STATE_HISTORY", window.getWindowId().toString());
				target(job, "NOTIFICATION_AND_RESPONSE", analysis.getAnalysisId().toString());
				target(job, "ALERT_TASK", analysis.getAnalysisId().toString());
			});
		}
		for (var task : outbox.findBySessionId(sessionId)) {
			task.terminal("INVALIDATED", "PRIVACY_RETRACTED", now); target(job, "ANALYSIS_OUTBOX", task.getAnalysisId().toString());
		}
		for (var task : compose.findBySessionId(sessionId)) {
			task.terminal("INVALIDATED", "PRIVACY_RETRACTED", now); target(job, "COMPOSE_SNAPSHOT_RECEIPT", task.getComposeRequestId().toString());
		}
		// 수신자/외부 저장소 증거가 미확보다. 삭제 완료로 집계할 수 없는 명시적 선결 항목이다.
		for (String type : List.of("CLIENT_LOCAL_COPIES", "AI_CACHE_AND_MEMORY", "LOG_COPIES", "EXPORT_COPIES", "TRAINED_ARTIFACTS", "BACKUPS", "SESSION_PAYLOAD"))
			target(job, type, sessionId.toString());
		targets.flush();
		return receipt(job);
	}
	@Transactional
	public void recordFailure(UUID sessionId, RetractionTargetId id, String code) {
		gate.requireEnabled();
		var session = sessions.findForUpdateBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		gate.requireV2(session);
		var job = retractions.findById(id.retractionId()).filter(j -> j.getSessionId().equals(sessionId)).orElseThrow();
		if (!Set.of("DELETE_NOT_IMPLEMENTED", "EXTERNAL_EVIDENCE_MISSING").contains(code))
			throw new InvalidRequestException("지원하지 않는 회수 오류 코드입니다.");
		targets.findById(id).orElseThrow().recordFailure(code); job.recordFailure(code);
	}
	private void target(PrivacyRetraction job, String type, String id) {
		targets.save(new RetractionTarget(new RetractionTargetId(job.getRetractionId(), type, id)));
	}
	private Retraction.Receipt receipt(PrivacyRetraction job) {
		return new Retraction.Receipt(job.getRetractionId(), job.getVisitId(), job.getProcessingStatus(),
			targets.findByIdRetractionId(job.getRetractionId()).stream().filter(t -> t.getId().targetType().equals("WINDOW"))
				.map(t -> UUID.fromString(t.getId().targetId())).sorted().toList());
	}
}
