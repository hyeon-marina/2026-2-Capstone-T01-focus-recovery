package com.focusrecovery.domain.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.alert.entity.AlertCandidateTask;
import com.focusrecovery.domain.alert.entity.AlertTaskStatus;
import com.focusrecovery.domain.alert.service.AlertService;
import com.focusrecovery.domain.alert.service.AlertTaskProcessor;
import com.focusrecovery.domain.analysis.client.AiAnalysisOutcome;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.jayway.jsonpath.JsonPath;

// FIXED_INTERVAL 모드(서버 설정) 고정 주기 후보. 예정 시각 startedAt + 10분(잠정) × n의 경계는 Clock을 고정해 검증한다
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "focus-recovery.alert.mode=FIXED_INTERVAL")
class FixedIntervalAlertTest {

	private static final String GOAL = "고정 주기 테스트 목표";
	private static final Duration INTERVAL = Duration.ofMinutes(10);
	private static final DateTimeFormatter MILLIS_UTC =
		DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private AlertService alertService;

	@Autowired
	private AlertTaskProcessor alertTaskProcessor;

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

	@MockitoBean
	private Clock clock;

	private final AtomicReference<Instant> now = new AtomicReference<>();
	private UUID sessionId;
	private Instant startedAt;

	@BeforeEach
	void setUp() {
		cleanUp();
		WorkSession session = workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start(GOAL, null));
		sessionId = session.getSessionId();
		startedAt = session.getStartedAt();
		now.set(startedAt);
		when(clock.instant()).thenAnswer(invocation -> now.get());
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	@Test
	void 첫_후보는_startedAt부터_간격이_지나야_만들고_경계값에서_생성한다() throws Exception {
		now.set(startedAt.plus(INTERVAL).minusMillis(1));
		request(sessionId).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALERT_INTERVAL_NOT_REACHED"));
		assertThat(notificationRepository.count()).isZero();

		now.set(startedAt.plus(INTERVAL));
		request(sessionId).andExpect(status().isCreated())
			.andExpect(jsonPath("$.alertId").isNotEmpty())
			.andExpect(jsonPath("$.sessionId").value(sessionId.toString()))
			.andExpect(jsonPath("$.alertType").value("FIXED_INTERVAL"))
			.andExpect(jsonPath("$.analysisId").value(nullValue()))
			.andExpect(jsonPath("$.windowIndex").value(nullValue()))
			.andExpect(jsonPath("$.goalText").value(GOAL))
			.andExpect(jsonPath("$.message").isNotEmpty())
			.andExpect(jsonPath("$.shownAt").value(nullValue()))
			.andExpect(jsonPath("$.createdAt").value(MILLIS_UTC.format(startedAt.plus(INTERVAL))));
		assertThat(notificationRepository.findAll().getFirst().getShownAt()).isNull();
		assertThat(notificationRepository.findAll().getFirst().getScheduledAt()).isEqualTo(startedAt.plus(INTERVAL));
	}

	@Test
	void 미표시_후보가_있으면_같은_alertId를_200으로_반환하고_상태_조회의_alert로_제공한다() throws Exception {
		now.set(startedAt.plus(INTERVAL));
		String alertId = alertId(request(sessionId).andExpect(status().isCreated()));
		// 같은 회차(10분 회차) 안의 재요청
		now.set(startedAt.plus(Duration.ofMinutes(19)));

		request(sessionId).andExpect(status().isOk()).andExpect(jsonPath("$.alertId").value(alertId));
		mockMvc.perform(post("/api/sessions/{sessionId}/alerts/fixed-interval", sessionId)
				.contentType(MediaType.APPLICATION_JSON).content("{}"))
			.andExpect(status().isOk()).andExpect(jsonPath("$.alertId").value(alertId));
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(alertId))
			.andExpect(jsonPath("$.alert.alertType").value("FIXED_INTERVAL"))
			.andExpect(jsonPath("$.alert.windowIndex").value(nullValue()));
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	// 예정 시각은 startedAt + 10분 × n으로 고정된다. 첫 알림이 12분에 표시돼도 다음 회차는 22분이 아니라 20분이다
	@Test
	void 표시_시각과_무관하게_다음_회차는_시작_시각_기준으로_정해진다() throws Exception {
		now.set(startedAt.plus(INTERVAL));
		String first = alertId(request(sessionId).andExpect(status().isCreated()));
		// 실제 표시 확인 API로 12분에 표시했다고 기록한다
		now.set(startedAt.plus(Duration.ofMinutes(13)));
		mockMvc.perform(patch("/api/sessions/{sessionId}/alerts/{alertId}/shown", sessionId, first)
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"shownAt\":\"" + MILLIS_UTC.format(startedAt.plus(Duration.ofMinutes(12))) + "\"}"))
			.andExpect(status().isOk());

