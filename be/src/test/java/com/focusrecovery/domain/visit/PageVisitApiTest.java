package com.focusrecovery.domain.visit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.entity.PageVisit;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.jayway.jsonpath.JsonPath;

@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PageVisitApiTest {

	private static final String ISO_MILLIS_UTC = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z";
	private static final String VISITED_AT = "2026-10-13T01:23:45.678Z";

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private WorkSessionRepository workSessionRepository;

	@Autowired
	private PageVisitRepository pageVisitRepository;

	@Autowired
	private AnalysisWindowRepository analysisWindowRepository;

	@Autowired
	private AnalysisResultRepository analysisResultRepository;

	@Autowired
	private NotificationRepository notificationRepository;

	@Autowired
	private AlertCandidateTaskRepository alertCandidateTaskRepository;

	private UUID sessionId;

	@BeforeEach
	void setUp() {
		alertCandidateTaskRepository.deleteAll();
		notificationRepository.deleteAll();
		analysisResultRepository.deleteAll();
		analysisWindowRepository.deleteAll();
		pageVisitRepository.deleteAll();
		workSessionRepository.deleteAll();
		sessionId = newSession();
	}

	// 다른 테스트 클래스가 세션을 지울 때 외래키에 걸리지 않도록 방문 기록을 남기지 않는다
	@AfterEach
	void tearDown() {
		alertCandidateTaskRepository.deleteAll();
		notificationRepository.deleteAll();
		analysisResultRepository.deleteAll();
		analysisWindowRepository.deleteAll();
		pageVisitRepository.deleteAll();
	}

	@Test
	void 새_방문을_저장하면_201과_저장된_정보를_반환한다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		String body = """
			{"visitId": "%s", "sequence": 1, "browserTabKey": "tab-1", "normalizedUrl": "https://docs.spring.io/a",
			 "domain": "docs.spring.io", "title": "제목", "content": "본문", "searchQuery": "spring",
			 "isSearchResultPage": true, "visitedAt": "2026-10-13T01:23:45.678Z",
			 "activeDurationMs": 1000, "tabSwitchCount": 2, "behaviorVersion": 3}""".formatted(visitId);

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.visitId").value(visitId))
			.andExpect(jsonPath("$.sessionId").value(sessionId.toString()))
			.andExpect(jsonPath("$.sequence").value(1))
			.andExpect(jsonPath("$.browserTabKey").value("tab-1"))
			.andExpect(jsonPath("$.normalizedUrl").value("https://docs.spring.io/a"))
			.andExpect(jsonPath("$.domain").value("docs.spring.io"))
			.andExpect(jsonPath("$.title").value("제목"))
			.andExpect(jsonPath("$.content").value("본문"))
			.andExpect(jsonPath("$.searchQuery").value("spring"))
			.andExpect(jsonPath("$.isSearchResultPage").value(true))
			.andExpect(jsonPath("$.visitedAt").value("2026-10-13T01:23:45.678Z"))
			.andExpect(jsonPath("$.activeDurationMs").value(1000))
			.andExpect(jsonPath("$.tabSwitchCount").value(2))
			.andExpect(jsonPath("$.behaviorVersion").value(3))
			.andExpect(jsonPath("$.updatedAt").value(nullValue()));

		PageVisit saved = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(saved.getSessionId()).isEqualTo(sessionId);
		assertThat(saved.isSearchResultPage()).isTrue();
		assertThat(saved.getVisitedAt()).isEqualTo(Instant.parse("2026-10-13T01:23:45.678Z"));
		assertThat(saved.getActiveDurationMs()).isEqualTo(1000);
	}

	@Test
	void 선택_필드를_생략하면_null과_기본값으로_저장한다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		String body = """
			{"visitId": "%s", "sequence": 1, "browserTabKey": "tab-1", "normalizedUrl": "http://example.com",
			 "domain": "example.com", "title": null, "activeDurationMs": 1000,
			 "visitedAt": "2026-10-13T01:23:45.678Z"}""".formatted(visitId);

		String response = mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.title").value(nullValue()))
			.andExpect(jsonPath("$.content").value(nullValue()))
			.andExpect(jsonPath("$.searchQuery").value(nullValue()))
			.andExpect(jsonPath("$.isSearchResultPage").value(false))
			.andExpect(jsonPath("$.activeDurationMs").value(1000))
			.andExpect(jsonPath("$.tabSwitchCount").value(0))
			.andExpect(jsonPath("$.behaviorVersion").value(0))
			.andReturn().getResponse().getContentAsString();
		assertThat(response).contains("\"title\":null", "\"content\":null", "\"searchQuery\":null", "\"updatedAt\":null");
	}

	static Stream<String> allowedContents() {
		return Stream.of("", " ", "가".repeat(5000), "a".repeat(5000), "😀".repeat(2500),
			"😀".repeat(2501), "😀".repeat(5000), "한a😀𐐀".repeat(1250));
	}

	@ParameterizedTest(name = "허용 본문 [{index}]")
	@MethodSource("allowedContents")
	void 본문은_5000_code_points까지_원본대로_저장된다(String content) throws Exception {
		String visitId = UUID.randomUUID().toString();
		String body = withField(visitJson(visitId, 1, "제목"), "content", "\"" + content + "\"");

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.content").value(content));
		// 같은 본문으로 재전송하면 기존 방문을 반환한다
		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.visitId").value(visitId))
			.andExpect(jsonPath("$.content").value(content));

		assertThat(pageVisitRepository.count()).isEqualTo(1);
		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getContent()).isEqualTo(content);
	}

	static Stream<String> oversizedContents() {
		return Stream.of("가".repeat(5001), "a".repeat(5001), "😀".repeat(5001), "한a😀𐐀".repeat(1250) + "😀");
	}

	@ParameterizedTest(name = "초과 본문 [{index}]")
	@MethodSource("oversizedContents")
	void 본문이_5000_code_points를_넘으면_400이고_저장하지_않는다(String content) throws Exception {
		String body = withField(visitJson(UUID.randomUUID().toString(), 1, "제목"), "content", "\"" + content + "\"");

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors[0].field").value("content"))
			.andExpect(jsonPath("$.fieldErrors[0].message").value("본문은 5,000 Unicode code points 이하여야 합니다."));

		assertThat(pageVisitRepository.count()).isZero();
	}

	@Test
	void 본문을_null로_보내면_null로_저장된다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		String body = withField(visitJson(visitId, 1, "제목"), "content", "null");

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.content").value(nullValue()));

		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getContent()).isNull();
	}

	@ParameterizedTest
	@ValueSource(longs = {1000, 1001, 60_000})
	void 체류시간이_1000ms_이상이면_저장된다(long activeDurationMs) throws Exception {
		String visitId = UUID.randomUUID().toString();
		String body = withField(visitJson(visitId, 1, "제목"), "activeDurationMs", String.valueOf(activeDurationMs));

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.activeDurationMs").value(activeDurationMs));

		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getActiveDurationMs())
			.isEqualTo(activeDurationMs);
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
		"0|체류시간은 1000ms(1초) 이상이어야 합니다.",
		"999|체류시간은 1000ms(1초) 이상이어야 합니다.",
		"null|체류시간을 입력해 주세요.",
	})
	void 체류시간이_없거나_1000ms_미만이면_400이고_저장하지_않는다(String value, String message) throws Exception {
		String body = withField(visitJson(UUID.randomUUID().toString(), 1, "제목"), "activeDurationMs", value);

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors.length()").value(1))
			.andExpect(jsonPath("$.fieldErrors[0].field").value("activeDurationMs"))
			.andExpect(jsonPath("$.fieldErrors[0].message").value(message));

		assertThat(pageVisitRepository.count()).isZero();
	}

	@Test
	void 같은_방문을_재전송하면_200으로_기존_방문을_반환하고_행동정보를_덮어쓰지_않는다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());
		String updatedAt = JsonPath.read(patchBehavior(sessionId, visitId, 5000, 1, 1)
			.andExpect(jsonPath("$.applied").value(true))
			.andReturn().getResponse().getContentAsString(), "$.updatedAt");

		// 재전송 요청의 행동 정보(1000ms, 버전 0)는 무시되고 갱신된 값이 유지된다
		saveVisit(sessionId, visitId, 1, "제목")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.visitId").value(visitId))
			.andExpect(jsonPath("$.activeDurationMs").value(5000))
			.andExpect(jsonPath("$.tabSwitchCount").value(1))
			.andExpect(jsonPath("$.behaviorVersion").value(1))
			.andExpect(jsonPath("$.updatedAt").value(updatedAt));

		assertThat(pageVisitRepository.count()).isEqualTo(1);
		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getActiveDurationMs())
			.isEqualTo(5000);
	}

	@Test
	void 밀리초_이하만_다른_방문시각은_같은_원본으로_본다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());

		String body = visitJson(visitId, 1, "제목").replace(VISITED_AT, "2026-10-13T01:23:45.678999Z");
		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isOk());
	}

	@Test
	void 같은_방문ID에_다른_원본정보가_오면_409이다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());

		saveVisit(sessionId, visitId, 1, "다른 제목")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VISIT_ID_CONFLICT"))
			.andExpect(jsonPath("$.fieldErrors").isEmpty());
		saveVisit(sessionId, visitId, 2, "제목")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VISIT_ID_CONFLICT"));

		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getTitle()).isEqualTo("제목");
	}

	@Test
	void 같은_방문ID를_다른_세션에_보내면_404이다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());

		saveVisit(newSession(), visitId, 1, "제목")
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("VISIT_NOT_FOUND"));
	}

	@Test
	void 같은_세션의_순서에_다른_방문ID가_오면_409이다() throws Exception {
		saveVisit(sessionId, UUID.randomUUID().toString(), 1, "제목").andExpect(status().isCreated());

		saveVisit(sessionId, UUID.randomUUID().toString(), 1, "제목")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VISIT_SEQUENCE_CONFLICT"));

		// 다른 세션에서는 같은 순서를 쓸 수 있다
		saveVisit(newSession(), UUID.randomUUID().toString(), 1, "제목").andExpect(status().isCreated());
		assertThat(pageVisitRepository.count()).isEqualTo(2);
	}

	@Test
	void 종료된_세션에는_새_방문을_저장하지_않고_재전송은_기존_결과를_반환한다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());
		endSession(sessionId);

		saveVisit(sessionId, UUID.randomUUID().toString(), 2, "제목")
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("SESSION_ENDED"));
		saveVisit(sessionId, visitId, 1, "제목")
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.visitId").value(visitId));

		assertThat(pageVisitRepository.count()).isEqualTo(1);
	}

	@Test
	void 종료된_세션의_행동_갱신은_409이고_값이_바뀌지_않는다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());
		endSession(sessionId);

		patchBehavior(sessionId, visitId, 1000, 1, 1)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("SESSION_ENDED"));

		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getBehaviorVersion()).isZero();
	}

	@Test
	void 존재하지_않는_세션은_404이다() throws Exception {
		UUID unknown = UUID.randomUUID();
		saveVisit(unknown, UUID.randomUUID().toString(), 1, "제목")
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
		patchBehavior(unknown, UUID.randomUUID().toString(), 0, 0, 1)
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
		mockMvc.perform(get(visitsUrl(unknown)))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
	}

	@Test
	void 다른_세션의_방문이나_없는_방문을_갱신하면_404이다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());

		patchBehavior(newSession(), visitId, 1000, 1, 1)
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("VISIT_NOT_FOUND"));
		patchBehavior(sessionId, UUID.randomUUID().toString(), 1000, 1, 1)
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("VISIT_NOT_FOUND"));

		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getBehaviorVersion()).isZero();
	}

	@Test
	void 행동_정보는_버전에_따라_처리된다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());

		patchBehavior(sessionId, visitId, 3000, 1, 2)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.visitId").value(visitId))
			.andExpect(jsonPath("$.activeDurationMs").value(3000))
			.andExpect(jsonPath("$.tabSwitchCount").value(1))
			.andExpect(jsonPath("$.behaviorVersion").value(2))
			.andExpect(jsonPath("$.updatedAt", matchesPattern(ISO_MILLIS_UTC)))
			.andExpect(jsonPath("$.applied").value(true));

		// 낮은 버전: 무시하고 현재 값 반환
		patchBehavior(sessionId, visitId, 1000, 0, 1)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.activeDurationMs").value(3000))
			.andExpect(jsonPath("$.behaviorVersion").value(2))
			.andExpect(jsonPath("$.applied").value(false));

		// 같은 버전·같은 값: 변경 없음
		patchBehavior(sessionId, visitId, 3000, 1, 2)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.applied").value(false));

		// 같은 버전·다른 값
		patchBehavior(sessionId, visitId, 3500, 1, 2)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("BEHAVIOR_VERSION_CONFLICT"));

		// 높은 버전에서 누적값 감소
		patchBehavior(sessionId, visitId, 2999, 1, 3)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("BEHAVIOR_COUNTER_DECREASED"));
		patchBehavior(sessionId, visitId, 3000, 0, 3)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("BEHAVIOR_COUNTER_DECREASED"));

		// 높은 버전·감소 없음 (같은 값 유지도 허용)
		patchBehavior(sessionId, visitId, 3000, 1, 3)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.behaviorVersion").value(3))
			.andExpect(jsonPath("$.applied").value(true));

		PageVisit saved = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(saved.getActiveDurationMs()).isEqualTo(3000);
		assertThat(saved.getTabSwitchCount()).isEqualTo(1);
		assertThat(saved.getBehaviorVersion()).isEqualTo(3);
		assertThat(saved.getUpdatedAt()).isNotNull();
	}

	@Test
	void 목록은_순서_오름차순으로_페이지_단위로_조회되고_content는_제외된다() throws Exception {
		for (int sequence : new int[] {3, 1, 2}) {
			saveVisit(sessionId, UUID.randomUUID().toString(), sequence, "제목 " + sequence).andExpect(status().isCreated());
		}
		saveVisit(newSession(), UUID.randomUUID().toString(), 1, "다른 세션").andExpect(status().isCreated());

		String firstPage = mockMvc.perform(get(visitsUrl(sessionId)).param("size", "2"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items[*].sequence", contains(1, 2)))
			.andExpect(jsonPath("$.items[0].title").value("제목 1"))
			.andExpect(jsonPath("$.items[0].visitedAt").value(VISITED_AT))
			.andExpect(jsonPath("$.items[0].isSearchResultPage").value(false))
			.andExpect(jsonPath("$.page").value(0))
			.andExpect(jsonPath("$.size").value(2))
			.andExpect(jsonPath("$.totalElements").value(3))
			.andExpect(jsonPath("$.hasNext").value(true))
			.andReturn().getResponse().getContentAsString();
		assertThat(firstPage).doesNotContain("\"content\"");

		mockMvc.perform(get(visitsUrl(sessionId)).param("page", "1").param("size", "2"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items[*].sequence", contains(3)))
			.andExpect(jsonPath("$.hasNext").value(false));

		mockMvc.perform(get(visitsUrl(sessionId)))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(3))
			.andExpect(jsonPath("$.page").value(0))
			.andExpect(jsonPath("$.size").value(20));
	}

	@Test
	void 기록이_없으면_빈_목록을_반환한다() throws Exception {
		mockMvc.perform(get(visitsUrl(sessionId)))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty())
			.andExpect(jsonPath("$.totalElements").value(0))
			.andExpect(jsonPath("$.hasNext").value(false));
	}

	@ParameterizedTest
	@ValueSource(strings = {"page=-1", "size=0", "size=101", "page=abc", "size=abc", "page=2147483647"})
	void 잘못된_페이지네이션은_400이다(String query) throws Exception {
		mockMvc.perform(get(visitsUrl(sessionId) + "?" + query))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
	}

	@ParameterizedTest
	@ValueSource(strings = {
		"\"visitId\": \"%s\",", // visitId 누락
		"\"sequence\": 1,", // sequence 누락
		"\"browserTabKey\": \"tab-1\",", // browserTabKey 누락
		"\"activeDurationMs\": 1000,", // activeDurationMs 누락
		", \"visitedAt\": \"" + VISITED_AT + "\"", // visitedAt 누락 (마지막 필드)
	})
	void 필수값이_없으면_400이고_저장하지_않는다(String removed) throws Exception {
		String visitId = UUID.randomUUID().toString();
		String body = visitJson(visitId, 1, "제목").replace(removed.formatted(visitId), "");

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors[0].field").isString());

		assertThat(pageVisitRepository.count()).isZero();
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
		"visitId|\"1-1-1-1-1\"",
		"sequence|0",
		"normalizedUrl|\"ftp://example.com\"",
		"activeDurationMs|-1",
		"activeDurationMs|0",
		"activeDurationMs|999",
		"activeDurationMs|null",
		"tabSwitchCount|-1",
		"behaviorVersion|-1",
	})
	void 잘못된_값이면_400이다(String field, String value) throws Exception {
		String body = withField(visitJson(UUID.randomUUID().toString(), 1, "제목"), field, value);

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors[0].field").value(field));

		assertThat(pageVisitRepository.count()).isZero();
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
		"https://example.com/docs/JWT|example.com",
		"HTTPS://example.com|example.com",
		"Http://example.com/Path/Upper|example.com",
		"https://docs.spring.io:8443/a/b|docs.spring.io",
		"http://example.com:443/|example.com",
		"https://example.com:80/|example.com",
		"http://127.0.0.1/x|127.0.0.1",
		"http://[::1]:8080/|[::1]",
		"https://xn--3e0b707e.kr/|xn--3e0b707e.kr",
	})
	void 정규화된_주소는_허용하고_그대로_저장한다(String url, String domain) throws Exception {
		String visitId = UUID.randomUUID().toString();
		String body = withField(withField(visitJson(visitId, 1, "제목"), "normalizedUrl", "\"" + url + "\""),
			"domain", "\"" + domain + "\"");

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.normalizedUrl").value(url))
			.andExpect(jsonPath("$.domain").value(domain));

		PageVisit saved = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(saved.getNormalizedUrl()).isEqualTo(url);
		assertThat(saved.getDomain()).isEqualTo(domain);
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
		"https://docs.spring.io/a|spring.io",
		"https://spring.io/a|docs.spring.io",
		"https://www.example.com/|example.com",
		"https://docs.spring.io:8443/a|docs.spring.io:8443",
		"https://docs.spring.io/a|Docs.spring.io",
		"https://docs.spring.io/a|docs.spring.io.",
		"https://docs.spring.io/a|other.com",
		"http://[::1]:8080/|::1",
	})
	void 도메인이_주소의_호스트명과_다르면_400이다(String url, String domain) throws Exception {
		String body = withField(withField(visitJson(UUID.randomUUID().toString(), 1, "제목"), "normalizedUrl", "\"" + url + "\""),
			"domain", "\"" + domain + "\"");

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors.length()").value(1))
			.andExpect(jsonPath("$.fieldErrors[0].field").value("domain"))
			.andExpect(jsonPath("$.fieldErrors[0].message").value("도메인은 페이지 주소의 호스트명과 같아야 합니다."));

		assertThat(pageVisitRepository.count()).isZero();
	}

	@Test
	void 같은_방문을_다른_도메인으로_재전송하면_검증에서_400이다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON)
				.content(withField(visitJson(visitId, 1, "제목"), "domain", "\"other.com\"")))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.fieldErrors[0].field").value("domain"));

		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getDomain()).isEqualTo("example.com");
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
		"https:///path|페이지 주소는 호스트가 있는 http 또는 https 주소여야 합니다.",
		"https://|페이지 주소의 형식이 올바르지 않습니다.",
		"http://:80/path|페이지 주소는 호스트가 있는 http 또는 https 주소여야 합니다.",
		"https:example.com|페이지 주소는 호스트가 있는 http 또는 https 주소여야 합니다.",
		"example.com|페이지 주소는 호스트가 있는 http 또는 https 주소여야 합니다.",
		"/relative/path|페이지 주소는 호스트가 있는 http 또는 https 주소여야 합니다.",
		"ftp://example.com|페이지 주소는 호스트가 있는 http 또는 https 주소여야 합니다.",
		"javascript://example.com|페이지 주소는 호스트가 있는 http 또는 https 주소여야 합니다.",
		"https://exa mple.com|페이지 주소의 형식이 올바르지 않습니다.",
		"https://example.com/a b|페이지 주소의 형식이 올바르지 않습니다.",
		"https://[::1/|페이지 주소의 형식이 올바르지 않습니다.",
		"https://Example.com/docs|페이지 주소의 호스트는 소문자여야 합니다.",
		"https://EXAMPLE.COM|페이지 주소의 호스트는 소문자여야 합니다.",
		"http://[::A]/|페이지 주소의 호스트는 소문자여야 합니다.",
		"https://example.com:443/docs|페이지 주소에서 기본 포트를 제거해야 합니다.",
		"HTTPS://example.com:443/|페이지 주소에서 기본 포트를 제거해야 합니다.",
		"http://example.com:80/docs|페이지 주소에서 기본 포트를 제거해야 합니다.",
		"https://example.com:/docs|페이지 주소에서 기본 포트를 제거해야 합니다.",
		"https://example.com/docs?ref=home|페이지 주소에서 Query와 Fragment를 제거해야 합니다.",
		"https://example.com/docs#intro|페이지 주소에서 Query와 Fragment를 제거해야 합니다.",
		"https://example.com/docs?|페이지 주소에서 Query와 Fragment를 제거해야 합니다.",
		"https://example.com/docs#|페이지 주소에서 Query와 Fragment를 제거해야 합니다.",
		"https://Example.com:443/docs/JWT?ref=home#intro|페이지 주소의 호스트는 소문자여야 합니다.",
		"https://user@example.com/|페이지 주소에 인증정보를 포함할 수 없습니다.",
		"https://user:pw@example.com/|페이지 주소에 인증정보를 포함할 수 없습니다.",
	})
	void 정규화되지_않았거나_잘못된_주소는_400이다(String url, String message) throws Exception {
		String body = withField(visitJson(UUID.randomUUID().toString(), 1, "제목"), "normalizedUrl", "\"" + url + "\"");

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors.length()").value(1))
			.andExpect(jsonPath("$.fieldErrors[0].field").value("normalizedUrl"))
			.andExpect(jsonPath("$.fieldErrors[0].message").value(message));

		assertThat(pageVisitRepository.count()).isZero();
	}

	@Test
	void 주소의_대소문자가_다르면_재전송이_아닌_다른_원본으로_본다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		String original = withField(visitJson(visitId, 1, "제목"), "normalizedUrl", "\"https://example.com/Path\"");
		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(original))
			.andExpect(status().isCreated());

		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON).content(original))
			.andExpect(status().isOk());
		mockMvc.perform(post(visitsUrl(sessionId)).contentType(MediaType.APPLICATION_JSON)
				.content(original.replace("/Path", "/path")))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VISIT_ID_CONFLICT"));
	}

	@Test
	void 잘못된_UUID_경로는_400이다() throws Exception {
		saveVisit("not-a-uuid", UUID.randomUUID().toString())
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		mockMvc.perform(patch("/api/sessions/{sessionId}/visits/{visitId}/behavior", sessionId, "1-1-1-1-1")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"activeDurationMs\": 0, \"tabSwitchCount\": 0, \"behaviorVersion\": 1}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		mockMvc.perform(get("/api/sessions/{sessionId}/visits", "1-1-1-1-1"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
	}

	@ParameterizedTest
	@ValueSource(strings = {
		"{\"tabSwitchCount\": 0, \"behaviorVersion\": 1}",
		"{\"activeDurationMs\": 0, \"behaviorVersion\": 1}",
		"{\"activeDurationMs\": 0, \"tabSwitchCount\": 0}",
		"{\"activeDurationMs\": -1, \"tabSwitchCount\": 0, \"behaviorVersion\": 1}",
		"{\"activeDurationMs\": 0, \"tabSwitchCount\": -1, \"behaviorVersion\": 1}",
		"{\"activeDurationMs\": 0, \"tabSwitchCount\": 0, \"behaviorVersion\": -1}",
	})
	void 행동_정보_필수값_누락이나_음수는_400이다(String body) throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());

		mockMvc.perform(patch("/api/sessions/{sessionId}/visits/{visitId}/behavior", sessionId, visitId)
				.contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors[0].field").isString());
	}

	@Test
	void 같은_방문을_동시에_저장해도_하나만_저장된다() throws Exception {
		String visitId = UUID.randomUUID().toString();

		List<MockHttpServletResponse> responses = runConcurrently(8,
			i -> saveVisit(sessionId, visitId, 1, "제목").andReturn().getResponse());

		assertThat(responses).extracting(MockHttpServletResponse::getStatus).containsOnly(201, 200);
		assertThat(responses).filteredOn(r -> r.getStatus() == 201).hasSize(1);
		for (MockHttpServletResponse response : responses) {
			assertThat((String) JsonPath.read(response.getContentAsString(), "$.visitId")).isEqualTo(visitId);
		}
		assertThat(pageVisitRepository.count()).isEqualTo(1);
	}

	@Test
	void 같은_순서에_다른_방문을_동시에_저장하면_하나만_저장되고_나머지는_409이다() throws Exception {
		List<MockHttpServletResponse> responses = runConcurrently(8,
			i -> saveVisit(sessionId, UUID.randomUUID().toString(), 1, "제목").andReturn().getResponse());

		assertThat(responses).filteredOn(r -> r.getStatus() == 201).hasSize(1);
		for (MockHttpServletResponse response : responses) {
			if (response.getStatus() != 201) {
				assertThat(response.getStatus()).isEqualTo(409);
				assertThat((String) JsonPath.read(response.getContentAsString(), "$.code"))
					.isEqualTo("VISIT_SEQUENCE_CONFLICT");
			}
		}
		assertThat(pageVisitRepository.count()).isEqualTo(1);
	}

	@Test
	void 행동_정보를_동시에_갱신해도_가장_높은_버전의_값이_남는다() throws Exception {
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1, "제목").andExpect(status().isCreated());
		List<Integer> versions = new ArrayList<>();
		for (int version = 1; version <= 10; version++) {
			versions.add(version);
		}
		Collections.shuffle(versions);

		List<MockHttpServletResponse> responses = runConcurrently(versions.size(), i -> {
			int version = versions.get(i);
			return patchBehavior(sessionId, visitId, version * 1000L, version, version).andReturn().getResponse();
		});

		assertThat(responses).extracting(MockHttpServletResponse::getStatus).containsOnly(200);
		PageVisit saved = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(saved.getBehaviorVersion()).isEqualTo(10);
		assertThat(saved.getActiveDurationMs()).isEqualTo(10_000);
		assertThat(saved.getTabSwitchCount()).isEqualTo(10);
	}

	private interface IndexedTask<T> {
		T run(int index) throws Exception;
	}

	private <T> List<T> runConcurrently(int count, IndexedTask<T> task) throws Exception {
		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(count);
		try {
			List<Future<T>> futures = new ArrayList<>();
			for (int i = 0; i < count; i++) {
				int index = i;
				Callable<T> callable = () -> {
					ready.await();
					return task.run(index);
				};
				futures.add(executor.submit(callable));
			}
			ready.countDown();
			List<T> results = new ArrayList<>();
			for (Future<T> future : futures) {
				results.add(future.get());
			}
			return results;
		} finally {
			executor.shutdown();
		}
	}

	private UUID newSession() {
		return workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start("방문 기록 테스트", null)).getSessionId();
	}

	private void endSession(UUID id) throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/end", id)).andExpect(status().isOk());
	}

	private static String visitsUrl(UUID id) {
		return "/api/sessions/" + id + "/visits";
	}

	private static String visitJson(String visitId, int sequence, String title) {
		return """
			{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
			"domain": "example.com", "title": "%s", "content": "본문", "activeDurationMs": 1000, "visitedAt": "%s"}"""
			.formatted(visitId, sequence, sequence, title, VISITED_AT);
	}

	// 기존 필드를 지우고 지정한 값으로 다시 넣는다
	private static String withField(String json, String field, String value) {
		String removed = json.replaceFirst("\"" + field + "\": (\"[^\"]*\"|[^,}]+), ", "");
		return "{\"" + field + "\": " + value + ", " + removed.substring(1);
	}

	private ResultActions saveVisit(UUID session, String visitId, int sequence,
		String title) throws Exception {
		return mockMvc.perform(post(visitsUrl(session))
			.contentType(MediaType.APPLICATION_JSON)
			.content(visitJson(visitId, sequence, title)));
	}

	private ResultActions saveVisit(String session, String visitId) throws Exception {
		return mockMvc.perform(post("/api/sessions/{sessionId}/visits", session)
			.contentType(MediaType.APPLICATION_JSON)
			.content(visitJson(visitId, 1, "제목")));
	}

	private ResultActions patchBehavior(UUID session, String visitId,
		long activeDurationMs, int tabSwitchCount, long behaviorVersion) throws Exception {
		return mockMvc.perform(patch("/api/sessions/{sessionId}/visits/{visitId}/behavior", session, visitId)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"activeDurationMs\": %d, \"tabSwitchCount\": %d, \"behaviorVersion\": %d}"
				.formatted(activeDurationMs, tabSwitchCount, behaviorVersion)));
	}
}
