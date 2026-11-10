package com.focusrecovery.domain.analysis.service;

import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.focusrecovery.domain.analysis.dto.V2AnalysisStatusResponse.Decision;
import com.focusrecovery.domain.analysis.entity.*;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.window.dto.WindowStatePage;
import com.focusrecovery.domain.window.entity.*;
import com.focusrecovery.domain.window.repository.*;
import com.focusrecovery.domain.window.exception.WindowNotFoundException;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.util.Pages;
import tools.jackson.databind.json.JsonMapper;

@Service
@Transactional(readOnly = true)
public class V2AnalysisQueryService {
	private final AnalysisWindowRepository windows;
	private final WindowStateHistoryRepository states;
	private final AnalysisResultRepository analyses;
	private final WorkSessionRepository sessions;
	private final V2StorageGate gate;
	private final JsonMapper mapper;
	public V2AnalysisQueryService(AnalysisWindowRepository windows, WindowStateHistoryRepository states,
		AnalysisResultRepository analyses, WorkSessionRepository sessions, V2StorageGate gate, JsonMapper mapper) {
		this.windows = windows; this.states = states; this.analyses = analyses; this.sessions = sessions; this.gate = gate; this.mapper = mapper;
	}
	public Decision current(WorkSession session) {
		return windows.findFirstBySessionIdOrderByWindowIndexDesc(session.getSessionId()).map(w -> decision(session, w)).orElse(null);
	}
	public Decision decision(WorkSession session, AnalysisWindow window) {
		AnalysisResult analysis = analyses.findByWindowId(window.getWindowId()).orElse(null);
		UUID id = analysis == null ? null : analysis.getAnalysisId();
		if (session.isQuarantined() || window.isInvalidated()) return empty(window, id, "INVALIDATED", "PRIVACY_RETRACTED");
		if (analysis != null && analysis.getProcessingStatus() == AnalysisStatus.FAILED) return empty(window, id, "FAILED", analysis.getErrorCode());
		if (analysis != null && analysis.getProcessingStatus() == AnalysisStatus.INVALIDATED) return empty(window, id, "INVALIDATED", "PRIVACY_RETRACTED");
		if (window.getDecisionErrorCode() != null) return empty(window, id, "FAILED", window.getDecisionErrorCode());
		if (analysis == null || analysis.getProcessingStatus() != AnalysisStatus.COMPLETED || window.isDecisionDirty()) return empty(window, id, "PENDING", null);
		return states.findFirstByIdWindowIdOrderByIdStateVersionDesc(window.getWindowId()).map(s -> successful(window, s)).orElseGet(() -> empty(window, id, "PENDING", null));
	}
	public Decision lastSuccess(WorkSession session) {
		if (session.isQuarantined()) return null;
		var found = states.findSuccessful(session.getSessionId(), PageRequest.of(0, 1));
		if (found.isEmpty()) return null;
		var state = found.getFirst(); return successful(windows.findById(state.getId().windowId()).orElseThrow(), state);
	}
	public WindowStatePage history(UUID sessionId, UUID windowId, int page, int size) {
		Pages.validate(page, size);
		var session = sessions.findForShareBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		gate.requireV2(session); gate.checkPrivacy(session);
		windows.findById(windowId).filter(w -> w.getSessionId().equals(sessionId) && w.getApiContractVersion() == 2).orElseThrow(WindowNotFoundException::new);
		var found = states.findByIdWindowIdOrderByIdStateVersionDesc(windowId, PageRequest.of(page, size));
		return new WindowStatePage(found.stream().map(s -> new WindowStatePage.State(s.getId().windowId(), s.getId().stateVersion(),
			s.getAnalysisId(), s.getRuleVersion(), s.getJudgedAt(), s.getFinalState(), java.util.Arrays.asList(mapper.readValue(s.getBehaviorSnapshot(), com.focusrecovery.domain.window.dto.SaveWindowState.Behavior[].class)), s.getInputFingerprint())).toList(),
			page, size, found.getTotalElements(), found.getTotalPages());
	}
	private Decision empty(AnalysisWindow w, UUID id, String status, String error) { return new Decision(w.getWindowId(), w.getWindowIndex(), null, id, status, null, null, error); }
	private Decision successful(AnalysisWindow w, WindowStateHistory s) { return new Decision(w.getWindowId(), w.getWindowIndex(), s.getId().stateVersion(), s.getAnalysisId(), "COMPLETED", s.getFinalState(), s.getJudgedAt(), null); }
}
