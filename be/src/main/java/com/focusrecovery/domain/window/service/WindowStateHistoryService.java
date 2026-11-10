package com.focusrecovery.domain.window.service;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.dto.SaveWindowState;
import com.focusrecovery.domain.window.entity.WindowStateHistory;
import com.focusrecovery.domain.window.entity.WindowStateId;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.domain.window.repository.WindowStateHistoryRepository;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.exception.InvalidRequestException;
import com.focusrecovery.global.util.CanonicalJson;

@Service
public class WindowStateHistoryService {
	private final WorkSessionRepository sessions;
	private final AnalysisWindowRepository windows;
	private final AnalysisResultRepository analyses;
	private final PageVisitRepository visits;
	private final WindowStateHistoryRepository history;
	private final V2StorageGate gate;
	private final CanonicalJson json;
	private final Clock clock;
	public WindowStateHistoryService(WorkSessionRepository sessions, AnalysisWindowRepository windows,
		AnalysisResultRepository analyses, PageVisitRepository visits, WindowStateHistoryRepository history,
		V2StorageGate gate, CanonicalJson json, Clock clock) {
		this.sessions = sessions; this.windows = windows; this.analyses = analyses; this.visits = visits;
		this.history = history; this.gate = gate; this.json = json; this.clock = clock;
	}
	public record Saved(WindowStateHistory state, boolean created) {}

	// 계산은 호출자가 수행한다. session 쓰기잠금이 PATCH 공유잠금과 직렬화되어 snapshot 검증부터 버전 발급까지 보호한다.
	@Transactional
	public Saved save(UUID sessionId, UUID windowId, SaveWindowState request) {
		gate.requireEnabled();
		var session = sessions.findForUpdateBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		gate.requireV2(session); gate.checkPrivacy(session);
		var window = windows.findForUpdateByWindowId(windowId).filter(w -> w.getSessionId().equals(sessionId))
			.orElseThrow(() -> invalid("WINDOW_NOT_FOUND"));
		if (window.getApiContractVersion() != 2 || window.isInvalidated()) throw invalid("PRIVACY_RETRACTED");
		if (request == null || request.analysisId() == null || !"suffix3-v2-proposed.1".equals(request.ruleVersion())
			|| request.finalState() == null || !Set.of("NORMAL", "TRANSITION", "DRIFT").contains(request.finalState())
			|| request.behaviorSnapshot() == null || request.behaviorSnapshot().size() != 3)
			throw new InvalidRequestException("상태 이력 입력이 유효하지 않습니다.");
		var analysis = analyses.findById(request.analysisId()).filter(a -> a.getWindowId().equals(windowId))
			.orElseThrow(() -> invalid("ANALYSIS_ID_CONFLICT"));
		if (analysis.getApiContractVersion() != 2 || analysis.getProcessingStatus() != AnalysisStatus.COMPLETED)
			throw invalid("ANALYSIS_NOT_COMPLETED");
		String fingerprint = json.fingerprint(Map.of("analysisId", request.analysisId(), "ruleVersion", request.ruleVersion(),
			"behaviorSnapshot", request.behaviorSnapshot()));
		if (!fingerprint.equals(request.inputFingerprint())) throw invalid("STATE_INPUT_MISMATCH");
		var existing = history.findByIdWindowIdAndInputFingerprint(windowId, fingerprint);
		if (existing.isPresent()) {
			if (!existing.get().getFinalState().equals(request.finalState())) throw invalid("STATE_INPUT_CONFLICT");
			return new Saved(existing.get(), false);
		}
		List<SaveWindowState.Behavior> current = window.getVisitIds().stream()
			.map(id -> SaveWindowState.Behavior.of(visits.findById(id).orElseThrow())).toList();
		if (!current.equals(request.behaviorSnapshot())) throw invalid("STALE_STATE_INPUT");
		var state = history.saveAndFlush(new WindowStateHistory(new WindowStateId(windowId, window.nextStateVersion()),
			request.analysisId(), request.ruleVersion(), clock.instant().truncatedTo(ChronoUnit.MILLIS), request.finalState(),
			json.write(current), fingerprint));
		return new Saved(state, true);
	}
	private static ConflictException invalid(String code) { return new ConflictException(code, "상태 이력을 저장할 수 없습니다."); }
}