		// 현재 회차(10분)가 이미 표시됐으므로 다음 예정 시각(20분) 전까지 409
		request(sessionId).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALERT_INTERVAL_NOT_REACHED"));
		now.set(startedAt.plus(Duration.ofMinutes(20)).minusMillis(1));
		request(sessionId).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALERT_INTERVAL_NOT_REACHED"));
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));

		now.set(startedAt.plus(Duration.ofMinutes(20)));
		String second = alertId(request(sessionId).andExpect(status().isCreated()));
		assertThat(second).isNotEqualTo(first);
		assertThat(scheduledAt(second)).isEqualTo(startedAt.plus(Duration.ofMinutes(20)));
		assertThat(shownAt(first)).isEqualTo(startedAt.plus(Duration.ofMinutes(12)));
	}

	@Test
	void 중간_회차를_놓쳐도_현재까지_도래한_최신_회차_하나만_만든다() throws Exception {
		now.set(startedAt.plus(Duration.ofMinutes(35)));

		String alertId = alertId(request(sessionId).andExpect(status().isCreated())
			.andExpect(jsonPath("$.createdAt").value(MILLIS_UTC.format(now.get()))));

		assertThat(notificationRepository.count()).isEqualTo(1);
		// 예정 시각(30분)·실제 생성 시각(35분)·표시 시각(없음)을 구분해 저장한다
		assertThat(scheduledAt(alertId)).isEqualTo(startedAt.plus(Duration.ofMinutes(30)));
		assertThat(notificationRepository.findById(UUID.fromString(alertId)).orElseThrow().getCreatedAt()).isEqualTo(now.get());
		assertThat(shownAt(alertId)).isNull();
		now.set(startedAt.plus(Duration.ofMinutes(39)));
		request(sessionId).andExpect(status().isOk()).andExpect(jsonPath("$.alertId").value(alertId));
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	@Test
	void 이전_회차의_미표시_후보는_기록을_남기되_새_회차에서_반환하지_않는다() throws Exception {
		now.set(startedAt.plus(INTERVAL));
		String old = alertId(request(sessionId).andExpect(status().isCreated()));

		now.set(startedAt.plus(Duration.ofMinutes(20)));
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		String current = alertId(request(sessionId).andExpect(status().isCreated()));

		assertThat(current).isNotEqualTo(old);
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(current));
		assertThat(notificationRepository.findById(UUID.fromString(old))).isPresent();
		assertThat(shownAt(old)).isNull();
	}

	// V8 이전에 만든 고정 주기 후보(scheduled_at 없음)는 어느 회차에도 속하지 않으므로 반환·재사용하지 않고 기록은 그대로 둔다
	@Test
	void 회차_정보가_없는_기존_고정_주기_후보는_반환하거나_재사용하지_않는다() throws Exception {
		UUID legacy = UUID.randomUUID();
		jdbcTemplate.update("insert into notification (alert_id, session_id, alert_type, message, created_at) "
				+ "values (?, ?, 'FIXED_INTERVAL', '이전 후보', ?)", legacy.toString(), sessionId.toString(),
			LocalDateTime.ofInstant(startedAt.plus(Duration.ofMinutes(11)), ZoneOffset.UTC));
		now.set(startedAt.plus(Duration.ofMinutes(15)));

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		String created = alertId(request(sessionId).andExpect(status().isCreated()));

		assertThat(created).isNotEqualTo(legacy.toString());
		assertThat(jdbcTemplate.queryForObject("select count(*) from notification where alert_id = ? and scheduled_at is null "
			+ "and shown_at is null", Long.class, legacy.toString())).isEqualTo(1);
	}

	@Test
	void 분석_상태_조회는_고정_주기_후보를_만들거나_바꾸지_않는다() throws Exception {
		now.set(startedAt.plus(INTERVAL));
		request(sessionId).andExpect(status().isCreated());
		now.set(startedAt.plus(Duration.ofMinutes(25)));
		List<java.util.Map<String, Object>> before = jdbcTemplate.queryForList("select * from notification order by alert_id");

		for (int i = 0; i < 3; i++) {
			mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.alert").value(nullValue()));
		}

		assertThat(jdbcTemplate.queryForList("select * from notification order by alert_id")).isEqualTo(before);
	}

	private Instant scheduledAt(String alertId) {
		return notificationRepository.findById(UUID.fromString(alertId)).orElseThrow().getScheduledAt();
	}

	private Instant shownAt(String alertId) {
		return notificationRepository.findById(UUID.fromString(alertId)).orElseThrow().getShownAt();
	}

	@Test
	void 동시에_요청해도_후보는_하나이고_나머지는_같은_alertId를_받는다() throws Exception {
		now.set(startedAt.plus(INTERVAL));
		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(8);
		List<Future<MockHttpServletResponse>> futures = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			futures.add(executor.submit(() -> {
				ready.await();
				return request(sessionId).andReturn().getResponse();
			}));
		}
		ready.countDown();
		List<Integer> statuses = new ArrayList<>();
		List<String> alertIds = new ArrayList<>();
		for (Future<MockHttpServletResponse> future : futures) {
			MockHttpServletResponse response = future.get(10, TimeUnit.SECONDS);
			statuses.add(response.getStatus());
			alertIds.add(JsonPath.read(response.getContentAsString(), "$.alertId"));
		}
		executor.shutdown();

		assertThat(statuses).containsOnlyOnce(201).filteredOn(code -> code != 201).containsOnly(200);
		assertThat(alertIds).containsOnly(alertIds.getFirst());
		assertThat(notificationRepository.count()).isEqualTo(1);

		// 같은 회차가 표시된 뒤 재요청은 409
		markShown(alertIds.getFirst(), now.get());
		request(sessionId).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALERT_INTERVAL_NOT_REACHED"));
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	@Test
	void 종료된_세션은_409_SESSION_ENDED이고_미표시_후보도_반환하지_않는다() throws Exception {
		now.set(startedAt.plus(INTERVAL));
		request(sessionId).andExpect(status().isCreated());
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		request(sessionId).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SESSION_ENDED"));
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	@ParameterizedTest
	@ValueSource(strings = {"not-a-uuid", "1-1-1-1-1"})
	void 잘못된_세션_ID는_400이고_없는_세션은_404다(String invalid) throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/alerts/fixed-interval", invalid))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		request(UUID.randomUUID()).andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
	}

	@ParameterizedTest
	@ValueSource(strings = {"[]", "not json", "\"text\""})
	void 요청_본문이_JSON_객체가_아니면_400이다(String body) throws Exception {
		now.set(startedAt.plus(INTERVAL));
		mockMvc.perform(post("/api/sessions/{sessionId}/alerts/fixed-interval", sessionId)
				.contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		assertThat(notificationRepository.count()).isZero();
	}

	@Test
	void 고정_주기_모드에서는_DRIFT_분석이_있어도_AI_후보를_만들지_않는다() throws Exception {
		for (int sequence = 1; sequence <= 5; sequence++) {
			mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
					.contentType(MediaType.APPLICATION_JSON)
					.content("""
						{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
						"domain": "example.com", "activeDurationMs": 1000, "visitedAt": "2026-10-18T01:00:00.000Z"}"""
						.formatted(UUID.randomUUID(), sequence, sequence)))
				.andExpect(status().isCreated());
		}
		AnalysisWindow window = analysisWindowRepository.findAll().getFirst();
		AnalysisResult analysis = AnalysisResult.request(UUID.randomUUID(), window.getWindowId(), "{}", now.get());
		analysis.start(now.get());
		analysis.finish(new AiAnalysisOutcome(null, "DRIFT", 0.1, 0.1, 0.8, false, null, null, "{\"c\":\"rf\"}", now.get()),
			now.get());
		analysisResultRepository.save(analysis);

		assertThat(alertService.createAiCandidate(sessionId, analysis.getAnalysisId())).isEmpty();
		// 복구 작업도 오류가 아니라 모드 불일치로 건너뛴 것으로 기록한다
		alertTaskProcessor.recover();
		AlertCandidateTask task = alertCandidateTaskRepository.findById(analysis.getAnalysisId()).orElseThrow();
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.SKIPPED);
		assertThat(task.getSkipReason()).isEqualTo("MODE_NOT_AI");
		assertThat(task.getErrorCode()).isNull();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()))
			.andExpect(jsonPath("$.latestCompletedAnalysis.result").value("DRIFT"));
		assertThat(notificationRepository.count()).isZero();
	}

	private ResultActions request(UUID session) throws Exception {
		return mockMvc.perform(post("/api/sessions/{sessionId}/alerts/fixed-interval", session));
	}

	private static String alertId(ResultActions result) throws Exception {
		return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.alertId");
	}

	// 표시 확인 API는 후속 작업이라 실제 표시를 DB로 재현한다(UTC로 저장)
	private void markShown(String alertId, Instant shownAt) {
		jdbcTemplate.update("update notification set shown_at = ? where alert_id = ?",
			LocalDateTime.ofInstant(shownAt, ZoneOffset.UTC), alertId);
	}

	private void cleanUp() {
		alertCandidateTaskRepository.deleteAll();
		notificationRepository.deleteAll();
		analysisResultRepository.deleteAll();
		analysisWindowRepository.deleteAll();
		pageVisitRepository.deleteAll();
		workSessionRepository.deleteAll();
	}
}
