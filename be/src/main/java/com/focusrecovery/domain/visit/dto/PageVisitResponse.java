package com.focusrecovery.domain.visit.dto;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.focusrecovery.domain.visit.entity.PageVisit;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "방문 기록")
@JsonInclude(JsonInclude.Include.ALWAYS)
public record PageVisitResponse(
	@Schema(description = "방문 ID", example = "7d3f8a2e-1c4b-4f6a-9e2d-5b8c0a1f3e47")
	UUID visitId,
	@Schema(description = "작업 세션 ID", example = "1ba72f77-c166-4e06-88c7-1d6ed919cd9b")
	UUID sessionId,
	@Schema(description = "세션 내 방문 순서", example = "1")
	int sequence,
	@Schema(description = "브라우저 탭 식별값", example = "tab-1024")
	String browserTabKey,
	@Schema(description = "정규화된 페이지 주소", example = "https://docs.spring.io/spring-boot/index.html")
	String normalizedUrl,
	@Schema(description = "페이지 도메인", example = "docs.spring.io")
	String domain,
	@Schema(description = "페이지 제목", types = {"string", "null"}, example = "Spring Boot Reference")
	String title,
	@Schema(description = "페이지 본문 텍스트", types = {"string", "null"})
	String content,
	@Schema(description = "검색어", types = {"string", "null"}, example = "spring boot jpa")
	String searchQuery,
	@Schema(description = "검색 결과 페이지 여부", example = "false")
	@JsonProperty("isSearchResultPage")
	boolean isSearchResultPage,
	@Schema(description = "방문 시각 (UTC)", type = "string", format = "date-time", example = "2026-10-13T01:23:45.678Z")
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC")
	Instant visitedAt,
	@Schema(description = "누적 활성 체류시간(ms)", example = "0")
	long activeDurationMs,
	@Schema(description = "누적 탭 전환 횟수", example = "0")
	int tabSwitchCount,
	@Schema(description = "행동 갱신 버전", example = "0")
	long behaviorVersion,
	@Schema(description = "BE에서 기록한 마지막 행동 갱신 시각 (UTC). 갱신 전이면 null", types = {"string", "null"}, format = "date-time")
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC")
	Instant updatedAt,
	@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
	String extractionStatus
) {

	public static PageVisitResponse from(PageVisit visit) {
		return new PageVisitResponse(
			visit.getVisitId(), visit.getSessionId(), visit.getSequence(), visit.getBrowserTabKey(),
			visit.getNormalizedUrl(), visit.getDomain(), visit.getTitle(), visit.getContent(), visit.getSearchQuery(),
			visit.isSearchResultPage(), visit.getVisitedAt(), visit.getActiveDurationMs(), visit.getTabSwitchCount(),
			visit.getBehaviorVersion(), visit.getUpdatedAt(), visit.getExtractionStatus()
		);
	}
}
