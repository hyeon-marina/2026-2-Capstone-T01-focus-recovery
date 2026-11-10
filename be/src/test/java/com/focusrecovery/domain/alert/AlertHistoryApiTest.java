package com.focusrecovery.domain.alert;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
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
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.focusrecovery.domain.alert.entity.Notification;
import com.focusrecovery.domain.alert.entity.NotificationResponse;
import com.focusrecovery.domain.alert.entity.ResponseAction;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.alert.repository.NotificationResponseRepository;
import com.focusrecovery.domain.analysis.client.AiAnalysisOutcome;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;

import jakarta.persistence.EntityManagerFactory;

// 알림·사용자 선택 이력 조회. 알림·응답은 저장소로 직접 만들어 생성 시각과 상태를 고정한다.
// N+1 여부는 이 클래스에서만 켠 Hibernate 통계의 SQL 실행 수로 확인한다
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
class AlertHistoryApiTest {

	private static final String GOAL = "알림 이력 테스트 목표";
	private static final Instant BASE = Instant.parse("2026-10-18T01:00:00.000Z");
	private static final DateTimeFormatter MILLIS_UTC =
		DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private EntityManagerFactory entityManagerFactory;

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
	private NotificationResponseRepository responseRepository;

	private UUID sessionId;

	@BeforeEach
	void setUp() {
		cleanUp();
		sessionId = newSession();
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	@Test
	void 알림이_없으면_빈_목록이다() throws Exception {
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty())
			.andExpect(jsonPath("$.page").value(0))
			.andExpect(jsonPath("$.size").value(20))
			.andExpect(jsonPath("$.totalElements").value(0))
			.andExpect(jsonPath("$.hasNext").value(false));
	}

	@Test
	void 두_유형과_미표시_미응답_응답완료_상태를_Alert_필드와_response로_반환한다() throws Exception {
		List<AnalysisWindow> windows = windows(sessionId, 2);
		Notification unshownAi = save(Notification.ai(sessionId, drift(windows.get(0)), "AI 알림", BASE), null);
		Notification shownFixed = save(Notification.fixedInterval(sessionId, "고정 알림", BASE.plusSeconds(590),
			BASE.plusSeconds(600)), BASE.plusSeconds(605));
		Notification answeredAi = save(Notification.ai(sessionId, drift(windows.get(1)), "AI 알림 2", BASE.plusSeconds(1200)),
			BASE.plusSeconds(1203));
		NotificationResponse response = responseRepository.save(
			NotificationResponse.of(answeredAi.getAlertId(), ResponseAction.CONTINUE_BROWSING, BASE.plusSeconds(1209)));

		String body = mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.totalElements").value(3))
			.andExpect(jsonPath("$.items[*].alertId", contains(answeredAi.getAlertId().toString(),
				shownFixed.getAlertId().toString(), unshownAi.getAlertId().toString())))
			// 응답 완료 AI 알림
			.andExpect(jsonPath("$.items[0].sessionId").value(sessionId.toString()))
			.andExpect(jsonPath("$.items[0].alertType").value("AI"))
			.andExpect(jsonPath("$.items[0].analysisId").value(answeredAi.getAnalysisId().toString()))
			.andExpect(jsonPath("$.items[0].windowIndex").value(2))
			.andExpect(jsonPath("$.items[0].goalText").value(GOAL))
			.andExpect(jsonPath("$.items[0].message").value("AI 알림 2"))
			.andExpect(jsonPath("$.items[0].createdAt").value(MILLIS_UTC.format(BASE.plusSeconds(1200))))
			.andExpect(jsonPath("$.items[0].shownAt").value(MILLIS_UTC.format(BASE.plusSeconds(1203))))
			.andExpect(jsonPath("$.items[0].response.feedbackId").value(response.getFeedbackId().toString()))
			.andExpect(jsonPath("$.items[0].response.alertId").value(answeredAi.getAlertId().toString()))
			.andExpect(jsonPath("$.items[0].response.action").value("CONTINUE_BROWSING"))
			.andExpect(jsonPath("$.items[0].response.selectedAt").value(MILLIS_UTC.format(BASE.plusSeconds(1209))))
			// 표시됐지만 미응답 고정 주기 알림
			.andExpect(jsonPath("$.items[1].alertType").value("FIXED_INTERVAL"))
			.andExpect(jsonPath("$.items[1].analysisId").value(nullValue()))
			.andExpect(jsonPath("$.items[1].windowIndex").value(nullValue()))
			.andExpect(jsonPath("$.items[1].shownAt").value(MILLIS_UTC.format(BASE.plusSeconds(605))))
			.andExpect(jsonPath("$.items[1].response").value(nullValue()))
			// 미표시 AI 후보
			.andExpect(jsonPath("$.items[2].windowIndex").value(1))
			.andExpect(jsonPath("$.items[2].shownAt").value(nullValue()))
			.andExpect(jsonPath("$.items[2].response").value(nullValue()))
			.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

		// response·shownAt은 null을 명시하고, Alert를 다시 감싸거나 내부 필드(scheduledAt)를 노출하지 않는다
		assertThat(body).contains("\"response\":null", "\"shownAt\":null")
			.doesNotContain("scheduledAt", "\"alert\":", "inputSnapshot");
	}

