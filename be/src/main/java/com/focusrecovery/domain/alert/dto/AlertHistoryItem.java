package com.focusrecovery.domain.alert.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.focusrecovery.domain.alert.entity.AlertType;

import io.swagger.v3.oas.annotations.media.Schema;

// Alert의 모든 필드 + response. Alert를 다시 감싸지 않는다
@Schema(description = "알림 이력 항목 (Alert의 모든 필드 + response)")
@JsonInclude(JsonInclude.Include.ALWAYS)
public record AlertHistoryItem(
	@Schema(description = "BE가 표시 전에 발급한 알림 ID") UUID alertId,
	@Schema(description = "작업 세션 ID") UUID sessionId,
	@Schema(description = "알림 유형", example = "AI") AlertType alertType,
	@Schema(description = "AI 알림의 분석 ID. 고정 주기는 null", types = {"string", "null"}, format = "uuid") UUID analysisId,
	@Schema(description = "AI 알림의 구간 순서. 고정 주기는 null", types = {"integer", "null"}) Integer windowIndex,
	@Schema(description = "세션의 최초 목표") String goalText,
	@Schema(description = "목표 재제시 알림 내용") String message,
	@Schema(description = "알림 후보 생성 시각 (UTC)", type = "string", format = "date-time")
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant createdAt,
	@Schema(description = "실제 표시 시각 (UTC). 미표시 후보는 null", types = {"string", "null"}, format = "date-time")
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant shownAt,
	@Schema(description = "사용자 선택(NotificationResponse). 선택이 없으면 null", nullable = true)
	NotificationResponseResponse response,
	@JsonInclude(JsonInclude.Include.NON_NULL) UUID windowId,
	@JsonInclude(JsonInclude.Include.NON_NULL) Long stateVersion,
	@JsonInclude(JsonInclude.Include.NON_NULL)
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant invalidatedAt
) {

	public static AlertHistoryItem of(AlertHistoryRow row, String goalText) {
		NotificationResponseResponse response = row.feedbackId() == null ? null
			: new NotificationResponseResponse(row.feedbackId(), row.alertId(), row.action(), row.selectedAt());
		return new AlertHistoryItem(row.alertId(), row.sessionId(), row.alertType(), row.analysisId(), row.windowIndex(),
			goalText, row.message(), row.createdAt(), row.shownAt(), response, row.windowId(), row.stateVersion(), row.invalidatedAt());
	}
}
