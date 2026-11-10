package com.focusrecovery.domain.window.dto;

import java.util.List;
import java.util.UUID;
import com.focusrecovery.domain.visit.entity.PageVisit;

public record SaveWindowState(UUID analysisId, String ruleVersion, String finalState,
	List<Behavior> behaviorSnapshot, String inputFingerprint) {
	public record Behavior(UUID visitId, long activeDurationMs, int tabSwitchCount, long behaviorVersion) {
		public static Behavior of(PageVisit visit) {
			return new Behavior(visit.getVisitId(), visit.getActiveDurationMs(), visit.getTabSwitchCount(), visit.getBehaviorVersion());
		}
	}
}