	@Test
	void 생성_시각이_같으면_alertId_내림차순이고_페이지와_전체_건수를_DB에서_나눈다() throws Exception {
		List<UUID> sameTime = new ArrayList<>();
		for (int i = 0; i < 3; i++) {
			sameTime.add(save(Notification.fixedInterval(sessionId, "같은 시각", BASE.plusSeconds(i), BASE.plusSeconds(600)), null)
				.getAlertId());
		}
		UUID newest = save(Notification.fixedInterval(sessionId, "최신", BASE.plusSeconds(10), BASE.plusSeconds(700)), null)
			.getAlertId();
		UUID oldest = save(Notification.fixedInterval(sessionId, "가장 오래됨", BASE.plusSeconds(20), BASE), null).getAlertId();
		List<String> expected = new ArrayList<>();
		expected.add(newest.toString());
		sameTime.stream().map(UUID::toString).sorted(Comparator.reverseOrder()).forEach(expected::add);
		expected.add(oldest.toString());

		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId).param("size", "2"))
			.andExpect(jsonPath("$.items[*].alertId", contains(expected.get(0), expected.get(1))))
			.andExpect(jsonPath("$.totalElements").value(5))
			.andExpect(jsonPath("$.hasNext").value(true));
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId).param("page", "1").param("size", "2"))
			.andExpect(jsonPath("$.items[*].alertId", contains(expected.get(2), expected.get(3))))
			.andExpect(jsonPath("$.hasNext").value(true));
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId).param("page", "2").param("size", "2"))
			.andExpect(jsonPath("$.items[*].alertId", contains(expected.get(4))))
			.andExpect(jsonPath("$.page").value(2))
			.andExpect(jsonPath("$.size").value(2))
			.andExpect(jsonPath("$.hasNext").value(false));
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId).param("page", "3").param("size", "2"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty())
			.andExpect(jsonPath("$.totalElements").value(5));
	}

	// 0페이지 조회 → 새 알림 생성 → 1페이지 조회: 기존 항목이 한 칸 밀려 0페이지 마지막 항목이 1페이지 첫 항목으로 다시 나온다.
	// 정렬은 같은 데이터에서의 순서만 정하며 요청 사이의 스냅샷 일관성은 보장하지 않는다(Swagger에 명시한 한계)
	@Test
	void 페이지를_넘기는_사이_새_알림이_생기면_중복과_결과_변동이_생길_수_있다() throws Exception {
		List<String> ids = new ArrayList<>();
		for (int i = 0; i < 5; i++) {
			ids.add(0, save(Notification.fixedInterval(sessionId, "알림 " + i, BASE.plusSeconds(i), BASE.plusSeconds(600L * (i + 1))),
				null).getAlertId().toString());
		}
		String page0 = mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId).param("size", "2"))
			.andExpect(jsonPath("$.items[*].alertId", contains(ids.get(0), ids.get(1))))
			.andExpect(jsonPath("$.totalElements").value(5))
			.andReturn().getResponse().getContentAsString();

		String added = save(Notification.fixedInterval(sessionId, "새 알림", BASE.plusSeconds(100), BASE.plusSeconds(6000)), null)
			.getAlertId().toString();

		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId).param("page", "1").param("size", "2"))
			.andExpect(jsonPath("$.items[*].alertId", contains(ids.get(1), ids.get(2))))
			.andExpect(jsonPath("$.totalElements").value(6));
		// 새 알림은 0페이지를 다시 조회해야 보인다
		assertThat(page0).doesNotContain(added);
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId).param("size", "2"))
			.andExpect(jsonPath("$.items[0].alertId").value(added));
	}

	@ParameterizedTest
	@ValueSource(strings = {"page=-1", "size=0", "size=101", "page=abc", "size=1.5", "page=21474837&size=100"})
	void 잘못된_페이지_값은_400이다(String query) throws Exception {
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts?" + query, sessionId))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
	}

	@Test
	void 잘못된_UUID는_400이고_없는_세션은_404다() throws Exception {
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", "not-a-uuid"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", UUID.randomUUID()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
	}

	@Test
	void 다른_세션의_알림과_응답은_포함하지_않는다() throws Exception {
		UUID other = newSession();
		Notification mine = save(Notification.fixedInterval(sessionId, "내 알림", BASE, BASE.plusSeconds(600)), null);
		Notification others = save(Notification.fixedInterval(other, "다른 세션 알림", BASE, BASE.plusSeconds(900)),
			BASE.plusSeconds(901));
		responseRepository.save(NotificationResponse.of(others.getAlertId(), ResponseAction.RETURN_TO_GOAL, BASE.plusSeconds(902)));

		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId))
			.andExpect(jsonPath("$.totalElements").value(1))
			.andExpect(jsonPath("$.items[*].alertId", contains(mine.getAlertId().toString())))
			.andExpect(jsonPath("$.items[0].response").value(nullValue()))
			.andExpect(content().string(not(containsString(others.getAlertId().toString()))));
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", other))
			.andExpect(jsonPath("$.totalElements").value(1))
			.andExpect(jsonPath("$.items[0].response.action").value("RETURN_TO_GOAL"));
	}

	// 종료된 세션, 현재 서버 모드(AI)와 다른 고정 주기 알림, 더 이상 현재 후보가 아닌 이전 구간 알림도 모두 이력에 남는다
	@Test
	void 종료된_세션과_현재_후보가_아닌_알림도_조회한다() throws Exception {
		List<AnalysisWindow> windows = windows(sessionId, 3);
		save(Notification.ai(sessionId, drift(windows.get(0)), "이전 구간 후보", BASE), null);
		save(Notification.fixedInterval(sessionId, "고정 알림", BASE, BASE.plusSeconds(600)), null);
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.totalElements").value(2));
	}

	@Test
	void 조회는_데이터를_바꾸지_않고_알림_수와_무관하게_쿼리_수가_일정하다() throws Exception {
		List<AnalysisWindow> windows = windows(sessionId, 6);
		for (int i = 0; i < windows.size(); i++) {
			Notification alert = save(Notification.ai(sessionId, drift(windows.get(i)), "알림 " + i, BASE.plusSeconds(i)),
				BASE.plusSeconds(i + 1));
			responseRepository.save(NotificationResponse.of(alert.getAlertId(), ResponseAction.RETURN_TO_GOAL,
				BASE.plusSeconds(i + 2)));
		}
		for (int i = 0; i < 4; i++) {
			save(Notification.fixedInterval(sessionId, "고정 " + i, BASE.plusSeconds(600L * (i + 1)), BASE.plusSeconds(700L * (i + 1))),
				null);
		}
		List<List<Map<String, Object>>> before = snapshot();
		Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
		statistics.clear();

		mockMvc.perform(get("/api/sessions/{sessionId}/alerts", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items.length()").value(10))
			.andExpect(jsonPath("$.items[9].response.action").value("RETURN_TO_GOAL"));

		// 세션 조회 + 페이지 조회 + 전체 건수 조회. 알림 10건마다 응답·분석을 따로 조회하지 않는다
		assertThat(statistics.getPrepareStatementCount()).isLessThanOrEqualTo(3);
		assertThat(statistics.getEntityLoadCount()).isLessThanOrEqualTo(1);
		assertThat(snapshot()).isEqualTo(before);
	}

	private List<List<Map<String, Object>>> snapshot() {
		List<List<Map<String, Object>>> tables = new ArrayList<>();
		for (String table : List.of("notification", "notification_response", "alert_candidate_task", "work_session")) {
			tables.add(jdbcTemplate.queryForList("select * from " + table + " order by 1"));
		}
		tables.add(jdbcTemplate.queryForList("select analysis_id, processing_status, result, completed_at from analysis_result order by 1"));
		return tables;
	}

	private Notification save(Notification notification, Instant shownAt) {
		if (shownAt != null) {
			notification.markShown(shownAt);
		}
		return notificationRepository.save(notification);
	}

	private UUID drift(AnalysisWindow window) {
		UUID analysisId = UUID.randomUUID();
		AnalysisResult analysis = AnalysisResult.request(analysisId, window.getWindowId(), "{\"large\":\"snapshot\"}", BASE);
		analysis.start(BASE);
		analysis.finish(new AiAnalysisOutcome(null, "DRIFT", 0.2, 0.2, 0.6, true, "{\"c\":1}", "{\"f\":1}",
			"{\"m\":\"rf\"}", BASE), BASE);
		analysisResultRepository.save(analysis);
		return analysisId;
	}

	// 체류 1초 방문을 저장해 분석 요청 없이 구간 n개를 만든다
	private List<AnalysisWindow> windows(UUID session, int count) throws Exception {
		for (int sequence = 1; sequence <= count + 4; sequence++) {
			mockMvc.perform(post("/api/sessions/{sessionId}/visits", session)
					.contentType(MediaType.APPLICATION_JSON)
					.content("""
						{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
						"domain": "example.com", "activeDurationMs": 1000, "visitedAt": "2026-10-18T01:00:00.000Z"}"""
						.formatted(UUID.randomUUID(), sequence, sequence)))
				.andExpect(status().isCreated());
		}
		return analysisWindowRepository.findAll().stream().filter(window -> window.getSessionId().equals(session))
			.sorted(Comparator.comparingInt(AnalysisWindow::getWindowIndex)).toList();
	}

	private UUID newSession() {
		return workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start(GOAL, null)).getSessionId();
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
