package com.focusrecovery.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.entity.WorkSessionStatus;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.jayway.jsonpath.JsonPath;

@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class WorkSessionApiTest {

	private static final String ISO_MILLIS_UTC = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z";

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private WorkSessionRepository workSessionRepository;

	@BeforeEach
	void setUp() {
		workSessionRepository.deleteAll();
	}

	@Test
	void 세션_생성_후_조회하면_저장한_값을_반환한다() throws Exception {
		String body = mockMvc.perform(post("/api/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"  Spring Boot JPA 공부하기  \"}"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.sessionId").isString())
			.andExpect(jsonPath("$.goalText").value("Spring Boot JPA 공부하기"))
			.andExpect(jsonPath("$.status").value("ACTIVE"))
			.andExpect(jsonPath("$.startedAt", matchesPattern(ISO_MILLIS_UTC)))
			.andExpect(jsonPath("$.endedAt").value(nullValue()))
			.andReturn().getResponse().getContentAsString();
		String sessionId = JsonPath.read(body, "$.sessionId");
		String startedAt = JsonPath.read(body, "$.startedAt");

		WorkSession saved = workSessionRepository.findById(UUID.fromString(sessionId)).orElseThrow();
		assertThat(saved.getGoalText()).isEqualTo("Spring Boot JPA 공부하기");
		assertThat(saved.getStatus()).isEqualTo(WorkSessionStatus.ACTIVE);
		assertThat(saved.getStartedAt()).isEqualTo(Instant.parse(startedAt));
		assertThat(saved.getEndedAt()).isNull();

		String found = mockMvc.perform(get("/api/sessions/{id}", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.sessionId").value(sessionId))
			.andExpect(jsonPath("$.goalText").value("Spring Boot JPA 공부하기"))
			.andExpect(jsonPath("$.status").value("ACTIVE"))
			.andExpect(jsonPath("$.startedAt").value(startedAt))
			.andReturn().getResponse().getContentAsString();
		assertThat(found).contains("\"endedAt\":null");
	}

	@Test
	void 같은_목표로_두번_생성하면_서로_다른_세션이다() throws Exception {
		String first = createSession("같은 목표");
		String second = createSession("같은 목표");

		assertThat(first).isNotEqualTo(second);
		assertThat(workSessionRepository.count()).isEqualTo(2);
	}

	@ParameterizedTest
	@ValueSource(strings = {"{\"goalText\": \"\"}", "{\"goalText\": \"   \"}", "{\"goalText\": null}", "{}"})
	void 목표가_비어있으면_400이고_저장하지_않는다(String content) throws Exception {
		mockMvc.perform(post("/api/sessions").contentType(MediaType.APPLICATION_JSON).content(content))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors[0].field").value("goalText"))
			.andExpect(jsonPath("$.fieldErrors[0].message").isString());

		assertThat(workSessionRepository.count()).isZero();
	}

	@ParameterizedTest
	@ValueSource(strings = {"abcde", "  abcde  ", "가나다라마"})
	void 공백_제외_5자이면_생성된다(String goalText) throws Exception {
		mockMvc.perform(post("/api/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"" + goalText + "\"}"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.goalText").value(goalText.strip()));
	}

	@Test
	void 공백_제외_150자이면_생성된다() throws Exception {
		String goalText = "가".repeat(150);
		mockMvc.perform(post("/api/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"  " + goalText + "  \"}"))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.goalText").value(goalText));
	}

	@ParameterizedTest
	@ValueSource(strings = {"abcd", "  abcd  ", "가나다라"})
	void 공백_제외_5자_미만이면_400이다(String goalText) throws Exception {
		assertLengthRejected(goalText);
	}

	@Test
	void 공백_제외_150자_초과이면_400이다() throws Exception {
		assertLengthRejected("가".repeat(151));
	}

	@Test
	void 본문이_없으면_400이다() throws Exception {
		mockMvc.perform(post("/api/sessions").contentType(MediaType.APPLICATION_JSON))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors").isEmpty());

		assertThat(workSessionRepository.count()).isZero();
	}

	@ParameterizedTest
	@ValueSource(strings = {"not-a-uuid", "1-1-1-1-1", "123e4567e89b12d3a456426614174000"})
	void 잘못된_UUID는_400이다(String sessionId) throws Exception {
		mockMvc.perform(get("/api/sessions/{id}", sessionId))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors").isEmpty());
	}

	@Test
	void 존재하지_않는_세션은_404이다() throws Exception {
		mockMvc.perform(get("/api/sessions/{id}", UUID.randomUUID()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"))
			.andExpect(jsonPath("$.fieldErrors").isEmpty());
	}

	@Test
	void 같은_키와_같은_목표로_재요청하면_기존_세션을_반환한다() throws Exception {
		String first = createSession("재시도 목표", "key-1");
		String second = createSession("  재시도 목표 ", "key-1");

		assertThat(second).isEqualTo(first);
		assertThat(workSessionRepository.count()).isEqualTo(1);
	}

	@Test
	void 다른_키로_요청하면_새_세션을_생성한다() throws Exception {
		String first = createSession("같은 목표", "key-1");
		String second = createSession("같은 목표", "key-2");

		assertThat(first).isNotEqualTo(second);
		assertThat(workSessionRepository.count()).isEqualTo(2);
	}

	@Test
	void 같은_키로_다른_목표를_보내면_422이다() throws Exception {
		createSession("원래 목표", "key-1");

		mockMvc.perform(post("/api/sessions")
				.header("Idempotency-Key", "key-1")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"다른 목표\"}"))
			.andExpect(status().isUnprocessableContent())
			.andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_MISMATCH"))
			.andExpect(jsonPath("$.fieldErrors").isEmpty());

		assertThat(workSessionRepository.count()).isEqualTo(1);
	}

	@ParameterizedTest
	@ValueSource(ints = {1, 256})
	void 키가_공백이거나_너무_길면_400이다(int length) throws Exception {
		String key = length == 1 ? " " : "k".repeat(length);
		mockMvc.perform(post("/api/sessions")
				.header("Idempotency-Key", key)
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"길이 검증 목표\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

		assertThat(workSessionRepository.count()).isZero();
	}

	@Test
	void 같은_키로_동시에_요청해도_세션은_하나다() throws Exception {
		int threads = 8;
		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(threads);
		try {
			Callable<String> task = () -> {
				ready.await();
				return createSession("동시 요청", "concurrent-key");
			};
			List<Future<String>> futures = new ArrayList<>();
			for (int i = 0; i < threads; i++) {
				futures.add(executor.submit(task));
			}
			ready.countDown();
			String expected = futures.get(0).get();
			for (Future<String> future : futures) {
				assertThat(future.get()).isEqualTo(expected);
			}
		} finally {
			executor.shutdown();
		}
		assertThat(workSessionRepository.count()).isEqualTo(1);
	}

	private void assertLengthRejected(String goalText) throws Exception {
		mockMvc.perform(post("/api/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"" + goalText + "\"}"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
			.andExpect(jsonPath("$.fieldErrors[0].field").value("goalText"))
			.andExpect(jsonPath("$.fieldErrors[0].message").value("작업 목표는 5자 이상 150자 이하로 입력해 주세요."));

		assertThat(workSessionRepository.count()).isZero();
	}

	private String createSession(String goalText) throws Exception {
		String body = mockMvc.perform(post("/api/sessions")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"" + goalText + "\"}"))
			.andExpect(status().isCreated())
			.andReturn().getResponse().getContentAsString();
		return JsonPath.read(body, "$.sessionId");
	}

	private String createSession(String goalText, String idempotencyKey) throws Exception {
		String body = mockMvc.perform(post("/api/sessions")
				.header("Idempotency-Key", idempotencyKey)
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"goalText\": \"" + goalText + "\"}"))
			.andExpect(status().isCreated())
			.andReturn().getResponse().getContentAsString();
		return JsonPath.read(body, "$.sessionId");
	}
}
