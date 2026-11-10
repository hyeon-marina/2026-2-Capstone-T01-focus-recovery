package com.focusrecovery.domain.alert.dto;

import java.time.Instant;
import java.util.UUID;

import com.focusrecovery.domain.alert.entity.AlertType;
import com.focusrecovery.domain.alert.entity.ResponseAction;

// 이력 조회 쿼리 결과 한 행(알림 + 연결된 응답·구간 순서). 분석의 JSON 컬럼은 읽지 않는다
public record AlertHistoryRow(
	UUID alertId,
	UUID sessionId,
	AlertType alertType,
	UUID analysisId,
	Integer windowIndex,
	String message,
	Instant createdAt,
	Instant shownAt,
	UUID feedbackId,
	ResponseAction action,
	Instant selectedAt,
	UUID windowId, Long stateVersion, Instant invalidatedAt
) {
}
