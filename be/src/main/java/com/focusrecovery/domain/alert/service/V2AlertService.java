package com.focusrecovery.domain.alert.service;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import com.focusrecovery.domain.alert.dto.AlertResponse;
import com.focusrecovery.domain.alert.entity.*;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.*;
import com.focusrecovery.domain.window.entity.*;
import com.focusrecovery.domain.window.repository.*;
import com.focusrecovery.global.config.V2StorageGate;

// Called under the session lock. State history itself is the durable candidate work:
// if candidate storage fails, the whole decision rolls back and the dirty window is retried.
@Service
public class V2AlertService {
	private final NotificationRepository notifications;
	private final AnalysisWindowRepository windows;
	private final AnalysisResultRepository analyses;
	private final WindowStateHistoryRepository states;
	private final AlertProperties properties;
	private final Clock clock;
	private final V2StorageGate gate;
	public V2AlertService(NotificationRepository notifications, AnalysisWindowRepository windows,
		AnalysisResultRepository analyses, WindowStateHistoryRepository states, AlertProperties properties, Clock clock, V2StorageGate gate) {
		this.notifications = notifications; this.windows = windows; this.analyses = analyses; this.states = states;
		this.properties = properties; this.clock = clock; this.gate = gate;
	}
	@Transactional(propagation = Propagation.MANDATORY)
	public void invalidatePending(UUID windowId, Instant at) {
		for (var candidate : notifications.findForUpdateByWindowIdAndShownAtIsNull(windowId)) candidate.invalidate(at.truncatedTo(ChronoUnit.MILLIS));
	}
	@Transactional(propagation = Propagation.MANDATORY)
	public void invalidateSessionPending(UUID sessionId, Instant at) {
		for (var candidate : notifications.findForUpdateBySessionIdAndShownAtIsNull(sessionId)) {
			if (candidate.getWindowId() != null) candidate.invalidate(at.truncatedTo(ChronoUnit.MILLIS));
		}
	}
	@Transactional(propagation = Propagation.MANDATORY)
	public void createCandidate(WorkSession session, AnalysisWindow window, WindowStateHistory state) {
		if (!eligible(session, window, state)) return;
		var existing = notifications.findByWindowIdAndStateVersion(window.getWindowId(), state.getId().stateVersion());
		if (existing.isPresent()) return;
		invalidateSessionPending(session.getSessionId(), clock.instant());
		notifications.saveAndFlush(Notification.v2(session.getSessionId(), window.getWindowId(), state.getId().stateVersion(),
			state.getAnalysisId(), AlertService.AI_MESSAGE, clock.instant().truncatedTo(ChronoUnit.MILLIS)));
	}
	public AlertResponse currentCandidate(WorkSession session) {
        gate.checkConsent(session);
		if (!gate.enabled() || session.isQuarantined() || session.getStatus() != WorkSessionStatus.ACTIVE || properties.mode() != AlertType.AI) return null;
		var window = windows.findFirstBySessionIdOrderByWindowIndexDesc(session.getSessionId()).orElse(null);
		if (window == null) return null;
		var state = states.findFirstByIdWindowIdOrderByIdStateVersionDesc(window.getWindowId()).orElse(null);
		if (state == null || !eligible(session, window, state)) return null;
		return notifications.findByWindowIdAndStateVersion(window.getWindowId(), state.getId().stateVersion())
			.filter(n -> n.getShownAt() == null && n.getInvalidatedAt() == null)
			.map(n -> AlertResponse.of(n, window.getWindowIndex(), session.getGoalText())).orElse(null);
	}
	private boolean eligible(WorkSession session, AnalysisWindow window, WindowStateHistory state) {
        gate.checkConsent(session);
		if (!gate.enabled() || !session.isV2() || session.isQuarantined() || session.getStatus() != WorkSessionStatus.ACTIVE
			|| properties.mode() != AlertType.AI || window.isInvalidated() || window.isDecisionDirty() || window.getDecisionErrorCode() != null
			|| !"DRIFT".equals(state.getFinalState())) return false;
		if (!windows.findFirstBySessionIdOrderByWindowIndexDesc(session.getSessionId()).map(w -> w.getWindowId().equals(window.getWindowId())).orElse(false)) return false;
		if (!states.findFirstByIdWindowIdOrderByIdStateVersionDesc(window.getWindowId()).map(s -> s.getId().equals(state.getId())).orElse(false)) return false;
		if (!analyses.findById(state.getAnalysisId()).map(a -> a.getApiContractVersion() == 2 && a.getProcessingStatus() == AnalysisStatus.COMPLETED).orElse(false)) return false;
		var last = notifications.findLastShownAiWindowIndex(session.getSessionId());
		if (last.isPresent()) {
			if (!states.existsReturnedBetween(session.getSessionId(), last.get(), window.getWindowIndex())) return false;
			var shownAt = notifications.findLastShownAt(session.getSessionId(), AlertType.AI).orElseThrow();
			if (clock.instant().isBefore(shownAt.plus(properties.ai().minInterval()))) return false;
		}
		return true;
	}
}
