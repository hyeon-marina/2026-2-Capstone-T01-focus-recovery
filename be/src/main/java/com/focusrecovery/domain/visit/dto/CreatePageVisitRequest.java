package com.focusrecovery.domain.visit.dto;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.focusrecovery.domain.visit.entity.PageVisit;
import com.focusrecovery.global.exception.InvalidRequestException;
import com.focusrecovery.global.util.Uuids;
import com.focusrecovery.global.validation.CodePointLength;
import com.focusrecovery.global.validation.NormalizedUrl;

import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;



// 주소·제목·검색어는 TEXT(65,535바이트)에 utf8mb4 최대 4바이트 문자로도 들어가는 길이로, 본문은 명세(data-collection-spec §4) 기준으로 제한한다
@Schema(description = "방문 기록 저장 요청")
@DomainMatchesUrl
public record CreatePageVisitRequest(
	@Schema(description = "FE가 발급한 방문 ID (UUID). 재전송 시 같은 값", example = "7d3f8a2e-1c4b-4f6a-9e2d-5b8c0a1f3e47",
		requiredMode = Schema.RequiredMode.REQUIRED)
	@NotNull(message = "방문 ID를 입력해 주세요.")
	@Pattern(regexp = Uuids.REGEX, message = "방문 ID가 올바른 UUID 형식이 아닙니다.")
	String visitId,

	@Schema(description = "세션 내 방문 후보 발생 순서 (1부터, FE 발급). 제외된 후보 번호는 비어 있을 수 있음", example = "1", minimum = "1", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotNull(message = "방문 순서를 입력해 주세요.")
	@Min(value = 1, message = "방문 순서는 1 이상이어야 합니다.")
	Integer sequence,

	@Schema(description = "브라우저 탭 식별값 (최대 100자)", example = "tab-1024", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotBlank(message = "브라우저 탭 식별값을 입력해 주세요.")
	@Size(max = 100, message = "브라우저 탭 식별값은 100자 이하여야 합니다.")
	String browserTabKey,

	@Schema(description = "FE가 정규화한 페이지 주소. http/https 스킴(대소문자 무관), 소문자 호스트, "
		+ "기본 포트(http:80, https:443)·인증정보·Query·Fragment 없음. 서버는 검증만 하고 보낸 값 그대로(경로 대소문자 유지) 저장·비교합니다.",
		example = "https://docs.spring.io/spring-boot/index.html", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotBlank(message = "페이지 주소를 입력해 주세요.")
	@NormalizedUrl
	@Size(max = 16383, message = "페이지 주소가 너무 깁니다.")
	String normalizedUrl,

	@Schema(description = "페이지의 전체 호스트명 (서브도메인 포함, 포트 제외, 최대 255자). normalizedUrl의 호스트와 같아야 합니다(FE의 URL.hostname).",
		example = "docs.spring.io", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotBlank(message = "도메인을 입력해 주세요.")
	@Size(max = 255, message = "도메인은 255자 이하여야 합니다.")
	String domain,

	@Schema(description = "페이지 제목 (생략 가능)", example = "Spring Boot Reference")
	@Size(max = 16383, message = "제목이 너무 깁니다.")
	String title,

	@Schema(description = "FE가 추출한 페이지 본문 텍스트 (생략 또는 null 가능, 최대 5,000 Unicode code points)", maxLength = 5000,
		example = "Spring Boot helps you to create stand-alone...")
	@CodePointLength(max = 5000, message = "본문은 5,000 Unicode code points 이하여야 합니다.")
	String content,

	@Schema(description = "검색어 (생략 가능)", example = "spring boot jpa")
	@Size(max = 16383, message = "검색어가 너무 깁니다.")
	String searchQuery,

	@Schema(description = "검색 결과 페이지 여부 (생략 시 false)", example = "false")
	@JsonProperty("isSearchResultPage")
	Boolean isSearchResultPage,

	@Schema(description = "FE에서 측정한 방문 시각 (UTC, 밀리초까지 저장)", type = "string", format = "date-time",
		example = "2026-10-13T01:23:45.678Z", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotNull(message = "방문 시각을 입력해 주세요.")
	Instant visitedAt,

	@Schema(description = "누적 활성 체류시간(ms). 유효 방문 최소 기준(data-collection-spec §5)에 따라 1000 이상 필수",
		example = "1000", minimum = "1000", requiredMode = Schema.RequiredMode.REQUIRED)
	@NotNull(message = "체류시간을 입력해 주세요.")
	@Min(value = 1000, message = "체류시간은 1000ms(1초) 이상이어야 합니다.")
	Long activeDurationMs,

	@Schema(description = "누적 탭 전환 횟수 (생략 시 0)", example = "0", minimum = "0")
	@Min(value = 0, message = "탭 전환 횟수는 0 이상이어야 합니다.")
	Integer tabSwitchCount,

	@Schema(description = "행동 갱신 버전 (생략 시 0)", example = "0", minimum = "0")
	@Min(value = 0, message = "행동 갱신 버전은 0 이상이어야 합니다.")
	Long behaviorVersion,
	String extractionStatus
) {

	public CreatePageVisitRequest(String visitId, Integer sequence, String browserTabKey, String normalizedUrl,
		String domain, String title, String content, String searchQuery, Boolean isSearchResultPage,
		Instant visitedAt, Long activeDurationMs, Integer tabSwitchCount, Long behaviorVersion) {
		this(visitId, sequence, browserTabKey, normalizedUrl, domain, title, content, searchQuery,
			isSearchResultPage, visitedAt, activeDurationMs, tabSwitchCount, behaviorVersion, null);
	}

	public void validateV2() {
		boolean search = Boolean.TRUE.equals(isSearchResultPage);
		if (!"SUCCESS".equals(extractionStatus) || activeDurationMs == null || activeDurationMs < 5000
			|| activeDurationMs > 9007199254740991L || behaviorVersion == null || behaviorVersion < 0
			|| behaviorVersion > 9007199254740991L || tabSwitchCount == null || tabSwitchCount < 0
			|| isSearchResultPage == null || title == null || codePoints(title) > 500
			|| content == null || codePoints(content) < (search ? 1 : 50) || codePoints(content) > 5000
			|| normalizedUrl == null || normalizedUrl.length() > 8192 || !normalizedUrl.matches("https?://[^/?#@\\s]+/[^?#\\s]*") || domain == null || domain.length() > 253
			|| (search ? searchQuery == null || searchQuery.isBlank() || codePoints(searchQuery) > 500 : searchQuery != null)
			|| visitId == null || !visitId.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
			throw new InvalidRequestException("v2 방문 요청이 유효하지 않습니다.");
		}
	}

	private static int codePoints(String value) { return value.codePointCount(0, value.length()); }

	// DATETIME(3)에 저장되는 정밀도로 맞춰야 재전송 시 원본 비교가 일치한다
	public CreatePageVisitRequest {
		visitedAt = visitedAt == null ? null : visitedAt.truncatedTo(ChronoUnit.MILLIS);
	}

	public PageVisit toEntity(UUID sessionId) {
		PageVisit visit = new PageVisit(
			UUID.fromString(visitId), sessionId, sequence, browserTabKey, normalizedUrl, domain, title, content,
			searchQuery, Boolean.TRUE.equals(isSearchResultPage), visitedAt,
			activeDurationMs,
			tabSwitchCount == null ? 0 : tabSwitchCount,
			behaviorVersion == null ? 0 : behaviorVersion
		);
		visit.extracted(extractionStatus);
		return visit;
	}
}
