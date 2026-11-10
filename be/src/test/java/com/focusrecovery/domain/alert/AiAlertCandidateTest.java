package com.focusrecovery.domain.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.focusrecovery.domain.alert.entity.AlertCandidateTask;
import com.focusrecovery.domain.alert.entity.AlertTaskStatus;
import com.focusrecovery.domain.alert.entity.AlertType;
import com.focusrecovery.domain.alert.entity.Notification;
import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.alert.service.AlertService;
import com.focusrecovery.domain.analysis.client.AiAnalysisOutcome;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.support.MockAiServer;

import tools.jackson.databind.json.JsonMapper;

// AI 모드(기본) 알림 후보 규칙. 규칙 검증은 분석 행을 직접 만들고 후보 생성을 호출하며,
// 분석 완료→후보 생성 흐름과 종료 경합은 HTTP 모의 AI 서버(실제 AI 서버 아님)로 검증한다
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AiAlertCandidateTest {

	private static final String GOAL = "알림 후보 테스트 목표";
	private static final MockAiServer AI = new MockAiServer();

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("focus-recovery.ai.base-url", AI::baseUrl);
		registry.add("focus-recovery.ai.response-timeout", () -> "2s");
	}

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JsonMapper jsonMapper;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private AlertService alertService;

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

	// 알림 간격 판단 시각만 고정한다(다른 코드는 실제 시각 사용)
	@MockitoBean
	private Clock clock;

	private final AtomicReference<Instant> now = new AtomicReference<>();
	private UUID sessionId;

	@BeforeEach
	void setUp() {
		now.set(Instant.now().truncatedTo(ChronoUnit.MILLIS));
		when(clock.instant()).thenAnswer(invocation -> now.get());
		AI.reset(request -> MockAiServer.ok(aiResponse(request, "DRIFT")));
		cleanUp();
		sessionId = workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start(GOAL, null)).getSessionId();
	}

	@AfterEach
	void tearDown() throws Exception {
		AI.release();
		awaitIdle();
		cleanUp();
	}

	@Test
	void 최신_구간의_DRIFT_분석이면_후보를_만들고_상태_조회의_alert로_반환한다() throws Exception {
		List<AnalysisWindow> windows = createWindows(6);
		UUID analysisId = completed(windows.get(1), "DRIFT");

		Optional<Notification> created = alertService.createAiCandidate(sessionId, analysisId);

		assertThat(created).isPresent();
		Notification alert = created.get();
		assertThat(alert.getShownAt()).isNull();
		assertThat(alert.getCreatedAt()).isEqualTo(now.get());
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.alert.alertId").value(alert.getAlertId().toString()))
			.andExpect(jsonPath("$.alert.sessionId").value(sessionId.toString()))
			.andExpect(jsonPath("$.alert.alertType").value("AI"))
			.andExpect(jsonPath("$.alert.analysisId").value(analysisId.toString()))
			.andExpect(jsonPath("$.alert.windowIndex").value(2))
			.andExpect(jsonPath("$.alert.goalText").value(GOAL))
			.andExpect(jsonPath("$.alert.message").isNotEmpty())
			.andExpect(jsonPath("$.alert.shownAt").value(nullValue()))
			.andExpect(jsonPath("$.latestAnalysis.windowIndex").value(2))
			.andExpect(jsonPath("$.latestCompletedAnalysis.windowIndex").value(2));

		// 같은 분석으로 다시 호출해도 후보는 하나다
		assertThat(alertService.createAiCandidate(sessionId, analysisId)).isEmpty();
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	@Test
	void 더_최신_구간이_대기_진행_중이거나_분석이_없으면_이전_구간의_DRIFT로_후보를_만들지_않는다() throws Exception {
		List<AnalysisWindow> windows = createWindows(8);
		UUID drift = completed(windows.get(0), "DRIFT");
		insert(windows.get(1), AnalysisStatus.PENDING);
		insert(windows.get(2), AnalysisStatus.RUNNING);
		// windows.get(3): 분석 없음(최신 구간)

		assertThat(alertService.createAiCandidate(sessionId, drift)).isEmpty();
		UUID driftOnRunning = completed(windows.get(2), "DRIFT", true);
		assertThat(alertService.createAiCandidate(sessionId, driftOnRunning)).isEmpty();
		assertThat(notificationRepository.count()).isZero();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()))
			.andExpect(jsonPath("$.latestCompletedAnalysis.result").value("DRIFT"));
	}

	@Test
	void 완료_순서가_역전되어도_windowIndex로_최신_구간을_판단한다() throws Exception {
		List<AnalysisWindow> windows = createWindows(7);
		UUID third = completed(windows.get(2), "DRIFT");
		Notification alert = alertService.createAiCandidate(sessionId, third).orElseThrow();
		// 구간 2가 나중에 DRIFT로 끝나도 최신 구간이 아니므로 후보를 만들지 않는다
		now.set(now.get().plusSeconds(30));
		UUID second = completed(windows.get(1), "DRIFT");

		assertThat(alertService.createAiCandidate(sessionId, second)).isEmpty();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(alert.getAlertId().toString()))
			.andExpect(jsonPath("$.alert.windowIndex").value(3));
	}

	@Test
	void 더_최신_구간이_생기면_저장된_이전_후보는_반환하지_않는다() throws Exception {
		List<AnalysisWindow> windows = createWindows(5);
		UUID first = completed(windows.getFirst(), "DRIFT");
		alertService.createAiCandidate(sessionId, first).orElseThrow();

		saveVisit(6);
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));

		completed(analysisWindowRepository.findFirstBySessionIdOrderByWindowIndexDesc(sessionId).orElseThrow(), "NORMAL");
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()))
			.andExpect(jsonPath("$.latestAnalysis.result").value("NORMAL"));
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	@Test
	void 미표시_후보는_알림_소진으로_보지_않아_더_최신_DRIFT에서_새_후보를_만든다() throws Exception {
		AnalysisWindow first = createWindows(5).getFirst();
		alertService.createAiCandidate(sessionId, completed(first, "DRIFT")).orElseThrow();
		UUID second = completed(nextWindow(), "DRIFT");

		Notification newer = alertService.createAiCandidate(sessionId, second).orElseThrow();

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(newer.getAlertId().toString()))
			.andExpect(jsonPath("$.alert.windowIndex").value(2));
		assertThat(notificationRepository.count()).isEqualTo(2);
	}

	@Test
	void 실제_표시된_뒤에는_정상_복귀_전까지_DRIFT가_이어져도_후보를_만들지_않는다() throws Exception {
		AnalysisWindow first = createWindows(5).getFirst();
		Notification shown = alertService.createAiCandidate(sessionId, completed(first, "DRIFT")).orElseThrow();
		markShown(shown, now.get().minus(Duration.ofMinutes(30)));

		// 이어지는 DRIFT, 실패·PENDING·분석 없음은 정상 복귀가 아니다
		assertThat(alertService.createAiCandidate(sessionId, completed(nextWindow(), "DRIFT"))).isEmpty();
		insert(nextWindow(), AnalysisStatus.FAILED);
		insert(nextWindow(), AnalysisStatus.PENDING);
		nextWindow();
		assertThat(alertService.createAiCandidate(sessionId, completed(nextWindow(), "DRIFT"))).isEmpty();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));

		// TRANSITION으로 완료된 구간 뒤의 DRIFT는 새 알림 대상이다
		completed(nextWindow(), "TRANSITION");
		Notification again = alertService.createAiCandidate(sessionId, completed(nextWindow(), "DRIFT")).orElseThrow();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(again.getAlertId().toString()))
			.andExpect(jsonPath("$.alert.windowIndex").value(8));
	}

	// 후보 B를 만든 뒤 이전 후보 A가 실제 표시되면, 복귀 없이 DRIFT가 이어진 상태이므로 B도 반환하지 않는다
	@Test
	void 후보_생성_후_다른_알림이_표시되면_조회_시_반복_제한을_다시_적용한다() throws Exception {
		AnalysisWindow first = createWindows(5).getFirst();
		Notification a = alertService.createAiCandidate(sessionId, completed(first, "DRIFT")).orElseThrow();
		Notification b = alertService.createAiCandidate(sessionId, completed(nextWindow(), "DRIFT")).orElseThrow();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(b.getAlertId().toString()));

		markShown(a, now.get().minus(Duration.ofMinutes(30)));
		List<Map<String, Object>> before = notificationRows();

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.alert").value(nullValue()))
			.andExpect(jsonPath("$.latestCompletedAnalysis.result").value("DRIFT"));
		assertThat(notificationRows()).isEqualTo(before);
		assertThat(notificationRepository.findById(b.getAlertId()).orElseThrow().getShownAt()).isNull();
	}

	// 정상 복귀 구간이 있어도 마지막 표시부터 최소 간격 전이면 반환하지 않고, 간격이 지나면 같은 후보를 반환한다
	@Test
	void 정상_복귀가_있어도_최소_간격_전에는_기존_후보를_반환하지_않는다() throws Exception {
		AnalysisWindow first = createWindows(5).getFirst();
		Notification a = alertService.createAiCandidate(sessionId, completed(first, "DRIFT")).orElseThrow();
		completed(nextWindow(), "NORMAL");
		Notification b = alertService.createAiCandidate(sessionId, completed(nextWindow(), "DRIFT")).orElseThrow();
		Instant shownAt = now.get();
		markShown(a, shownAt);
		List<Map<String, Object>> before = notificationRows();

		now.set(shownAt.plus(Duration.ofMinutes(5)).minusMillis(1));
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));

		now.set(shownAt.plus(Duration.ofMinutes(5)));
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(b.getAlertId().toString()))
			.andExpect(jsonPath("$.alert.windowIndex").value(3));
		assertThat(notificationRows()).isEqualTo(before);
	}

	private List<Map<String, Object>> notificationRows() {
		return jdbcTemplate.queryForList("select * from notification order by alert_id");
	}

	@Test
	void 마지막_표시_후_최소_간격_전이면_건너뛰고_이후_최신_DRIFT에서_다시_평가한다() throws Exception {
		AnalysisWindow first = createWindows(5).getFirst();
		Notification shown = alertService.createAiCandidate(sessionId, completed(first, "DRIFT")).orElseThrow();
		Instant shownAt = now.get();
		markShown(shown, shownAt);
		completed(nextWindow(), "NORMAL");

		now.set(shownAt.plus(Duration.ofMinutes(5)).minusMillis(1));
		assertThat(alertService.createAiCandidate(sessionId, completed(nextWindow(), "DRIFT"))).isEmpty();

		// 경계값: 정확히 5분(잠정 최소 간격)이면 허용
		now.set(shownAt.plus(Duration.ofMinutes(5)));
		assertThat(alertService.createAiCandidate(sessionId, completed(nextWindow(), "DRIFT"))).isPresent();
	}

	@Test
	void 종료된_세션에서는_후보를_만들지_않고_기존_후보도_반환하지_않는다() throws Exception {
		AnalysisWindow first = createWindows(5).getFirst();
		alertService.createAiCandidate(sessionId, completed(first, "DRIFT")).orElseThrow();
		UUID latest = completed(nextWindow(), "DRIFT");
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		assertThat(alertService.createAiCandidate(sessionId, latest)).isEmpty();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.sessionStatus").value("ENDED"))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	@Test
	void 같은_분석의_후보_생성이_동시에_와도_하나만_만든다() throws Exception {
		UUID analysisId = completed(createWindows(5).getFirst(), "DRIFT");
		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(8);
		List<Future<Optional<Notification>>> futures = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			futures.add(executor.submit(() -> {
				ready.await();
				return alertService.createAiCandidate(sessionId, analysisId);
			}));
		}
		ready.countDown();
		int created = 0;
		for (Future<Optional<Notification>> future : futures) {
			created += future.get(10, TimeUnit.SECONDS).isPresent() ? 1 : 0;
		}
		executor.shutdown();

		assertThat(created).isEqualTo(1);
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	// 종료(세션 쓰기 잠금)·새 구간을 만드는 방문 저장(세션 쓰기 잠금)·후보 생성(세션 공유 잠금 → 분석 행)이 동시에 와도
	// 오류 없이 끝나고, 후보가 생겼다면 그 시점에 ACTIVE였으며 상태 조회는 정책에 맞는 후보만 반환한다
	@Test
	void 종료와_새_구간_저장과_후보_생성이_동시에_와도_오류_없이_정책에_맞게_끝난다() throws Exception {
		for (int round = 0; round < 5; round++) {
			cleanUp();
			sessionId = workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start(GOAL, null)).getSessionId();
			UUID analysisId = completed(createWindows(5).getFirst(), "DRIFT");
			int round0 = round;
			CountDownLatch ready = new CountDownLatch(1);
			ExecutorService executor = Executors.newFixedThreadPool(3);
			Future<Optional<Notification>> candidate = executor.submit(() -> {
				ready.await();
				return alertService.createAiCandidate(sessionId, analysisId);
			});
			Future<Integer> end = executor.submit(() -> {
				ready.await();
				return mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andReturn().getResponse().getStatus();
			});
			Future<Integer> save = executor.submit(() -> {
				ready.await();
				return mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
							{"visitId": "%s", "sequence": 6, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/6", 							"domain": "example.com", "activeDurationMs": 1000, "visitedAt": "2026-10-18T01:00:00.000Z"}"""
							.formatted(UUID.randomUUID())))
					.andReturn().getResponse().getStatus();
			});
			ready.countDown();
			Optional<Notification> created = candidate.get(10, TimeUnit.SECONDS);
			assertThat(end.get(10, TimeUnit.SECONDS)).as("round %d", round0).isEqualTo(200);
			assertThat(save.get(10, TimeUnit.SECONDS)).as("round %d", round0).isIn(201, 409);
			executor.shutdown();

			assertThat(notificationRepository.count()).isEqualTo(created.isPresent() ? 1 : 0);
			mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
				.andExpect(jsonPath("$.sessionStatus").value("ENDED"))
				.andExpect(jsonPath("$.alert").value(nullValue()));
			awaitIdle();
		}
	}

	@Test
	void 분석_상태_조회는_후보를_만들지_않는다() throws Exception {
		completed(createWindows(5).getFirst(), "DRIFT");

		for (int i = 0; i < 3; i++) {
			mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.alert").value(nullValue()))
				.andExpect(jsonPath("$.latestCompletedAnalysis.result").value("DRIFT"));
		}
		assertThat(notificationRepository.count()).isZero();
	}

	@Test
	void AI_모드에서는_고정_주기_후보_생성이_409_FIXED_INTERVAL_DISABLED다() throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/alerts/fixed-interval", sessionId))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("FIXED_INTERVAL_DISABLED"));
		assertThat(notificationRepository.count()).isZero();
	}

	@Test
	void AI가_DRIFT로_완료되면_분석_완료_후_후보를_만든다() throws Exception {
		createWindows(4);
		saveVisit(5, 12000);

		Notification alert = awaitNotification();
		AnalysisResult analysis = analysisResultRepository.findAll().getFirst();
		assertThat(analysis.getResult()).isEqualTo("DRIFT");
		assertThat(alert.getAnalysisId()).isEqualTo(analysis.getAnalysisId());
		assertThat(alert.getAlertType()).isEqualTo(AlertType.AI);
		// 분석 완료 트랜잭션에서 등록된 작업이 후보 생성으로 끝난다
		AlertCandidateTask task = alertCandidateTaskRepository.findById(analysis.getAnalysisId()).orElseThrow();
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.CREATED);
		assertThat(task.getAlertId()).isEqualTo(alert.getAlertId());
		assertThat(task.getAttempts()).isEqualTo(1);
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(alert.getAlertId().toString()));
	}

	@Test
	void 분석_중에_세션이_종료되면_DRIFT_결과는_저장하지만_후보는_만들지_않는다() throws Exception {
		AI.hold();
		createWindows(4);
		saveVisit(5, 12000);
		AI.awaitRequests(1);

		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());
		AI.release();
		awaitIdle();

		AnalysisResult analysis = analysisResultRepository.findAll().getFirst();
		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(analysis.getResult()).isEqualTo("DRIFT");
		assertThat(notificationRepository.count()).isZero();
		AlertCandidateTask task = alertCandidateTaskRepository.findById(analysis.getAnalysisId()).orElseThrow();
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.SKIPPED);
		assertThat(task.getSkipReason()).isEqualTo("SESSION_ENDED");
	}

	private Notification awaitNotification() throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (System.nanoTime() < deadline) {
			List<Notification> all = notificationRepository.findAll();
			if (!all.isEmpty()) {
				return all.getFirst();
			}
			Thread.sleep(20);
		}
		throw new AssertionError("알림 후보가 생성되지 않았습니다.");
	}

	// 표시 확인 API는 후속 작업이라 실제 표시를 DB로 재현한다. 앱은 DATETIME을 UTC로 읽으므로 UTC 값으로 넣는다
	private void markShown(Notification notification, Instant shownAt) {
		jdbcTemplate.update("update notification set shown_at = ? where alert_id = ?",
			LocalDateTime.ofInstant(shownAt, ZoneOffset.UTC), notification.getAlertId().toString());
	}

	private UUID completed(AnalysisWindow window, String result) {
		return completed(window, result, false);
	}

	// replace: 같은 구간의 기존 분석 행을 지우고 완료 상태로 다시 만든다(진행 중이던 분석이 끝난 상황)
	private UUID completed(AnalysisWindow window, String result, boolean replace) {
		if (replace) {
			analysisResultRepository.findByWindowId(window.getWindowId()).ifPresent(analysisResultRepository::delete);
		}
		AnalysisResult analysis = request(window);
		analysis.start(now.get());
		analysis.finish(new AiAnalysisOutcome(null, result, 0.2, 0.2, 0.6, false, null, null, "{\"classifier\":\"rf\"}",
			now.get()), now.get());
		analysisResultRepository.save(analysis);
		return analysis.getAnalysisId();
	}

	private void insert(AnalysisWindow window, AnalysisStatus status) {
		AnalysisResult analysis = request(window);
		if (status != AnalysisStatus.PENDING) {
			analysis.start(now.get());
		}
		if (status == AnalysisStatus.FAILED) {
			analysis.finish(AiAnalysisOutcome.failed("AI_TIMEOUT"), now.get());
		}
		analysisResultRepository.save(analysis);
	}

	private AnalysisResult request(AnalysisWindow window) {
		UUID analysisId = UUID.randomUUID();
		return AnalysisResult.request(analysisId, window.getWindowId(),
			"{\"analysisId\":\"" + analysisId + "\",\"goalText\":\"" + GOAL + "\"}", Instant.parse("2026-10-18T00:00:00Z"));
	}

	private List<AnalysisWindow> createWindows(int visitCount) throws Exception {
		for (int sequence = 1; sequence <= visitCount; sequence++) {
			saveVisit(sequence);
		}
		return analysisWindowRepository.findAll().stream()
			.sorted((a, b) -> Integer.compare(a.getWindowIndex(), b.getWindowIndex())).toList();
	}

	// 방문을 하나 더 저장해 새 최신 구간을 만든다
	private AnalysisWindow nextWindow() throws Exception {
		saveVisit((int) pageVisitRepository.count() + 1);
		return analysisWindowRepository.findFirstBySessionIdOrderByWindowIndexDesc(sessionId).orElseThrow();
	}

	private void saveVisit(int sequence) throws Exception {
		saveVisit(sequence, 1000);
	}

	private void saveVisit(int sequence, long activeDurationMs) throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
					"domain": "example.com", "title": "제목", "content": "본문", "activeDurationMs": %d, \
					"visitedAt": "2026-10-18T01:00:00.000Z"}""".formatted(UUID.randomUUID(), sequence, sequence, activeDurationMs)))
			.andExpect(status().isCreated());
	}

	private String aiResponse(String request, String result) {
		var body = jsonMapper.readTree(request);
		return jsonMapper.createObjectNode()
			.put("analysisId", body.get("analysisId").stringValue())
			.put("sessionId", body.get("sessionId").stringValue())
			.put("windowId", body.get("windowId").stringValue())
			.put("result", result).put("pNormal", 0.2).put("pTransition", 0.2).put("pDrift", 0.6)
			.put("contextUsed", false).putNull("contextResult").putNull("featureSnapshot")
			.<tools.jackson.databind.node.ObjectNode>set("modelVersions", jsonMapper.createObjectNode().put("classifier", "mock"))
			.put("analyzedAt", "2026-10-18T02:00:00.000Z").toString();
	}

	private void awaitIdle() throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (System.nanoTime() < deadline && analysisResultRepository.findAll().stream()
			.anyMatch(a -> !a.getRequestedAt().equals(Instant.parse("2026-10-18T00:00:00Z"))
				&& (a.getProcessingStatus() == AnalysisStatus.PENDING || a.getProcessingStatus() == AnalysisStatus.RUNNING))) {
			Thread.sleep(20);
		}
		Thread.sleep(100);
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
