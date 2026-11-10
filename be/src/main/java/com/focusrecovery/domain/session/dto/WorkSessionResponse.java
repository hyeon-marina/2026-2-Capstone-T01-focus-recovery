package com.focusrecovery.domain.session.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.entity.WorkSessionStatus;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "작업 세션")
@JsonInclude(JsonInclude.Include.ALWAYS)
public record WorkSessionResponse(
	@Schema(description = "작업 세션 ID", example = "1ba72f77-c166-4e06-88c7-1d6ed919cd9b")
	UUID sessionId,
	@Schema(description = "작업 목표 (앞뒤 공백 제거됨)", example = "Spring Boot JPA 공부하기")
	String goalText,
	@Schema(description = "세션 상태 (ACTIVE: 진행 중, ENDED: 종료)", example = "ACTIVE")
	WorkSessionStatus status,
	@Schema(description = "시작 시각 (UTC)", type = "string", format = "date-time", example = "2026-10-12T06:09:39.912Z")
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC")
	Instant startedAt,
	@Schema(description = "종료 시각 (UTC). 진행 중이면 null", types = {"string", "null"}, format = "date-time")
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC")
	Instant endedAt,
	String collectionSpecVersion
) {

	public static WorkSessionResponse from(WorkSession session) {
		return new WorkSessionResponse(
			session.getSessionId(),
			session.getGoalText(),
			session.getStatus(),
			session.getStartedAt(),
			session.getEndedAt(),
			session.getCollectionSpecVersion()
		);
	}
}
