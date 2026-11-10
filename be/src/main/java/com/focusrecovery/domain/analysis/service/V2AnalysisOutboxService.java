package com.focusrecovery.domain.analysis.service;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.focusrecovery.domain.analysis.client.AiAnalysisOutcome;
import com.focusrecovery.domain.analysis.dto.V2AnalysisCompletion;
import com.focusrecovery.domain.analysis.entity.AnalysisOutbox;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisOutboxRepository;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.util.CanonicalJson;
import tools.jackson.databind.json.JsonMapper;

@Service
public class V2AnalysisOutboxService {
	private final WorkSessionRepository sessions;
	private final AnalysisOutboxRepository tasks;
	private final AnalysisResultRepository analyses;
	private final AnalysisWindowRepository windows;
	private final V2StorageGate gate;
	private final CanonicalJson json;
	private final JsonMapper mapper;
	private final Clock clock;
	private final V2DispatchProperties dispatch;
	public V2AnalysisOutboxService(WorkSessionRepository sessions, AnalysisOutboxRepository tasks,
		AnalysisResultRepository analyses, AnalysisWindowRepository windows, V2StorageGate gate, CanonicalJson json,
		JsonMapper mapper, Clock clock, V2DispatchProperties dispatch) {
		this.dispatch = dispatch; this.sessions = sessions; this.tasks = tasks; this.analyses = analyses; this.windows = windows;
		this.gate = gate; this.json = json; this.mapper = mapper; this.clock = clock;
	}
	public record Claim(UUID analysisId, UUID token, String inputSnapshot) {}

