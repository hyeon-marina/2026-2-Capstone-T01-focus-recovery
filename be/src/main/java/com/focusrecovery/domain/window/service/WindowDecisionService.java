package com.focusrecovery.domain.window.service;

import java.time.Clock;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import com.focusrecovery.domain.alert.service.V2AlertService;
import com.focusrecovery.domain.analysis.dto.V2AnalysisCompletion;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.dto.SaveWindowState;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.util.CanonicalJson;
import tools.jackson.databind.json.JsonMapper;

@Service
public class WindowDecisionService {
	private final WorkSessionRepository sessions;
	private final AnalysisWindowRepository windows;
	private final AnalysisResultRepository analyses;
	private final PageVisitRepository visits;
	private final WindowStateHistoryService history;
	private final FinalStateRules rules;
	private final V2AlertService alerts;
	private final V2StorageGate gate;
	private final CanonicalJson json;
	private final JsonMapper mapper;
	private final Clock clock;
	public WindowDecisionService(WorkSessionRepository sessions, AnalysisWindowRepository windows,
		AnalysisResultRepository analyses, PageVisitRepository visits, WindowStateHistoryService history,
		FinalStateRules rules, V2AlertService alerts, V2StorageGate gate, CanonicalJson json, JsonMapper mapper, Clock clock) {
		this.sessions = sessions; this.windows = windows; this.analyses = analyses; this.visits = visits;
		this.history = history; this.rules = rules; this.alerts = alerts; this.gate = gate; this.json = json; this.mapper = mapper; this.clock = clock;
	}
	// PATCH holds session SHARE then visit WRITE; sorted window updates cannot race a session-WRITE decision.
	@Transactional(propagation = Propagation.MANDATORY)
	public void markVisitDirty(UUID sessionId, UUID visitId) {
		for (var window : windows.findContainingVisit(sessionId, visitId)) {
			if (window.getApiContractVersion() == 2 && !window.isInvalidated()) {
				window.markDecisionDirty(); alerts.invalidatePending(window.getWindowId(), clock.instant());
			}
		}
	}
	// No HTTP or unlocked calculation: latest behaviors, version allocation, dirty clearing and candidate commit together.
	@Transactional
	public void process(UUID sessionId, UUID windowId) {
		gate.requireEnabled();
		var session = sessions.findForUpdateBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		gate.requireV2(session); gate.checkPrivacy(session);
		var window = windows.findForUpdateByWindowId(windowId).filter(w -> w.getSessionId().equals(sessionId)).orElseThrow();
		if (!window.isDecisionDirty() || window.isInvalidated() || window.getApiContractVersion() != 2) return;
		var analysis = analyses.findByWindowId(windowId).orElse(null);
		if (analysis == null || analysis.getApiContractVersion() != 2 || analysis.getProcessingStatus() != AnalysisStatus.COMPLETED) return;
		var snapshot = window.getVisitIds().stream().map(id -> SaveWindowState.Behavior.of(visits.findById(id).orElseThrow())).toList();
		V2AnalysisCompletion result;
		String state;
		try {
			result = mapper.readValue(analysis.getResponseSnapshot(), V2AnalysisCompletion.class);
			state = rules.judge(result.pageResults(), snapshot);
		} catch (RuntimeException e) {
			window.decisionFailed("AI_INVALID_RESPONSE"); alerts.invalidatePending(windowId, clock.instant()); return;
		}
		String fingerprint = json.fingerprint(Map.of("analysisId", analysis.getAnalysisId(), "ruleVersion", FinalStateRules.VERSION, "behaviorSnapshot", snapshot));
		var saved = history.save(sessionId, windowId, new SaveWindowState(analysis.getAnalysisId(), FinalStateRules.VERSION, state, snapshot, fingerprint));
		window.decisionCompleted();
		alerts.createCandidate(session, window, saved.state());
	}
}
