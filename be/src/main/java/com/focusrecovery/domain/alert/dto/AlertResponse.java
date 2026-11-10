package com.focusrecovery.domain.alert.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.focusrecovery.domain.alert.entity.AlertType;
import com.focusrecovery.domain.alert.entity.Notification;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "알림 후보 (Alert). 후보 생성과 실제 표시는 별개이며 shownAt은 실제 표시 확인 전에는 null")
@JsonInclude(JsonInclude.Include.ALWAYS)
public record AlertResponse(
	@Schema(description = "BE가 표시 전에 발급한 알림 ID", example = "9d2c4e71-3a8b-4f05-b6e2-1c7a9f3d5b80")
	UUID alertId,
	@Schema(description = "작업 세션 ID", example = "1ba72f77-c166-4e06-88c7-1d6ed919cd9b")
	UUID sessionId,
	@Schema(description = "알림 유형", example = "AI")
	AlertType alertType,
	@Schema(description = "AI 알림의 분석 ID. 고정 주기는 null", types = {"string", "null"}, format = "uuid")
	UUID analysisId,
	@Schema(description = "AI 알림의 구간 순서. 고정 주기는 null", types = {"integer", "null"}, example = "4")
	Integer windowIndex,
	@Schema(description = "세션의 최초 목표", example = "Spring JPA 엔터티 매핑 학습")
	String goalText,
	@Schema(description = "목표 재제시 알림 내용")
	String message,
	@Schema(description = "알림 후보 생성 시각 (UTC)", type = "string", format = "date-time", example = "2026-10-18T01:00:00.000Z")
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC")
	Instant createdAt,
	@Schema(description = "실제 표시 시각 (UTC). 표시 확인 전에는 null", types = {"string", "null"}, format = "date-time")
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC")
	Instant shownAt,
	@JsonInclude(JsonInclude.Include.NON_NULL) UUID windowId,
	@JsonInclude(JsonInclude.Include.NON_NULL) Long stateVersion
) {

	public static AlertResponse of(Notification notification, Integer windowIndex, String goalText) {
		return new AlertResponse(notification.getAlertId(), notification.getSessionId(), notification.getAlertType(),
			notification.getAnalysisId(), windowIndex, goalText, notification.getMessage(), notification.getCreatedAt(),
			notification.getShownAt(), notification.getWindowId(), notification.getStateVersion());
	}
}