	// Durable discovery; analysis failures are terminal, with no automatic AI retry.
	@Transactional(readOnly = true)
	public List<UUID> pending() {
		gate.requireEnabled();
		return tasks.findByProcessingStatusOrderByRequestedAt("PENDING", PageRequest.of(0, 100)).stream()
			.map(AnalysisOutbox::getAnalysisId).toList();
	}
	@Transactional
	public Claim claim(UUID sessionId, UUID analysisId) {
		WorkSession session = session(sessionId); AnalysisOutbox task = task(sessionId, analysisId);
        requireActive(session);
		if (!task.getProcessingStatus().equals("PENDING")) return null;
		AnalysisResult analysis = analysis(analysisId); valid(session, task, analysis);
		if (analysis.getProcessingStatus() != AnalysisStatus.PENDING) return null;
		UUID token = task.claim(now(), dispatch.lease()); analysis.start(now());
		return new Claim(analysisId, token, analysis.getInputSnapshot());
	}
	@Transactional
	public void complete(UUID sessionId, UUID analysisId, UUID token, V2AnalysisCompletion result) {
		WorkSession session = session(sessionId); AnalysisOutbox task = task(sessionId, analysisId);
		AnalysisResult analysis = analysis(analysisId); valid(session, task, analysis);
		if (task.getProcessingStatus().equals("COMPLETED")) {
			if (!json.write(result).equals(json.write(mapper.readValue(analysis.getResponseSnapshot(), V2AnalysisCompletion.class))))
				throw conflict("ANALYSIS_ID_CONFLICT");
			return;
		}
		requireActive(session);
        owned(task, token);
		var window = windows.findById(analysis.getWindowId()).orElseThrow();
		if (result == null || result.apiContractVersion() != 2 || !analysisId.equals(result.analysisId())
			|| !sessionId.equals(result.sessionId()) || !window.getWindowId().equals(result.windowId())
			|| !analysis.getInputFingerprint().equals(result.inputFingerprint()) || result.pageResults() == null
			|| result.pageResults().size() != 3 || result.analyzedAt() == null
			|| !result.analyzedAt().equals(result.analyzedAt().truncatedTo(ChronoUnit.MILLIS))
			|| result.modelVersions() == null || !result.modelVersions().keySet().equals(Set.of("embedding", "context", "prompt", "labelGuide"))
			|| result.modelVersions().values().stream().anyMatch(v -> v == null || v.isBlank() || v.codePointCount(0, v.length()) > 200))
			throw conflict("AI_INVALID_RESPONSE");
		for (int i = 0; i < 3; i++) {
			var page = result.pageResults().get(i);
			if (page == null || page.position() != i + 1 || !window.getVisitIds().get(i).equals(page.visitId())
				|| page.label() == null || !Set.of("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED").contains(page.label())
				|| !Double.isFinite(page.semanticRelevance()) || page.semanticRelevance() < -1 || page.semanticRelevance() > 1
				|| page.rationale() == null || page.rationale().isBlank() || page.rationale().codePointCount(0, page.rationale().length()) > 500)
				throw conflict("AI_INVALID_RESPONSE");
		}
		analysis.completeV2(json.write(result.pageResults()), json.write(result.modelVersions()), json.write(result), result.analyzedAt(), now());
		window.markDecisionDirty();
		task.terminal("COMPLETED", null, now());
	}
	@Transactional
	public void fail(UUID sessionId, UUID analysisId, UUID token) {
		fail(sessionId, analysisId, token, "AI_ANALYSIS_FAILED");
	}
	@Transactional
	public void fail(UUID sessionId, UUID analysisId, UUID token, String code) {
		WorkSession session = session(sessionId); AnalysisOutbox task = task(sessionId, analysisId);
		AnalysisResult analysis = analysis(analysisId); valid(session, task, analysis); owned(task, token);
		analysis.finish(AiAnalysisOutcome.failed(code), now());
		task.terminal("FAILED", code, now());
	}
	// 중단된 RUNNING은 FAILED로 확정한다. AI를 다시 호출하지 않는다.
	@Transactional
	public void recover(UUID sessionId, UUID analysisId) {
		session(sessionId); AnalysisOutbox task = task(sessionId, analysisId);
		if (task.getProcessingStatus().equals("RUNNING") && !task.getLeaseUntil().isAfter(now())) {
			AnalysisResult analysis = analysis(analysisId);
			if (analysis.getProcessingStatus() == AnalysisStatus.RUNNING)
				analysis.finish(AiAnalysisOutcome.failed("ANALYSIS_INTERRUPTED"), now());
			task.terminal("FAILED", "ANALYSIS_INTERRUPTED", now());
		}
	}
    private void requireActive(WorkSession session) {
        if (session.getStatus() != com.focusrecovery.domain.session.entity.WorkSessionStatus.ACTIVE) throw conflict("SESSION_ENDED");
    }
	private WorkSession session(UUID id) {
		gate.requireEnabled(); WorkSession session = sessions.findForUpdateBySessionId(id).orElseThrow(SessionNotFoundException::new);
		gate.requireV2(session); gate.checkPrivacy(session); return session;
	}
	private AnalysisOutbox task(UUID sessionId, UUID id) {
		return tasks.findById(id).filter(t -> t.getSessionId().equals(sessionId)).orElseThrow(() -> conflict("ANALYSIS_ID_CONFLICT"));
	}
	private AnalysisResult analysis(UUID id) { return analyses.findForUpdateByAnalysisId(id).orElseThrow(); }
	private void valid(WorkSession session, AnalysisOutbox task, AnalysisResult analysis) {
		var window = windows.findById(analysis.getWindowId()).orElseThrow();
		if (analysis.getApiContractVersion() != 2 || !window.getSessionId().equals(session.getSessionId())
			|| window.isInvalidated() || task.getPrivacyRevision() != session.getPrivacyRevision()) throw conflict("PRIVACY_RETRACTED");
	}
	private void owned(AnalysisOutbox task, UUID token) {
		if (!task.getProcessingStatus().equals("RUNNING") || token == null || !token.equals(task.getClaimToken())
			|| !task.getLeaseUntil().isAfter(now())) throw conflict("ANALYSIS_CLAIM_LOST");
	}
	private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MILLIS); }
	private static ConflictException conflict(String code) { return new ConflictException(code, "분석 작업을 적용할 수 없습니다."); }
}
