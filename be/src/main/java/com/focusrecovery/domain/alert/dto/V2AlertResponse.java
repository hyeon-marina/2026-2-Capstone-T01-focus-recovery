package com.focusrecovery.domain.alert.dto;

import java.time.Instant;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.focusrecovery.domain.alert.entity.AlertType;

// v2 includes explicit null state references for fixed-interval alerts; the v1 DTO stays unchanged on the wire.
@JsonInclude(JsonInclude.Include.ALWAYS)
public record V2AlertResponse(UUID alertId, UUID sessionId, AlertType alertType, UUID analysisId,
	Integer windowIndex, String goalText, String message,
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant createdAt,
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant shownAt,
	UUID windowId, Long stateVersion) {
	public static V2AlertResponse of(AlertResponse alert) {
		return alert == null ? null : new V2AlertResponse(alert.alertId(), alert.sessionId(), alert.alertType(), alert.analysisId(),
			alert.windowIndex(), alert.goalText(), alert.message(), alert.createdAt(), alert.shownAt(), alert.windowId(), alert.stateVersion());
	}
}
