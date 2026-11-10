package com.focusrecovery.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
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
import com.focusrecovery.domain.session.entity.WorkSessionStatus;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.entity.PageVisit;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.jayway.jsonpath.JsonPath;

@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class WorkSessionEndApiTest {

	private static final String ISO_MILLIS_UTC = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z";

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

	@BeforeEach
	void setUp() {
		alertCandidateTaskRepository.deleteAll();
		notificationRepository.deleteAll();
		analysisResultRepository.deleteAll();
		analysisWindowRepository.deleteAll();
		pageVisitRepository.deleteAll();
		workSessionRepository.deleteAll();
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
	void 진행중인_세션을_종료하면_200과_ENDED_상태를_반환하고_다른_값은_유지한다() throws Exception {
		String created = mockMvc.perform(post("/api/sessions")
				.header("Idempotency-Key", "end-key")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"세션 종료 테스트\"}"))
			.andExpect(status().isCreated())
			.andReturn().getResponse().getContentAsString();
		String sessionId = JsonPath.read(created, "$.sessionId");
		String startedAt = JsonPath.read(created, "$.startedAt");
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId, visitId, 1).andExpect(status().isCreated());

		Instant before = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		String ended = mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.sessionId").value(sessionId))
			.andExpect(jsonPath("$.goalText").value("세션 종료 테스트"))
			.andExpect(jsonPath("$.status").value("ENDED"))
			.andExpect(jsonPath("$.startedAt").value(startedAt))
			.andExpect(jsonPath("$.endedAt", matchesPattern(ISO_MILLIS_UTC)))
			.andReturn().getResponse().getContentAsString();
		Instant after = Instant.now();
		Instant endedAt = Instant.parse(JsonPath.read(ended, "$.endedAt"));
		assertThat(endedAt).isBetween(before, after);

		WorkSession saved = workSessionRepository.findById(UUID.fromString(sessionId)).orElseThrow();
		assertThat(saved.getStatus()).isEqualTo(WorkSessionStatus.ENDED);
		assertThat(saved.getEndedAt()).isEqualTo(endedAt);
		assertThat(saved.getStartedAt()).isEqualTo(Instant.parse(startedAt));
		assertThat(saved.getGoalText()).isEqualTo("세션 종료 테스트");
		assertThat(saved.getIdempotencyKey()).isEqualTo(com.focusrecovery.domain.identity.AuthenticationService.digest(com.focusrecovery.support.SyntheticIdentities.ALICE + ":end-key"));
		assertThat(pageVisitRepository.existsById(UUID.fromString(visitId))).isTrue();

		String found = mockMvc.perform(get("/api/sessions/{sessionId}", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("ENDED"))
			.andExpect(jsonPath("$.endedAt", matchesPattern(ISO_MILLIS_UTC)))
			.andReturn().getResponse().getContentAsString();
		assertThat(Instant.parse(JsonPath.read(found, "$.endedAt"))).isEqualTo(endedAt);
	}

	// Instant.toString()은 밀리초가 0이면 ".000"을 생략하므로 응답 문자열은 Instant로 파싱해서 비교한다
	@Test
	void 종료시각의_밀리초가_000이어도_밀리초_형식으로_응답한다() throws Exception {
		Instant endedAt = Instant.parse("2026-10-14T01:02:03.000Z");
		WorkSession session = com.focusrecovery.support.SyntheticIdentities.start("밀리초 0 테스트", null);
		session.end(endedAt);
		UUID sessionId = workSessionRepository.save(session).getSessionId();

		// 이미 종료된 세션이므로 종료 API도 저장된 종료 시각을 그대로 반환한다
		for (ResultActions result : List.of(endSession(sessionId), mockMvc.perform(get("/api/sessions/{sessionId}", sessionId)))) {
			String json = endedAt(result.andExpect(status().isOk())
				.andExpect(jsonPath("$.endedAt").value("2026-10-14T01:02:03.000Z")));
			assertThat(Instant.parse(json)).isEqualTo(endedAt);
		}
		assertThat(workSessionRepository.findById(sessionId).orElseThrow().getEndedAt()).isEqualTo(endedAt);
	}

	@Test
	void 이미_종료된_세션을_다시_종료하면_200이고_최초_종료시각을_유지한다() throws Exception {
		UUID sessionId = newSession();
		String firstEndedAt = endedAt(endSession(sessionId).andExpect(status().isOk()));
		Thread.sleep(5);

		String secondEndedAt = endedAt(endSession(sessionId)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("ENDED")));
		assertThat(Instant.parse(secondEndedAt)).isEqualTo(Instant.parse(firstEndedAt));

		assertThat(workSessionRepository.findById(sessionId).orElseThrow().getEndedAt())
			.isEqualTo(Instant.parse(firstEndedAt));
	}

	@Test
	void 종료_후_같은_키로_생성을_재요청하면_종료된_세션을_그대로_반환한다() throws Exception {
		String body = mockMvc.perform(post("/api/sessions")
				.header("Idempotency-Key", "retry-key")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"재요청 테스트\"}"))
			.andReturn().getResponse().getContentAsString();
		String sessionId = JsonPath.read(body, "$.sessionId");
		String endedAt = endedAt(endSession(UUID.fromString(sessionId)));

		String replayed = endedAt(mockMvc.perform(post("/api/sessions")
				.header("Idempotency-Key", "retry-key")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"재요청 테스트\"}"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.sessionId").value(sessionId))
			.andExpect(jsonPath("$.status").value("ENDED")));
		assertThat(Instant.parse(replayed)).isEqualTo(Instant.parse(endedAt));
		assertThat(workSessionRepository.count()).isEqualTo(1);
	}

	@ParameterizedTest
	@ValueSource(strings = {"", "{}", "{\"finalBehaviors\": null}", "{\"finalBehaviors\": []}"})
	void 최종_행동정보가_없으면_종료만_처리한다(String body) throws Exception {
		UUID sessionId = newSession();
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId.toString(), visitId, 1).andExpect(status().isCreated());

		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)
				.contentType(MediaType.APPLICATION_JSON)
				.content(body))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("ENDED"));

		PageVisit visit = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(visit.getBehaviorVersion()).isZero();
		assertThat(visit.getUpdatedAt()).isNull();
	}

	@Test
	void 최종_행동정보를_PATCH와_같은_규칙으로_반영하고_종료한다() throws Exception {
		UUID sessionId = newSession();
		String newer = UUID.randomUUID().toString();
		String older = UUID.randomUUID().toString();
		String same = UUID.randomUUID().toString();
		saveVisit(sessionId.toString(), newer, 1).andExpect(status().isCreated());
		saveVisit(sessionId.toString(), older, 2).andExpect(status().isCreated());
		saveVisit(sessionId.toString(), same, 3).andExpect(status().isCreated());
		patchBehavior(sessionId, newer, 2000, 1, 1).andExpect(jsonPath("$.applied").value(true));
		patchBehavior(sessionId, older, 5000, 3, 5).andExpect(jsonPath("$.applied").value(true));
		patchBehavior(sessionId, same, 3000, 2, 2).andExpect(jsonPath("$.applied").value(true));

		Instant endedAt = Instant.parse(endedAt(endSession(sessionId, behavior(newer, 9000, 4, 2),
			behavior(older, 1000, 0, 4), behavior(same, 3000, 2, 2))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("ENDED"))));

		PageVisit applied = pageVisitRepository.findById(UUID.fromString(newer)).orElseThrow();
		assertThat(applied.getActiveDurationMs()).isEqualTo(9000);
		assertThat(applied.getTabSwitchCount()).isEqualTo(4);
		assertThat(applied.getBehaviorVersion()).isEqualTo(2);
		assertThat(applied.getUpdatedAt()).isEqualTo(endedAt);
		PageVisit ignored = pageVisitRepository.findById(UUID.fromString(older)).orElseThrow();
		assertThat(ignored.getActiveDurationMs()).isEqualTo(5000);
		assertThat(ignored.getBehaviorVersion()).isEqualTo(5);
		assertThat(pageVisitRepository.findById(UUID.fromString(same)).orElseThrow().getBehaviorVersion()).isEqualTo(2);
	}

	@Test
	void 최종_행동정보_하나라도_실패하면_행동정보와_종료_모두_반영하지_않는다() throws Exception {
		UUID sessionId = newSession();
		UUID otherSessionId = newSession();
		String visitId = UUID.randomUUID().toString();
		String decreasing = UUID.randomUUID().toString();
		String otherVisitId = UUID.randomUUID().toString();
		saveVisit(sessionId.toString(), visitId, 1).andExpect(status().isCreated());
		saveVisit(sessionId.toString(), decreasing, 2).andExpect(status().isCreated());
		saveVisit(otherSessionId.toString(), otherVisitId, 1).andExpect(status().isCreated());
		patchBehavior(sessionId, decreasing, 5000, 3, 1).andExpect(jsonPath("$.applied").value(true));
		patchBehavior(sessionId, visitId, 2000, 1, 1).andExpect(jsonPath("$.applied").value(true));

		endSession(sessionId, behavior(visitId, 9000, 4, 2), behavior(decreasing, 4000, 3, 2))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("BEHAVIOR_COUNTER_DECREASED"));
		endSession(sessionId, behavior(visitId, 9000, 4, 2), behavior(decreasing, 6000, 3, 1))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("BEHAVIOR_VERSION_CONFLICT"));
		endSession(sessionId, behavior(visitId, 9000, 4, 2), behavior(otherVisitId, 9000, 4, 2))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("VISIT_NOT_FOUND"));
		endSession(sessionId, behavior(visitId, 9000, 4, 2), behavior(UUID.randomUUID().toString(), 9000, 4, 2))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("VISIT_NOT_FOUND"));

		WorkSession session = workSessionRepository.findById(sessionId).orElseThrow();
		assertThat(session.getStatus()).isEqualTo(WorkSessionStatus.ACTIVE);
		assertThat(session.getEndedAt()).isNull();
		PageVisit visit = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(visit.getActiveDurationMs()).isEqualTo(2000);
		assertThat(visit.getBehaviorVersion()).isEqualTo(1);
		assertThat(pageVisitRepository.findById(UUID.fromString(otherVisitId)).orElseThrow().getBehaviorVersion()).isZero();

		endSession(sessionId, behavior(visitId, 9000, 4, 2)).andExpect(status().isOk());
		assertThat(pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow().getBehaviorVersion()).isEqualTo(2);
	}

	@ParameterizedTest
	@ValueSource(strings = {
		"{\"finalBehaviors\": [null]}",
		"{\"finalBehaviors\": [{\"visitId\": \"not-a-uuid\", \"activeDurationMs\": 1, \"tabSwitchCount\": 0, \"behaviorVersion\": 1}]}",
		"{\"finalBehaviors\": [{\"visitId\": \"%s\", \"activeDurationMs\": -1, \"tabSwitchCount\": 0, \"behaviorVersion\": 1}]}",
		"{\"finalBehaviors\": [{\"visitId\": \"%s\", \"tabSwitchCount\": 0, \"behaviorVersion\": 1}]}",
		"{\"finalBehaviors\": [{\"activeDurationMs\": 1, \"tabSwitchCount\": 0, \"behaviorVersion\": 1}]}"
	})
	void 최종_행동정보_형식이_잘못되면_400이고_종료하지_않는다(String body) throws Exception {
		UUID sessionId = newSession();
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId.toString(), visitId, 1).andExpect(status().isCreated());

		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)
				.contentType(MediaType.APPLICATION_JSON)
				.content(body.formatted(visitId)))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors[0].field").value(matchesPattern("finalBehaviors\\[0\\].*")));

		assertThat(workSessionRepository.findById(sessionId).orElseThrow().getStatus()).isEqualTo(WorkSessionStatus.ACTIVE);
	}

	@Test
	void 이미_종료된_세션은_최종_행동정보를_반영하지_않고_최초_종료결과를_반환한다() throws Exception {
		UUID sessionId = newSession();
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId.toString(), visitId, 1).andExpect(status().isCreated());
		Instant firstEndedAt = Instant.parse(endedAt(endSession(sessionId, behavior(visitId, 2000, 1, 1))));
		Thread.sleep(5);

		Instant secondEndedAt = Instant.parse(endedAt(endSession(sessionId, behavior(visitId, 9000, 4, 2))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("ENDED"))));
		endSession(sessionId, behavior(visitId, 0, 0, 1)).andExpect(status().isOk());

		assertThat(secondEndedAt).isEqualTo(firstEndedAt);
		assertThat(workSessionRepository.findById(sessionId).orElseThrow().getEndedAt()).isEqualTo(firstEndedAt);
		PageVisit visit = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(visit.getActiveDurationMs()).isEqualTo(2000);
		assertThat(visit.getBehaviorVersion()).isEqualTo(1);
	}

	@ParameterizedTest
	@ValueSource(strings = {"not-a-uuid", "1-1-1-1-1", "123e4567e89b12d3a456426614174000"})
	void 잘못된_UUID는_400이다(String sessionId) throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors").isEmpty());
	}

	@Test
	void 존재하지_않는_세션은_404이다() throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/end", UUID.randomUUID()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"))
			.andExpect(jsonPath("$.fieldErrors").isEmpty());
	}

	@Test
	void 종료_API_호출_후_새_방문과_행동갱신은_409이고_재전송과_조회는_가능하다() throws Exception {
		UUID sessionId = newSession();
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId.toString(), visitId, 1).andExpect(status().isCreated());
		patchBehavior(sessionId, visitId, 2000, 1, 1).andExpect(jsonPath("$.applied").value(true));
		endSession(sessionId).andExpect(status().isOk());

		saveVisit(sessionId.toString(), UUID.randomUUID().toString(), 2)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("SESSION_ENDED"));
		patchBehavior(sessionId, visitId, 3000, 2, 2)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("SESSION_ENDED"));
		saveVisit(sessionId.toString(), visitId, 1)
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.visitId").value(visitId))
			.andExpect(jsonPath("$.activeDurationMs").value(2000))
			.andExpect(jsonPath("$.behaviorVersion").value(1));
		mockMvc.perform(get("/api/sessions/{sessionId}/visits", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(1))
			.andExpect(jsonPath("$.items[0].visitId").value(visitId));

		PageVisit visit = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(visit.getActiveDurationMs()).isEqualTo(2000);
		assertThat(visit.getBehaviorVersion()).isEqualTo(1);
		assertThat(pageVisitRepository.count()).isEqualTo(1);
	}

	@Test
	void 동시에_종료해도_모두_같은_최초_종료시각을_반환한다() throws Exception {
		UUID sessionId = newSession();

		List<MockHttpServletResponse> responses = runConcurrently(8, i -> endSession(sessionId).andReturn().getResponse());

		assertThat(responses).extracting(MockHttpServletResponse::getStatus).containsOnly(200);
		Instant endedAt = Instant.parse(JsonPath.read(responses.get(0).getContentAsString(), "$.endedAt"));
		for (MockHttpServletResponse response : responses) {
			assertThat(Instant.parse(JsonPath.read(response.getContentAsString(), "$.endedAt"))).isEqualTo(endedAt);
		}
		assertThat(workSessionRepository.findById(sessionId).orElseThrow().getEndedAt()).isEqualTo(endedAt);
	}

	@Test
	void 종료와_방문저장이_동시에_와도_저장된_방문과_201응답이_일치하고_종료후에는_저장되지_않는다() throws Exception {
		UUID sessionId = newSession();

		List<MockHttpServletResponse> responses = runConcurrently(11, i -> i == 0
			? endSession(sessionId).andReturn().getResponse()
			: saveVisit(sessionId.toString(), UUID.randomUUID().toString(), i).andReturn().getResponse());

		assertThat(responses.get(0).getStatus()).isEqualTo(200);
		List<MockHttpServletResponse> saves = responses.subList(1, responses.size());
		long created = saves.stream().filter(r -> r.getStatus() == 201).count();
		// sequence를 순서 없이 동시에 보내므로 구간이 먼저 생기면 앞선 번호는 VISIT_SEQUENCE_OUT_OF_ORDER로 거절될 수 있다(저장 안 됨)
		for (MockHttpServletResponse response : saves) {
			if (response.getStatus() != 201) {
				assertThat(response.getStatus()).isEqualTo(409);
				assertThat((String) JsonPath.read(response.getContentAsString(), "$.code"))
					.isIn("SESSION_ENDED", "VISIT_SEQUENCE_OUT_OF_ORDER");
			}
		}
		assertThat(pageVisitRepository.count()).isEqualTo(created);

		saveVisit(sessionId.toString(), UUID.randomUUID().toString(), 100)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("SESSION_ENDED"));
		assertThat(pageVisitRepository.count()).isEqualTo(created);
	}

	@Test
	void 종료와_행동갱신이_동시에_와도_반영된_갱신만_저장된다() throws Exception {
		UUID sessionId = newSession();
		String visitId = UUID.randomUUID().toString();
		saveVisit(sessionId.toString(), visitId, 1).andExpect(status().isCreated());

		List<MockHttpServletResponse> responses = runConcurrently(11, i -> i == 0
			? endSession(sessionId).andReturn().getResponse()
			: patchBehavior(sessionId, visitId, 1000L + i * 1000L, i, i).andReturn().getResponse());

		assertThat(responses.get(0).getStatus()).isEqualTo(200);
		long maxAppliedVersion = 0;
		for (MockHttpServletResponse response : responses.subList(1, responses.size())) {
			String body = response.getContentAsString();
			if (response.getStatus() == 200) {
				if (JsonPath.<Boolean>read(body, "$.applied")) {
					maxAppliedVersion = Math.max(maxAppliedVersion, ((Number) JsonPath.read(body, "$.behaviorVersion")).longValue());
				}
			} else {
				assertThat(response.getStatus()).isEqualTo(409);
				assertThat((String) JsonPath.read(body, "$.code")).isEqualTo("SESSION_ENDED");
			}
		}

		PageVisit visit = pageVisitRepository.findById(UUID.fromString(visitId)).orElseThrow();
		assertThat(visit.getBehaviorVersion()).isEqualTo(maxAppliedVersion);
		assertThat(visit.getActiveDurationMs()).isEqualTo(1000L + maxAppliedVersion * 1000L);
		patchBehavior(sessionId, visitId, 99_000, 99, 99)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("SESSION_ENDED"));
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
		return workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start("세션 종료 테스트", null)).getSessionId();
	}

	private ResultActions endSession(UUID sessionId) throws Exception {
		return mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId));
	}

	private ResultActions endSession(UUID sessionId, String... finalBehaviors) throws Exception {
		return mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"finalBehaviors\": [" + String.join(",", finalBehaviors) + "]}"));
	}

	private static String behavior(String visitId, long activeDurationMs, int tabSwitchCount, long behaviorVersion) {
		return "{\"visitId\": \"%s\", \"activeDurationMs\": %d, \"tabSwitchCount\": %d, \"behaviorVersion\": %d}"
			.formatted(visitId, activeDurationMs, tabSwitchCount, behaviorVersion);
	}

	private static String endedAt(ResultActions result) throws Exception {
		return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.endedAt");
	}

	private ResultActions saveVisit(String sessionId, String visitId, int sequence) throws Exception {
		return mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
			.contentType(MediaType.APPLICATION_JSON)
			.content("""
				{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
				"domain": "example.com", "title": "제목", "content": "본문", "activeDurationMs": 1000, \
				"visitedAt": "2026-10-13T01:23:45.678Z"}""".formatted(visitId, sequence, sequence)));
	}

	private ResultActions patchBehavior(UUID sessionId, String visitId, long activeDurationMs, int tabSwitchCount,
		long behaviorVersion) throws Exception {
		return mockMvc.perform(patch("/api/sessions/{sessionId}/visits/{visitId}/behavior", sessionId, visitId)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"activeDurationMs\": %d, \"tabSwitchCount\": %d, \"behaviorVersion\": %d}"
				.formatted(activeDurationMs, tabSwitchCount, behaviorVersion)));
	}
}
