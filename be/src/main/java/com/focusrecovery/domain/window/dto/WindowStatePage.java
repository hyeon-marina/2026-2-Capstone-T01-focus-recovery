package com.focusrecovery.domain.window.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonFormat;

public record WindowStatePage(List<State> items, int page, int size, long totalElements, int totalPages) {
	public record State(UUID windowId, long stateVersion, UUID analysisId, String ruleVersion,
		@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant judgedAt,
		String finalState, List<SaveWindowState.Behavior> behaviorSnapshot, String inputFingerprint) {}
}
