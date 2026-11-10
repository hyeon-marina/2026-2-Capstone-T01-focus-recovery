package com.focusrecovery.domain.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.lang.reflect.InvocationTargetException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.web.servlet.MockMvc;

import com.focusrecovery.domain.alert.entity.AlertCandidateTask;
import com.focusrecovery.domain.alert.entity.AlertTaskStatus;
import com.focusrecovery.domain.alert.entity.Notification;
import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
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
import com.focusrecovery.global.exception.StoredDataException;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

// AI 알림 후보 처리 작업의 실패·누락·중단 복구. 복구는 스케줄 진입점(recover)을 직접 호출하고 시각은 Clock으로 고정한다.
// DB 오류는 저장소 스파이로 재현한다(AI는 호출하지 않음: 분석 행은 테스트가 직접 만든다)
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AlertTaskRecoveryTest {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	// 기본은 실제 판단을 한다. 소유권 경합 테스트에서만 첫 실행을 판단 직후 멈춘다
	@MockitoSpyBean
	private AlertService alertService;

	@Autowired
	private AlertTaskProcessor processor;

	@Autowired
	private WorkSessionRepository workSessionRepository;

	@Autowired
	private PageVisitRepository pageVisitRepository;

	@Autowired
	private AnalysisWindowRepository analysisWindowRepository;

	@Autowired
	private AnalysisResultRepository analysisResultRepository;

	@MockitoSpyBean
	private NotificationRepository notificationRepository;

	@MockitoSpyBean
	private AlertCandidateTaskRepository taskRepository;

	@MockitoBean
	private Clock clock;

	@PersistenceContext
	private EntityManager entityManager;

	private final AtomicReference<Instant> now = new AtomicReference<>();
	private UUID sessionId;

	@BeforeEach
	void setUp() {
		now.set(Instant.now().truncatedTo(ChronoUnit.MILLIS));
		when(clock.instant()).thenAnswer(invocation -> now.get());
		cleanUp();
		sessionId = workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start("작업 복구 테스트 목표", null)).getSessionId();
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	@Test
	void 일시적인_DB_오류는_분석을_바꾸지_않고_대기_후_재시도해서_후보를_만든다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		failNotificationSave(1);
		Map<String, Object> analysisBefore = analysisRow(analysisId);

		processor.process(analysisId);

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.PENDING);
		assertThat(task.getAttempts()).isEqualTo(1);
		assertThat(task.getErrorCode()).isEqualTo("ALERT_DB_ERROR");
		assertThat(task.getSkipReason()).isNull();
		assertThat(task.getNextAttemptAt()).isEqualTo(now.get().plusSeconds(30));
		assertThat(notificationCount()).isZero();
		assertThat(analysisRow(analysisId)).isEqualTo(analysisBefore);

		// 재시도 시각 전에는 처리하지 않는다
		processor.recover();
		assertThat(task(analysisId).getAttempts()).isEqualTo(1);

		now.set(now.get().plusSeconds(30));
		processor.recover();

		task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.CREATED);
		assertThat(task.getAttempts()).isEqualTo(2);
		assertThat(task.getAlertId()).isEqualTo(notificationRepository.findByAnalysisId(analysisId).orElseThrow().getAlertId());
		assertThat(task.getCompletedAt()).isEqualTo(now.get());
		assertThat(analysisRow(analysisId)).isEqualTo(analysisBefore);
	}

	@Test
	void 재시도는_횟수와_간격이_제한되고_모두_실패하면_FAILED로_확정한다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		failNotificationSave(Integer.MAX_VALUE);
		Map<String, Object> analysisBefore = analysisRow(analysisId);

		List<Duration> delays = new ArrayList<>();
		for (int attempt = 1; attempt <= 5; attempt++) {
			processor.recover();
			AlertCandidateTask task = task(analysisId);
			assertThat(task.getAttempts()).isEqualTo(attempt);
			if (attempt < 5) {
				assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.PENDING);
				delays.add(Duration.between(now.get(), task.getNextAttemptAt()));
				now.set(task.getNextAttemptAt());
			}
		}

		assertThat(delays).containsExactly(Duration.ofSeconds(30), Duration.ofMinutes(1), Duration.ofMinutes(2),
			Duration.ofMinutes(4));
		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.FAILED);
		assertThat(task.getErrorCode()).isEqualTo("ALERT_DB_ERROR");
		assertThat(task.getCompletedAt()).isNotNull();
		now.set(now.get().plus(Duration.ofHours(1)));
		processor.recover();
		assertThat(task(analysisId).getAttempts()).isEqualTo(5);
		assertThat(notificationCount()).isZero();
		assertThat(analysisRow(analysisId)).isEqualTo(analysisBefore);
	}

	@Test
	void 작업_기록이_없는_완료된_DRIFT_분석은_복구에서_등록해_처리한다() throws Exception {
		// 분석 저장 직후 작업이 기록되지 않은 상황(V7 이전 데이터 등)
		UUID analysisId = driftOnLatestWindow();
		assertThat(taskRepository.findById(analysisId)).isEmpty();

		processor.recover();

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.CREATED);
		assertThat(task.getSessionId()).isEqualTo(sessionId);
		assertThat(notificationCount()).isEqualTo(1);
		processor.recover();
		assertThat(taskRepository.count()).isEqualTo(1);
		assertThat(notificationCount()).isEqualTo(1);
	}

	@Test
	void 처리_중_멈춘_작업은_running_timeout_뒤_다시_처리하고_최근_작업은_건드리지_않는다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		markRunning(analysisId, 1, now.get().minus(Duration.ofMinutes(1)));

		processor.recover();
		assertThat(task(analysisId).getStatus()).isEqualTo(AlertTaskStatus.RUNNING);
		assertThat(notificationCount()).isZero();

		now.set(now.get().plus(Duration.ofMinutes(1)).plusMillis(1));
		processor.recover();

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.CREATED);
		assertThat(task.getAttempts()).isEqualTo(2);
		assertThat(task.getErrorCode()).isEqualTo("ALERT_TASK_INTERRUPTED");
		assertThat(notificationCount()).isEqualTo(1);
	}

	@Test
	void 재시도를_소진한_채_멈춘_작업은_FAILED로_확정한다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		markRunning(analysisId, 5, now.get().minus(Duration.ofMinutes(3)));

		processor.recover();

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.FAILED);
		assertThat(task.getErrorCode()).isEqualTo("ALERT_TASK_INTERRUPTED");
		assertThat(notificationCount()).isZero();
	}

	@Test
	void 실패_기록마저_못_해도_멈춘_작업으로_다시_찾아_처리한다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		failNotificationSave(1);
		// 실패 기록(조건부 갱신)에서도 DB 오류가 난다
		doThrow(new DataAccessResourceFailureException("주입된 DB 장애"))
			.when(taskRepository).markRetry(any(), anyInt(), any(), any());

		processor.process(analysisId);
		assertThat(task(analysisId).getStatus()).isEqualTo(AlertTaskStatus.RUNNING);

		now.set(now.get().plus(Duration.ofMinutes(2)).plusMillis(1));
		processor.recover();

		assertThat(task(analysisId).getStatus()).isEqualTo(AlertTaskStatus.CREATED);
		assertThat(notificationCount()).isEqualTo(1);
	}

	// 1) 첫 실행이 작업을 가져가 후보를 저장한 뒤(커밋 전) 멈춘다 2) 복구가 제한 시간 초과를 처리하고 두 번째 실행이 시도 2로 가져간다
	// 3) 첫 실행을 재개해도 DB의 현재 시도 번호가 달라 기록이 0건 → 후보 저장까지 롤백된다 4) 두 번째 실행이 후보를 만들고 작업과 연결한다
	@Test
	void 소유권을_잃은_이전_실행은_후보와_작업_상태를_커밋하지_못한다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		CountDownLatch paused = new CountDownLatch(1);
		CountDownLatch resume = new CountDownLatch(1);
		List<AlertService.AiDecision> decisions = Collections.synchronizedList(new ArrayList<>());
		AlertService target = AopTestUtils.getUltimateTargetObject(alertService);
		doAnswer(invocation -> {
			AlertService.AiDecision decision = (AlertService.AiDecision) invocation.callRealMethod();
			decisions.add(decision);
			if (decisions.size() == 1) {
				paused.countDown();
				assertThat(resume.await(10, TimeUnit.SECONDS)).isTrue();
			}
			return decision;
		}).when(target).decideAiCandidate(any(), any());
		ExecutorService executor = Executors.newFixedThreadPool(2);

		Future<?> first = executor.submit(() -> processor.process(analysisId));
		assertThat(paused.await(5, TimeUnit.SECONDS)).isTrue();
		assertThat(taskRow(analysisId)).isEqualTo("RUNNING/1");
		assertThat(notificationCount()).isZero();

		now.set(now.get().plus(Duration.ofMinutes(2)).plusMillis(1));
		Future<?> second = executor.submit(() -> processor.recover());
		awaitTaskRow(analysisId, "RUNNING/2");
		// 두 번째 실행은 첫 실행이 잡고 있는 세션·분석 행 잠금을 기다린다
		Thread.sleep(200);
		resume.countDown();
		first.get(10, TimeUnit.SECONDS);
		second.get(10, TimeUnit.SECONDS);
		executor.shutdown();

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.CREATED);
		assertThat(task.getAttempts()).isEqualTo(2);
		assertThat(task.getErrorCode()).isEqualTo("ALERT_TASK_INTERRUPTED");
		// 두 실행 모두 각자 후보를 새로 만들었지만, 첫 실행의 후보는 롤백되고 두 번째 실행의 후보만 남아 작업과 연결된다
		assertThat(decisions).hasSize(2).allMatch(AlertService.AiDecision::newlyCreated);
		UUID firstAlert = decisions.get(0).notification().getAlertId();
		UUID secondAlert = decisions.get(1).notification().getAlertId();
		assertThat(jdbcTemplate.queryForObject("select count(*) from notification where alert_id = ?", Long.class,
			firstAlert.toString())).isZero();
		assertThat(notificationCount()).isEqualTo(1);
		assertThat(task.getAlertId()).isEqualTo(secondAlert);
	}

	private String taskRow(UUID analysisId) {
		return jdbcTemplate.queryForObject("select concat(status, '/', attempts) from alert_candidate_task where analysis_id = ?",
			String.class, analysisId.toString());
	}

	private void awaitTaskRow(UUID analysisId, String expected) throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (!expected.equals(taskRow(analysisId)) && System.nanoTime() < deadline) {
			Thread.sleep(10);
		}
		assertThat(taskRow(analysisId)).isEqualTo(expected);
	}

	// 세션 A·B 모두 구간 1(같은 windowIndex)이 최신이며 COMPLETED·DRIFT다
	private UUID[] twoSessionsWithSameWindowIndex() throws Exception {
		UUID sessionA = sessionId;
		UUID analysisA = driftOnLatestWindow();
		UUID sessionB = workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start("다른 세션 목표", null)).getSessionId();
		sessionId = sessionB;
		UUID analysisB = driftOnLatestWindow();
		sessionId = sessionA;
		assertThat(analysisWindowRepository.findFirstBySessionIdOrderByWindowIndexDesc(sessionA).orElseThrow().getWindowIndex())
			.isEqualTo(analysisWindowRepository.findFirstBySessionIdOrderByWindowIndexDesc(sessionB).orElseThrow().getWindowIndex());
		return new UUID[] {sessionA, analysisA, sessionB, analysisB};
	}

	@Test
	void 다른_세션의_분석으로는_windowIndex가_같아도_후보를_만들지_않는다() throws Exception {
		UUID[] ids = twoSessionsWithSameWindowIndex();
		Map<String, Object> analysisB = analysisRow(ids[3]);

		assertThatThrownBy(() -> alertService.createAiCandidate(ids[0], ids[3]))
			.isInstanceOf(StoredDataException.class)
			.hasMessageContaining("세션에 속하지 않습니다");

		assertThat(notificationCount()).isZero();
		assertThat(analysisRow(ids[3])).isEqualTo(analysisB);
		// 같은 세션 호출은 기존대로 동작한다
		Notification a = alertService.createAiCandidate(ids[0], ids[1]).orElseThrow();
		Notification b = alertService.createAiCandidate(ids[2], ids[3]).orElseThrow();
		assertThat(a.getSessionId()).isEqualTo(ids[0]);
		assertThat(b.getSessionId()).isEqualTo(ids[2]);
		assertThat(notificationCount()).isEqualTo(2);
	}

	@Test
	void 다른_세션의_기존_후보는_재사용하지_않고_변경하지도_않는다() throws Exception {
		UUID[] ids = twoSessionsWithSameWindowIndex();
		Notification b = alertService.createAiCandidate(ids[2], ids[3]).orElseThrow();
		List<Map<String, Object>> notificationsBefore = jdbcTemplate.queryForList("select * from notification");
		Map<String, Object> analysisB = analysisRow(ids[3]);

		assertThatThrownBy(() -> alertService.createAiCandidate(ids[0], ids[3]))
			.isInstanceOf(StoredDataException.class);

		assertThat(jdbcTemplate.queryForList("select * from notification")).isEqualTo(notificationsBefore);
		assertThat(analysisRow(ids[3])).isEqualTo(analysisB);
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", ids[0]))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", ids[2]))
			.andExpect(jsonPath("$.alert.alertId").value(b.getAlertId().toString()));
	}

	@Test
	void 작업의_세션과_분석의_세션이_다르면_정합성_오류로_바로_FAILED이고_후보를_연결하지_않는다() throws Exception {
		UUID[] ids = twoSessionsWithSameWindowIndex();
		Notification b = alertService.createAiCandidate(ids[2], ids[3]).orElseThrow();
		// 작업 행이 잘못된 세션(A)으로 기록된 상황(외래키는 모두 유효)
		taskRepository.save(AlertCandidateTask.pending(ids[3], ids[0], now.get()));
		List<Map<String, Object>> notificationsBefore = jdbcTemplate.queryForList("select * from notification");
		Map<String, Object> analysisB = analysisRow(ids[3]);

		processor.process(ids[3]);

		AlertCandidateTask task = task(ids[3]);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.FAILED);
		assertThat(task.getErrorCode()).isEqualTo("ALERT_DATA_INTEGRITY_ERROR");
		assertThat(task.getAttempts()).isEqualTo(1);
		assertThat(task.getAlertId()).isNull();
		assertThat(task.getSkipReason()).isNull();
		assertThat(jdbcTemplate.queryForList("select * from notification")).isEqualTo(notificationsBefore);
		assertThat(analysisRow(ids[3])).isEqualTo(analysisB);
		assertThat(notificationRepository.findById(b.getAlertId()).orElseThrow().getSessionId()).isEqualTo(ids[2]);
		// 재시도하지 않는다
		now.set(now.get().plus(Duration.ofHours(1)));
		processor.recover();
		assertThat(task(ids[3]).getAttempts()).isEqualTo(1);
	}

	@Test
	void 같은_작업을_동시에_처리해도_후보는_하나다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(8);
		List<Future<?>> futures = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			futures.add(executor.submit(() -> {
				ready.await();
				if (Thread.currentThread().getId() % 2 == 0) {
					processor.process(analysisId);
				} else {
					processor.recover();
				}
				return null;
			}));
		}
		ready.countDown();
		for (Future<?> future : futures) {
			future.get(10, TimeUnit.SECONDS);
		}
		executor.shutdown();

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.CREATED);
		assertThat(task.getAttempts()).isEqualTo(1);
		assertThat(notificationCount()).isEqualTo(1);
	}

	@Test
	void 후보가_이미_있으면_새로_만들지_않고_그_후보로_완료_처리한다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		Notification existing = alertService.createAiCandidate(sessionId, analysisId).orElseThrow();
		register(analysisId);
		// 이후 세션이 종료되어도 이미 만든 후보의 작업은 완료로 기록한다
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		processor.recover();

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.CREATED);
		assertThat(task.getAlertId()).isEqualTo(existing.getAlertId());
		assertThat(notificationCount()).isEqualTo(1);
	}

	@Test
	void 재시도_사이에_세션이_종료되면_후보를_만들지_않고_건너뜀으로_기록한다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		failNotificationSave(1);
		processor.process(analysisId);
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		now.set(now.get().plusSeconds(30));
		processor.recover();

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.SKIPPED);
		assertThat(task.getSkipReason()).isEqualTo("SESSION_ENDED");
		assertThat(notificationCount()).isZero();
	}

	@Test
	void 재시도_사이에_더_최신_구간이_생기면_과거_후보를_만들지_않는다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		failNotificationSave(1);
		processor.process(analysisId);
		saveVisit((int) pageVisitRepository.count() + 1);

		now.set(now.get().plusSeconds(30));
		processor.recover();

		AlertCandidateTask task = task(analysisId);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.SKIPPED);
		assertThat(task.getSkipReason()).isEqualTo("NOT_LATEST_WINDOW");
		assertThat(task.getErrorCode()).isEqualTo("ALERT_DB_ERROR");
		assertThat(notificationCount()).isZero();
	}

	@Test
	void 정책_미충족은_오류가_아니라_건너뛴_이유로_기록한다() throws Exception {
		// 이전 알림이 실제 표시된 뒤 복귀 없이 DRIFT가 이어지는 경우
		UUID first = driftOnLatestWindow();
		Notification shown = alertService.createAiCandidate(sessionId, first).orElseThrow();
		jdbcTemplate.update("update notification set shown_at = ? where alert_id = ?",
			LocalDateTime.ofInstant(now.get().minus(Duration.ofMinutes(30)), ZoneOffset.UTC), shown.getAlertId().toString());
		saveVisit(6);
		UUID second = completedDrift(latestWindow());
		register(second);

		processor.recover();

		AlertCandidateTask task = task(second);
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.SKIPPED);
		assertThat(task.getSkipReason()).isEqualTo("DRIFT_FLOW_CONTINUES");
		assertThat(task.getErrorCode()).isNull();
		assertThat(task.getAttempts()).isEqualTo(1);
		assertThat(notificationRepository.findByAnalysisId(second)).isEmpty();
	}

	@Test
	void 분석_상태_조회는_작업을_처리하거나_바꾸지_않는다() throws Exception {
		UUID analysisId = driftOnLatestWindow();
		register(analysisId);
		List<Map<String, Object>> before = jdbcTemplate.queryForList("select * from alert_candidate_task");

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId)).andExpect(status().isOk());

		assertThat(jdbcTemplate.queryForList("select * from alert_candidate_task")).isEqualTo(before);
		assertThat(notificationCount()).isZero();
	}

	private void failNotificationSave(int times) {
		AtomicInteger remaining = new AtomicInteger(times);
		AtomicBoolean enabled = new AtomicBoolean(true);
		doAnswer(invocation -> {
			if (enabled.get() && remaining.getAndDecrement() > 0) {
				throw new DataAccessResourceFailureException("주입된 일시 DB 오류");
			}
			return delegate(invocation, NotificationRepository.class);
		}).when(notificationRepository).save(any());
	}

	// Spring Data 저장소 스파이는 인터페이스 프록시라 callRealMethod를 쓸 수 없으므로,
	// 같은 EntityManager(현재 트랜잭션 참여)로 만든 실제 저장소에 호출을 넘긴다
	private <T> Object delegate(InvocationOnMock invocation, Class<T> type) throws Throwable {
		T real = new JpaRepositoryFactory(entityManager).getRepository(type);
		try {
			return invocation.getMethod().invoke(real, invocation.getArguments());
		} catch (InvocationTargetException e) {
			throw e.getCause();
		}
	}

	private void markRunning(UUID analysisId, int attempts, Instant startedAt) {
		jdbcTemplate.update("update alert_candidate_task set status = 'RUNNING', attempts = ?, started_at = ? where analysis_id = ?",
			attempts, LocalDateTime.ofInstant(startedAt, ZoneOffset.UTC), analysisId.toString());
	}

	private void register(UUID analysisId) {
		taskRepository.save(AlertCandidateTask.pending(analysisId, sessionId, now.get()));
	}

	private AlertCandidateTask task(UUID analysisId) {
		return taskRepository.findById(analysisId).orElseThrow();
	}

	private long notificationCount() {
		return jdbcTemplate.queryForObject("select count(*) from notification", Long.class);
	}

	// H2는 JSON 컬럼을 byte[]로 돌려주므로 DB와 무관하게 비교할 수 있도록 문자열로 바꾼다
	private Map<String, Object> analysisRow(UUID analysisId) {
		Map<String, Object> row = jdbcTemplate.queryForMap("select analysis_id, processing_status, result, p_drift, "
			+ "error_code, completed_at, input_snapshot from analysis_result where analysis_id = ?", analysisId.toString());
		row.replaceAll((column, value) -> value instanceof byte[] bytes ? new String(bytes, java.nio.charset.StandardCharsets.UTF_8) : value);
		return row;
	}

	private UUID driftOnLatestWindow() throws Exception {
		for (int sequence = 1; sequence <= 5; sequence++) {
			saveVisit(sequence);
		}
		return completedDrift(latestWindow());
	}

	private AnalysisWindow latestWindow() {
		return analysisWindowRepository.findFirstBySessionIdOrderByWindowIndexDesc(sessionId).orElseThrow();
	}

	private UUID completedDrift(AnalysisWindow window) {
		UUID analysisId = UUID.randomUUID();
		AnalysisResult analysis = AnalysisResult.request(analysisId, window.getWindowId(),
			"{\"analysisId\":\"" + analysisId + "\"}", now.get());
		analysis.start(now.get());
		analysis.finish(new AiAnalysisOutcome(null, "DRIFT", 0.2, 0.2, 0.6, false, null, null, "{\"c\":\"rf\"}", now.get()),
			now.get());
		analysisResultRepository.save(analysis);
		return analysisId;
	}

	private void saveVisit(int sequence) throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
					"domain": "example.com", "activeDurationMs": 1000, "visitedAt": "2026-10-18T01:00:00.000Z"}"""
					.formatted(UUID.randomUUID(), sequence, sequence)))
			.andExpect(status().isCreated());
	}

	private void cleanUp() {
		jdbcTemplate.update("delete from alert_candidate_task");
		jdbcTemplate.update("delete from notification");
		analysisResultRepository.deleteAll();
		analysisWindowRepository.deleteAll();
		pageVisitRepository.deleteAll();
		workSessionRepository.deleteAll();
	}
}
