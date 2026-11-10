package com.focusrecovery.domain.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.lang.reflect.InvocationTargetException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.focusrecovery.domain.alert.entity.AlertCandidateTask;
import com.focusrecovery.domain.alert.entity.AlertTaskStatus;
import com.focusrecovery.domain.alert.entity.Notification;
import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.alert.repository.NotificationResponseRepository;
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

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

// 실제 알림 표시 확인(PATCH shown)과 사용자 선택 저장(POST responses). 서버 현재 시각은 Clock으로 고정하고,
// 시계 오차 허용치(잠정 5초) 경계를 1ms 단위로 확인한다
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AlertDisplayTest {

	private static final Duration TOLERANCE = Duration.ofSeconds(5);
	private static final DateTimeFormatter MILLIS_UTC =
		DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	// 기본은 실제 동작. 경합 테스트에서만 표시 확인을 커밋 전에 멈춘다
	@MockitoSpyBean
	private AlertService alertService;

	@Autowired
	private AlertTaskProcessor alertTaskProcessor;

	@Autowired
	private AlertCandidateTaskRepository taskRepository;

	@PersistenceContext
	private EntityManager entityManager;

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

	// 기본은 실제 저장. 롤백 테스트에서만 저장 실패를 주입한다
	@MockitoSpyBean
	private NotificationResponseRepository responseRepository;

	@MockitoBean
	private Clock clock;

	private final AtomicReference<Instant> now = new AtomicReference<>();
	private UUID sessionId;
	private Notification alert;

	@BeforeEach
	void setUp() throws Exception {
		now.set(Instant.now().truncatedTo(ChronoUnit.MILLIS));
		when(clock.instant()).thenAnswer(invocation -> now.get());
		cleanUp();
		sessionId = newSession();
		alert = aiCandidate(sessionId);
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	@Test
	void 표시_시각은_최초_기록만_유지하고_같은_값_재전송은_200_다른_값은_충돌이다() throws Exception {
		Instant shownAt = alert.getCreatedAt().plusSeconds(3);

		shown(sessionId, alert.getAlertId(), shownAt).andExpect(status().isOk())
			.andExpect(jsonPath("$.alertId").value(alert.getAlertId().toString()))
			.andExpect(jsonPath("$.alertType").value("AI"))
			.andExpect(jsonPath("$.windowIndex").value(1))
			.andExpect(jsonPath("$.shownAt").value(MILLIS_UTC.format(shownAt)))
			.andExpect(jsonPath("$.createdAt").value(MILLIS_UTC.format(alert.getCreatedAt())));
		shown(sessionId, alert.getAlertId(), shownAt).andExpect(status().isOk())
			.andExpect(jsonPath("$.shownAt").value(MILLIS_UTC.format(shownAt)));
		shown(sessionId, alert.getAlertId(), shownAt.plusMillis(1)).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALERT_SHOWN_AT_CONFLICT"));

		assertThat(storedShownAt()).isEqualTo(shownAt);
		assertThat(notificationRepository.findById(alert.getAlertId()).orElseThrow().getCreatedAt())
			.isEqualTo(alert.getCreatedAt());
	}

	@Test
	void 후보_생성_전과_미래_표시_시각은_허용치_경계에서_판단한다() throws Exception {
		Instant created = alert.getCreatedAt();
		shown(sessionId, alert.getAlertId(), created.minus(TOLERANCE).minusMillis(1)).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALERT_NOT_DISPLAYABLE"));
		shown(sessionId, alert.getAlertId(), now.get().plus(TOLERANCE).plusMillis(1)).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALERT_NOT_DISPLAYABLE"));
		assertThat(storedShownAt()).isNull();

		shown(sessionId, alert.getAlertId(), created.minus(TOLERANCE)).andExpect(status().isOk());
		assertThat(storedShownAt()).isEqualTo(created.minus(TOLERANCE));

		Notification other = aiCandidate(newSession());
		shown(other.getSessionId(), other.getAlertId(), now.get().plus(TOLERANCE)).andExpect(status().isOk());
	}

	@Test
	void 종료_후_표시는_허용치를_넘으면_거절하고_경계까지는_저장한다() throws Exception {
		Instant endedAt = endSession(sessionId);
		now.set(endedAt.plus(Duration.ofHours(1)));

		shown(sessionId, alert.getAlertId(), endedAt.plus(TOLERANCE).plusMillis(1)).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("ALERT_NOT_DISPLAYABLE"));
		// 한계: 종료 후 최대 5초 안의 표시는 허용 범위에 들어온다
		shown(sessionId, alert.getAlertId(), endedAt.plus(TOLERANCE)).andExpect(status().isOk());
	}

	@Test
	void 종료_전에_표시된_알림은_확인이_한참_늦게_도착하거나_최신_구간이_바뀌어도_저장한다() throws Exception {
		Instant shownAt = alert.getCreatedAt().plusSeconds(1);
		saveVisit(sessionId, 6);
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		Instant endedAt = endSession(sessionId);
		now.set(endedAt.plus(Duration.ofHours(2)));

		shown(sessionId, alert.getAlertId(), shownAt).andExpect(status().isOk())
			.andExpect(jsonPath("$.shownAt").value(MILLIS_UTC.format(shownAt)));
		respond(sessionId, alert.getAlertId(), "CONTINUE_BROWSING", endedAt.plusSeconds(30), null)
			.andExpect(status().isCreated());
	}

	@Test
	void 다른_세션의_알림과_없는_리소스와_잘못된_입력을_거절한다() throws Exception {
		Notification other = aiCandidate(newSession());
		Instant shownAt = other.getCreatedAt();

		shown(sessionId, other.getAlertId(), shownAt).andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("ALERT_NOT_FOUND"));
		respond(sessionId, other.getAlertId(), "RETURN_TO_GOAL", shownAt, shownAt).andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("ALERT_NOT_FOUND"));
		shown(sessionId, UUID.randomUUID(), shownAt).andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("ALERT_NOT_FOUND"));
		shown(UUID.randomUUID(), alert.getAlertId(), shownAt).andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
		mockMvc.perform(patch("/api/sessions/{sessionId}/alerts/{alertId}/shown", "not-a-uuid", alert.getAlertId())
				.contentType(MediaType.APPLICATION_JSON).content("{\"shownAt\":\"2026-10-18T01:00:00.000Z\"}"))
			.andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		mockMvc.perform(patch("/api/sessions/{sessionId}/alerts/{alertId}/shown", sessionId, alert.getAlertId())
				.contentType(MediaType.APPLICATION_JSON).content("{}"))
			.andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("shownAt"));
		// 밀리초 미만 값은 보정하지 않고 거절한다
		mockMvc.perform(patch("/api/sessions/{sessionId}/alerts/{alertId}/shown", sessionId, alert.getAlertId())
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"shownAt\":\"" + alert.getCreatedAt().plusNanos(1_500_000) + "\"}"))
			.andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		mockMvc.perform(post("/api/sessions/{sessionId}/alerts/{alertId}/responses", sessionId, alert.getAlertId())
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"action\":\"MAYBE\",\"selectedAt\":\"" + MILLIS_UTC.format(shownAt) + "\"}"))
			.andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		assertThat(storedShownAt()).isNull();
		assertThat(notificationRepository.findById(other.getAlertId()).orElseThrow().getShownAt()).isNull();
		assertThat(responseRepository.count()).isZero();
	}

	@Test
	void 사용자_선택은_최초_저장_201_같은_재전송_200_다른_선택은_충돌이다() throws Exception {
		Instant shownAt = alert.getCreatedAt().plusSeconds(2);
		shown(sessionId, alert.getAlertId(), shownAt).andExpect(status().isOk());
		now.set(now.get().plusSeconds(30));
		Instant selectedAt = shownAt.plusSeconds(4);

		String feedbackId = JsonPath.read(respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", selectedAt, null)
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.alertId").value(alert.getAlertId().toString()))
			.andExpect(jsonPath("$.action").value("RETURN_TO_GOAL"))
			.andExpect(jsonPath("$.selectedAt").value(MILLIS_UTC.format(selectedAt)))
			.andReturn().getResponse().getContentAsString(), "$.feedbackId");

		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", selectedAt, shownAt).andExpect(status().isOk())
			.andExpect(jsonPath("$.feedbackId").value(feedbackId));
		respond(sessionId, alert.getAlertId(), "CONTINUE_BROWSING", selectedAt, null).andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("RESPONSE_ALREADY_RECORDED"));
		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", selectedAt.plusMillis(1), null)
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RESPONSE_ALREADY_RECORDED"));
		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", selectedAt, shownAt.plusMillis(1))
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ALERT_SHOWN_AT_CONFLICT"));
		assertThat(responseRepository.count()).isEqualTo(1);
		// DB도 알림당 응답 하나를 보장한다
		assertThatThrownBy(() -> jdbcTemplate.update("insert into notification_response values (?, ?, 'RETURN_TO_GOAL', ?)",
			UUID.randomUUID().toString(), alert.getAlertId().toString(), java.time.LocalDateTime.now()))
			.isInstanceOf(DataIntegrityViolationException.class);
	}

	@Test
	void 응답이_표시_확인보다_먼저_오면_shownAt과_선택을_함께_저장한다() throws Exception {
		Instant shownAt = alert.getCreatedAt().plusSeconds(1);

		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", shownAt.plusSeconds(2), null)
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ALERT_NOT_SHOWN"));
		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", now.get(), now.get().plus(TOLERANCE).plusMillis(1))
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ALERT_NOT_DISPLAYABLE"));
		assertThat(storedShownAt()).isNull();
		assertThat(responseRepository.count()).isZero();

		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", shownAt.plusSeconds(2), shownAt)
			.andExpect(status().isCreated());
		assertThat(storedShownAt()).isEqualTo(shownAt);
		// 늦게 도착한 표시 확인은 같은 값이면 200
		shown(sessionId, alert.getAlertId(), shownAt).andExpect(status().isOk());
	}

	@Test
	void selectedAt은_shownAt보다_앞설_수_없고_서버_시각보다_미래일_수_없다() throws Exception {
		Instant shownAt = alert.getCreatedAt().plusSeconds(1);

		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", shownAt.minusMillis(1), shownAt)
			.andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", now.get().plus(TOLERANCE).plusMillis(1), shownAt)
			.andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		// 검증 실패는 shownAt도 남기지 않는다
		assertThat(storedShownAt()).isNull();

		respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", shownAt, shownAt).andExpect(status().isCreated());
	}

	@Test
	void 응답_저장이_실패하면_함께_보낸_shownAt도_롤백된다() throws Exception {
		doThrow(new DataAccessResourceFailureException("주입된 저장 실패")).when(responseRepository).saveAndFlush(any());
		Instant shownAt = alert.getCreatedAt().plusSeconds(1);

		assertThatThrownBy(() -> respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL", shownAt.plusSeconds(1), shownAt))
			.hasRootCauseInstanceOf(DataAccessResourceFailureException.class);

		assertThat(storedShownAt()).isNull();
		assertThat(jdbcTemplate.queryForObject("select count(*) from notification_response", Long.class)).isZero();
	}

	@Test
	void 같은_응답과_서로_다른_응답이_동시에_와도_선택은_하나다() throws Exception {
		Instant shownAt = alert.getCreatedAt().plusSeconds(1);
		List<MockHttpServletResponse> results = concurrently(8, i ->
			respond(sessionId, alert.getAlertId(), i % 2 == 0 ? "RETURN_TO_GOAL" : "CONTINUE_BROWSING",
				shownAt.plusSeconds(1), shownAt).andReturn().getResponse());

		List<Integer> statuses = results.stream().map(MockHttpServletResponse::getStatus).toList();
		assertThat(statuses).containsOnlyOnce(201).allMatch(code -> code == 201 || code == 200 || code == 409);
		String winner = JsonPath.read(results.get(statuses.indexOf(201)).getContentAsString(), "$.action");
		for (MockHttpServletResponse result : results) {
			if (result.getStatus() == 200) {
				assertThat((String) JsonPath.read(result.getContentAsString(), "$.action")).isEqualTo(winner);
			} else if (result.getStatus() == 409) {
				assertThat((String) JsonPath.read(result.getContentAsString(), "$.code")).isEqualTo("RESPONSE_ALREADY_RECORDED");
			}
		}
		assertThat(responseRepository.count()).isEqualTo(1);
		assertThat(storedShownAt()).isEqualTo(shownAt);
	}

	@Test
	void 서로_다른_표시_시각이_동시에_와도_최초_하나만_기록된다() throws Exception {
		Instant base = alert.getCreatedAt();
		List<MockHttpServletResponse> results = concurrently(8, i ->
			shown(sessionId, alert.getAlertId(), base.plusMillis(i % 2)).andReturn().getResponse());

		Instant stored = storedShownAt();
		assertThat(stored).isIn(base, base.plusMillis(1));
		for (MockHttpServletResponse result : results) {
			assertThat(result.getStatus()).isIn(200, 409);
		}
		assertThat(results.stream().filter(r -> r.getStatus() == 200).count()).isEqualTo(4);
	}

	@Test
	void 표시가_기록되면_이어지는_DRIFT의_AI_후보가_제한된다() throws Exception {
		shown(sessionId, alert.getAlertId(), alert.getCreatedAt()).andExpect(status().isOk());
		saveVisit(sessionId, 6);
		UUID next = completedDrift(latestWindow(sessionId));

		assertThat(alertService.createAiCandidate(sessionId, next)).isEmpty();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));
	}

	// 1) 표시 확인이 shownAt을 바꾸고 커밋 전에 멈춤(세션 배타 잠금 보유) 2) 후보 생성 작업 시작 → 세션 공유 잠금에서 대기
	// 3) 표시 확인 커밋 후 후보 생성이 커밋된 표시 이력을 보고 연속 DRIFT로 건너뜀
	@Test
	void 표시_확인이_커밋되기_전에_시작한_후보_생성은_기다렸다가_연속_DRIFT_제한을_적용한다() throws Exception {
		UUID next = completedDrift(nextWindow(sessionId));
		registerTask(next);
		Pause pause = pauseAtShownResponse();

		Future<MockHttpServletResponse> showing = async(() ->
			shown(sessionId, alert.getAlertId(), alert.getCreatedAt()).andReturn().getResponse());
		pause.awaitPaused();
		Future<?> candidate = async(() -> {
			alertTaskProcessor.process(next);
			return null;
		});
		assertWaiting(candidate, next);

		pause.resume();
		assertThat(showing.get(10, TimeUnit.SECONDS).getStatus()).isEqualTo(200);
		candidate.get(10, TimeUnit.SECONDS);

		assertSkipped(next, "DRIFT_FLOW_CONTINUES");
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	@Test
	void 표시_확인이_커밋되기_전에_시작한_후보_생성은_기다렸다가_최소_간격_제한을_적용한다() throws Exception {
		completedNormal(nextWindow(sessionId));
		UUID next = completedDrift(nextWindow(sessionId));
		registerTask(next);
		Pause pause = pauseAtShownResponse();

		Future<MockHttpServletResponse> showing = async(() ->
			shown(sessionId, alert.getAlertId(), now.get()).andReturn().getResponse());
		pause.awaitPaused();
		Future<?> candidate = async(() -> {
			alertTaskProcessor.process(next);
			return null;
		});
		assertWaiting(candidate, next);

		pause.resume();
		assertThat(showing.get(10, TimeUnit.SECONDS).getStatus()).isEqualTo(200);
		candidate.get(10, TimeUnit.SECONDS);

		assertSkipped(next, "MIN_INTERVAL_NOT_PASSED");
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	// 응답 API가 shownAt을 처음 저장하는 경우도 같은 세션 배타 잠금으로 직렬화된다
	@Test
	void 응답이_shownAt을_처음_저장하는_동안_시작한_후보_생성도_기다렸다가_제한을_적용한다() throws Exception {
		UUID next = completedDrift(nextWindow(sessionId));
		registerTask(next);
		CountDownLatch paused = new CountDownLatch(1);
		CountDownLatch resume = new CountDownLatch(1);
		doAnswer(invocation -> {
			paused.countDown();
			assertThat(resume.await(10, TimeUnit.SECONDS)).isTrue();
			return delegate(invocation);
		}).when(responseRepository).saveAndFlush(any());

		Future<MockHttpServletResponse> responding = async(() -> respond(sessionId, alert.getAlertId(), "RETURN_TO_GOAL",
			alert.getCreatedAt(), alert.getCreatedAt()).andReturn().getResponse());
		assertThat(paused.await(5, TimeUnit.SECONDS)).isTrue();
		Future<?> candidate = async(() -> {
			alertTaskProcessor.process(next);
			return null;
		});
		assertWaiting(candidate, next);

		resume.countDown();
		assertThat(responding.get(10, TimeUnit.SECONDS).getStatus()).isEqualTo(201);
		candidate.get(10, TimeUnit.SECONDS);

		assertSkipped(next, "DRIFT_FLOW_CONTINUES");
		assertThat(storedShownAt()).isEqualTo(alert.getCreatedAt());
		assertThat(notificationRepository.count()).isEqualTo(1);
	}

	// 후보 생성이 먼저 끝나 후보가 이미 있을 수 있다. 이후 표시 확인이 반영되면 조회의 재검증으로 그 후보는 반환되지 않는다
	@Test
	void 후보가_먼저_생긴_뒤_표시_확인이_반영되면_조회에서_부적격_후보를_반환하지_않는다() throws Exception {
		Notification newer = alertService.createAiCandidate(sessionId, completedDrift(nextWindow(sessionId))).orElseThrow();
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert.alertId").value(newer.getAlertId().toString()));

		shown(sessionId, alert.getAlertId(), alert.getCreatedAt()).andExpect(status().isOk());

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		Notification kept = notificationRepository.findById(newer.getAlertId()).orElseThrow();
		assertThat(kept.getShownAt()).isNull();
	}

	// 구간 1 DRIFT(A1) → 구간 2 NORMAL → 구간 3 DRIFT(A3). 모두 같은 시각 base에 후보가 만들어진다
	private Notification[] driftNormalDrift() throws Exception {
		completed(nextWindow(sessionId), "NORMAL");
		Notification a3 = alertService.createAiCandidate(sessionId, completedDrift(nextWindow(sessionId))).orElseThrow();
		return new Notification[] {alert, a3};
	}

	// 큰 구간(3)의 확인이 먼저 오고 작은 구간(1)의 확인이 늦게 와도 연속 DRIFT 기준은 최대 windowIndex(3)다.
	// 기준이 늦게 온 구간 1로 돌아가면 구간 2 NORMAL을 복귀로 보고 후보를 만들었을 것이다
	@Test
	void 작은_구간의_확인이_늦게_도착해도_연속_DRIFT_기준은_최대_windowIndex다() throws Exception {
		Instant base = alert.getCreatedAt();
		Notification[] alerts = driftNormalDrift();
		now.set(base.plus(Duration.ofHours(1)));
		shown(sessionId, alerts[1].getAlertId(), base.plus(Duration.ofMinutes(2))).andExpect(status().isOk());
		shown(sessionId, alerts[0].getAlertId(), base.plus(Duration.ofMinutes(1))).andExpect(status().isOk());

		UUID next = completedDrift(nextWindow(sessionId));
		registerTask(next);
		alertTaskProcessor.process(next);

		assertSkipped(next, "DRIFT_FLOW_CONTINUES");
	}

	// 최대 windowIndex 알림(A3, 10분 표시)과 최대 shownAt 알림(A1, 50분 표시)이 다르다.
	// 연속 DRIFT는 A3의 구간 3, 최소 간격은 A1의 50분을 기준으로 해야 한다
	@Test
	void 연속_DRIFT와_최소_간격은_각각_최대_windowIndex와_최대_shownAt을_기준으로_한다() throws Exception {
		Instant base = alert.getCreatedAt();
		Notification[] alerts = driftNormalDrift();
		now.set(base.plus(Duration.ofMinutes(54)));
		shown(sessionId, alerts[1].getAlertId(), base.plus(Duration.ofMinutes(10))).andExpect(status().isOk());
		shown(sessionId, alerts[0].getAlertId(), base.plus(Duration.ofMinutes(50))).andExpect(status().isOk());

		// 구간 3 뒤에 복귀가 없으므로 연속 DRIFT(A1의 구간 1을 기준으로 했다면 구간 2 NORMAL 때문에 통과했을 것)
		UUID w4 = completedDrift(nextWindow(sessionId));
		registerTask(w4);
		alertTaskProcessor.process(w4);
		assertSkipped(w4, "DRIFT_FLOW_CONTINUES");

		// 구간 5 TRANSITION으로 복귀한 뒤의 DRIFT: 최소 간격은 A1의 50분부터(A3의 10분이었다면 이미 지남)
		completed(nextWindow(sessionId), "TRANSITION");
		UUID w6 = completedDrift(nextWindow(sessionId));
		registerTask(w6);
		alertTaskProcessor.process(w6);
		assertSkipped(w6, "MIN_INTERVAL_NOT_PASSED");

		now.set(base.plus(Duration.ofMinutes(55)));
		UUID w7 = completedDrift(nextWindow(sessionId));
		registerTask(w7);
		alertTaskProcessor.process(w7);
		assertThat(taskRepository.findById(w7).orElseThrow().getStatus()).isEqualTo(AlertTaskStatus.CREATED);
	}

	// 최소 간격의 시작은 기록된 shownAt(최대값)이며, 같은 값 재전송이나 더 이른 shownAt의 늦은 확인이 도착한 시각으로 바뀌지 않는다
	@Test
	void 같은_shownAt_재전송과_늦은_확인은_최소_간격의_시작_시각을_바꾸지_않는다() throws Exception {
		Instant base = alert.getCreatedAt();
		Notification a2 = alertService.createAiCandidate(sessionId, completedDrift(nextWindow(sessionId))).orElseThrow();
		now.set(base.plus(Duration.ofMinutes(10)));
		shown(sessionId, a2.getAlertId(), base.plus(Duration.ofMinutes(10))).andExpect(status().isOk());

		now.set(base.plus(Duration.ofMinutes(14)));
		shown(sessionId, a2.getAlertId(), base.plus(Duration.ofMinutes(10))).andExpect(status().isOk());
		shown(sessionId, alert.getAlertId(), base.plus(Duration.ofMinutes(8))).andExpect(status().isOk());
		assertThat(notificationRepository.findById(a2.getAlertId()).orElseThrow().getShownAt())
			.isEqualTo(base.plus(Duration.ofMinutes(10)));

		// 시작 시각이 도착 시각(14분)으로 바뀌었다면 15분에는 아직 5분이 지나지 않는다
		completed(nextWindow(sessionId), "NORMAL");
		now.set(base.plus(Duration.ofMinutes(15)));
		UUID next = completedDrift(nextWindow(sessionId));
		registerTask(next);
		alertTaskProcessor.process(next);

		assertThat(taskRepository.findById(next).orElseThrow().getStatus()).isEqualTo(AlertTaskStatus.CREATED);
	}

	private void completed(AnalysisWindow window, String result) {
		AnalysisResult analysis = AnalysisResult.request(UUID.randomUUID(), window.getWindowId(), "{}", now.get());
		analysis.start(now.get());
		analysis.finish(new AiAnalysisOutcome(null, result, 0.4, 0.4, 0.2, false, null, null, "{\"c\":\"rf\"}", now.get()),
			now.get());
		analysisResultRepository.save(analysis);
	}

	private record Pause(CountDownLatch pausedLatch, CountDownLatch resumeLatch) {

		void awaitPaused() throws InterruptedException {
			assertThat(pausedLatch.await(5, TimeUnit.SECONDS)).isTrue();
		}

		void resume() {
			resumeLatch.countDown();
		}
	}

	// markShown이 shownAt을 바꾼 뒤 응답을 만들 때(커밋 전) 멈춘다
	private Pause pauseAtShownResponse() {
		Pause pause = new Pause(new CountDownLatch(1), new CountDownLatch(1));
		AlertService target = AopTestUtils.getUltimateTargetObject(alertService);
		doAnswer(invocation -> {
			pause.pausedLatch().countDown();
			assertThat(pause.resumeLatch().await(10, TimeUnit.SECONDS)).isTrue();
			return invocation.callRealMethod();
		}).when(target).toResponse(any(), any());
		return pause;
	}

	// 후보 생성은 작업을 가져간(RUNNING) 뒤 세션 잠금을 기다리며 끝나지 않아야 한다
	private void assertWaiting(Future<?> candidate, UUID analysisId) throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (!"RUNNING".equals(taskStatus(analysisId)) && System.nanoTime() < deadline) {
			Thread.sleep(10);
		}
		assertThat(taskStatus(analysisId)).isEqualTo("RUNNING");
		Thread.sleep(300);
		assertThat(candidate.isDone()).isFalse();
	}

	private String taskStatus(UUID analysisId) {
		return jdbcTemplate.queryForObject("select status from alert_candidate_task where analysis_id = ?", String.class,
			analysisId.toString());
	}

	private void assertSkipped(UUID analysisId, String reason) {
		AlertCandidateTask task = taskRepository.findById(analysisId).orElseThrow();
		assertThat(task.getStatus()).isEqualTo(AlertTaskStatus.SKIPPED);
		assertThat(task.getSkipReason()).isEqualTo(reason);
		assertThat(task.getErrorCode()).isNull();
		assertThat(notificationRepository.findByAnalysisId(analysisId)).isEmpty();
	}

	private void registerTask(UUID analysisId) {
		taskRepository.save(AlertCandidateTask.pending(analysisId, sessionId, now.get()));
	}

	private <T> Future<T> async(java.util.concurrent.Callable<T> task) {
		ExecutorService executor = Executors.newSingleThreadExecutor();
		Future<T> future = executor.submit(task);
		executor.shutdown();
		return future;
	}

	// Spring Data 저장소 스파이는 callRealMethod를 쓸 수 없어 같은 EntityManager로 만든 실제 저장소에 넘긴다
	private Object delegate(InvocationOnMock invocation) throws Throwable {
		NotificationResponseRepository real = new JpaRepositoryFactory(entityManager)
			.getRepository(NotificationResponseRepository.class);
		try {
			return invocation.getMethod().invoke(real, invocation.getArguments());
		} catch (InvocationTargetException e) {
			throw e.getCause();
		}
	}

	private AnalysisWindow nextWindow(UUID session) throws Exception {
		saveVisit(session, (int) jdbcTemplate.queryForObject(
			"select count(*) from page_visit where session_id = ?", Long.class, session.toString()).longValue() + 1);
		return latestWindow(session);
	}

	private void completedNormal(AnalysisWindow window) {
		AnalysisResult analysis = AnalysisResult.request(UUID.randomUUID(), window.getWindowId(), "{}", now.get());
		analysis.start(now.get());
		analysis.finish(new AiAnalysisOutcome(null, "NORMAL", 0.7, 0.2, 0.1, false, null, null, "{\"c\":\"rf\"}", now.get()),
			now.get());
		analysisResultRepository.save(analysis);
	}

	private interface Task<T> {
		T run(int index) throws Exception;
	}

	private <T> List<T> concurrently(int count, Task<T> task) throws Exception {
		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(count);
		try {
			List<Future<T>> futures = new ArrayList<>();
			for (int i = 0; i < count; i++) {
				int index = i;
				futures.add(executor.submit(() -> {
					ready.await();
					return task.run(index);
				}));
			}
			ready.countDown();
			List<T> results = new ArrayList<>();
			for (Future<T> future : futures) {
				results.add(future.get(10, TimeUnit.SECONDS));
			}
			return results;
		} finally {
			executor.shutdown();
		}
	}

	private ResultActions shown(UUID session, UUID alertId, Instant shownAt) throws Exception {
		return mockMvc.perform(patch("/api/sessions/{sessionId}/alerts/{alertId}/shown", session, alertId)
			.contentType(MediaType.APPLICATION_JSON).content("{\"shownAt\":\"" + MILLIS_UTC.format(shownAt) + "\"}"));
	}

	private ResultActions respond(UUID session, UUID alertId, String action, Instant selectedAt, Instant shownAt)
		throws Exception {
		String body = "{\"action\":\"" + action + "\",\"selectedAt\":\"" + MILLIS_UTC.format(selectedAt) + "\""
			+ (shownAt == null ? "" : ",\"shownAt\":\"" + MILLIS_UTC.format(shownAt) + "\"") + "}";
		return mockMvc.perform(post("/api/sessions/{sessionId}/alerts/{alertId}/responses", session, alertId)
			.contentType(MediaType.APPLICATION_JSON).content(body));
	}

	private Instant storedShownAt() {
		return notificationRepository.findById(alert.getAlertId()).orElseThrow().getShownAt();
	}

	private Instant endSession(UUID session) throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/end", session)).andExpect(status().isOk());
		return workSessionRepository.findById(session).orElseThrow().getEndedAt();
	}

	private UUID newSession() {
		return workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start("알림 표시 테스트 목표", null)).getSessionId();
	}

	// 세션에 구간 1(최신)의 COMPLETED·DRIFT 분석과 AI 후보를 만든다
	private Notification aiCandidate(UUID session) throws Exception {
		for (int sequence = 1; sequence <= 5; sequence++) {
			saveVisit(session, sequence);
		}
		return alertService.createAiCandidate(session, completedDrift(latestWindow(session))).orElseThrow();
	}

	private AnalysisWindow latestWindow(UUID session) {
		return analysisWindowRepository.findFirstBySessionIdOrderByWindowIndexDesc(session).orElseThrow();
	}

	private UUID completedDrift(AnalysisWindow window) {
		UUID analysisId = UUID.randomUUID();
		AnalysisResult analysis = AnalysisResult.request(analysisId, window.getWindowId(), "{}", now.get());
		analysis.start(now.get());
		analysis.finish(new AiAnalysisOutcome(null, "DRIFT", 0.2, 0.2, 0.6, false, null, null, "{\"c\":\"rf\"}", now.get()),
			now.get());
		analysisResultRepository.save(analysis);
		return analysisId;
	}

	private void saveVisit(UUID session, int sequence) throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/visits", session)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
					"domain": "example.com", "activeDurationMs": 1000, "visitedAt": "2026-10-18T01:00:00.000Z"}"""
					.formatted(UUID.randomUUID(), sequence, sequence)))
			.andExpect(status().isCreated());
	}

	private void cleanUp() {
		jdbcTemplate.update("delete from notification_response");
		jdbcTemplate.update("delete from alert_candidate_task");
		jdbcTemplate.update("delete from notification");
		analysisResultRepository.deleteAll();
		analysisWindowRepository.deleteAll();
		pageVisitRepository.deleteAll();
		workSessionRepository.deleteAll();
	}
}
