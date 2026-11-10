package com.focusrecovery.domain.analysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.analysis.client.AiAnalysisClient;
import com.focusrecovery.domain.analysis.client.AiAnalysisOutcome;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;

@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AnalysisQueryApiTest {

	private static final String GOAL = "분석 조회 테스트 목표";
	// 테스트가 직접 만든 분석의 요청 시각. 실제 요청 경로로 만든 분석(현재 시각)과 구분한다
	private static final Instant FIXED_REQUESTED_AT = Instant.parse("2026-10-16T01:00:00.000Z");

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private WorkSessionRepository workSessionRepository;

	// 기본은 실제 조회를 한다. 구성 방문 조회 결과가 비정상인 경우만 스텁으로 재현한다(DB 외래키·데이터는 건드리지 않음)
	@MockitoSpyBean
	private PageVisitRepository pageVisitRepository;

	@Autowired
	private AnalysisWindowRepository analysisWindowRepository;

	@Autowired
	private AnalysisResultRepository analysisResultRepository;

	@Autowired
	private NotificationRepository notificationRepository;

	@Autowired
	private AlertCandidateTaskRepository alertCandidateTaskRepository;

	// 조회가 AI를 호출하지 않는지 확인한다(실제 메서드는 그대로 호출)
	@MockitoSpyBean
	private AiAnalysisClient aiAnalysisClient;

	private UUID sessionId;
	private List<String> visitIds;

	@BeforeEach
	void setUp() throws Exception {
		cleanUp();
		sessionId = newSession();
		visitIds = new ArrayList<>();
	}

	@AfterEach
	void tearDown() throws Exception {
		awaitIdle();
		cleanUp();
	}

	@Test
	void 분석이_없으면_최신_분석은_null이고_목록은_비어_있다() throws Exception {
		createWindows(sessionId, 6);

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.sessionId").value(sessionId.toString()))
			.andExpect(jsonPath("$.sessionStatus").value("ACTIVE"))
			.andExpect(jsonPath("$.latestAnalysis").value(nullValue()))
			.andExpect(jsonPath("$.latestCompletedAnalysis").value(nullValue()))
			.andExpect(jsonPath("$.alert").value(nullValue()))
			.andExpect(content().string(containsString("\"alert\":null")))
			.andExpect(content().string(containsString("\"latestAnalysis\":null")));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty())
			.andExpect(jsonPath("$.page").value(0))
			.andExpect(jsonPath("$.size").value(20))
			.andExpect(jsonPath("$.totalElements").value(0))
			.andExpect(jsonPath("$.hasNext").value(false));
	}

	@Test
	void 최신_분석은_처리_상태와_무관한_최대_windowIndex이고_최신_완료는_COMPLETED_중_최대다() throws Exception {
		List<AnalysisWindow> windows = createWindows(sessionId, 8);
		completed(windows.get(0), "NORMAL", Instant.parse("2026-10-16T02:00:01.000Z"));
		failed(windows.get(1), "AI_TIMEOUT");
		completed(windows.get(2), "DRIFT", Instant.parse("2026-10-16T02:00:03.000Z"));
		UUID running = running(windows.get(3));

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.latestAnalysis.analysisId").value(running.toString()))
			.andExpect(jsonPath("$.latestAnalysis.windowIndex").value(4))
			.andExpect(jsonPath("$.latestAnalysis.processingStatus").value("RUNNING"))
			.andExpect(jsonPath("$.latestAnalysis.result").value(nullValue()))
			.andExpect(jsonPath("$.latestAnalysis.pNormal").value(nullValue()))
			.andExpect(jsonPath("$.latestAnalysis.pDrift").value(nullValue()))
			.andExpect(jsonPath("$.latestAnalysis.completedAt").value(nullValue()))
			.andExpect(jsonPath("$.latestAnalysis.errorCode").value(nullValue()))
			.andExpect(jsonPath("$.latestCompletedAnalysis.windowIndex").value(3))
			.andExpect(jsonPath("$.latestCompletedAnalysis.result").value("DRIFT"))
			.andExpect(jsonPath("$.latestCompletedAnalysis.pDrift").value(0.6))
			.andExpect(jsonPath("$.alert").value(nullValue()));

		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items[*].windowIndex", contains(4, 3, 2, 1)))
			.andExpect(jsonPath("$.items[*].processingStatus", contains("RUNNING", "COMPLETED", "FAILED", "COMPLETED")))
			.andExpect(jsonPath("$.items[2].result").value(nullValue()))
			.andExpect(jsonPath("$.items[2].pTransition").value(nullValue()))
			.andExpect(jsonPath("$.items[2].errorCode").value("AI_TIMEOUT"))
			.andExpect(jsonPath("$.items[2].completedAt").isNotEmpty())
			.andExpect(jsonPath("$.items[1].requestedAt").value("2026-10-16T01:00:00.000Z"))
			.andExpect(jsonPath("$.items[1].analyzedAt").value("2026-10-16T02:00:00.123Z"))
			.andExpect(jsonPath("$.items[1].completedAt").value("2026-10-16T02:00:03.000Z"))
			.andExpect(jsonPath("$.items[0].inputSnapshot").doesNotExist())
			.andExpect(jsonPath("$.items[0].contextResult").doesNotExist())
			.andExpect(jsonPath("$.totalElements").value(4));
	}

	@Test
	void 완료_순서가_역전되어도_windowIndex로_최신_완료_분석을_정한다() throws Exception {
		List<AnalysisWindow> windows = createWindows(sessionId, 7);
		// 구간 3이 먼저 끝나고 구간 2가 나중에 끝났다
		completed(windows.get(1), "NORMAL", Instant.parse("2026-10-16T03:00:00.000Z"));
		UUID third = completed(windows.get(2), "TRANSITION", Instant.parse("2026-10-16T02:00:00.000Z"));
		pending(windows.get(0));

		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(jsonPath("$.latestAnalysis.analysisId").value(third.toString()))
			.andExpect(jsonPath("$.latestCompletedAnalysis.analysisId").value(third.toString()))
			.andExpect(jsonPath("$.latestCompletedAnalysis.result").value("TRANSITION"));
	}

	@Test
	void 목록은_windowIndex_내림차순으로_페이지를_나눈다() throws Exception {
		List<AnalysisWindow> windows = createWindows(sessionId, 11);
		for (int i = 0; i < windows.size(); i++) {
			if (i % 2 == 0) {
				completed(windows.get(i), "NORMAL", Instant.parse("2026-10-16T02:00:00.000Z"));
			} else {
				failed(windows.get(i), "AI_UNAVAILABLE");
			}
		}

		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId).param("page", "0").param("size", "3"))
			.andExpect(jsonPath("$.items[*].windowIndex", contains(7, 6, 5)))
			.andExpect(jsonPath("$.page").value(0))
			.andExpect(jsonPath("$.size").value(3))
			.andExpect(jsonPath("$.totalElements").value(7))
			.andExpect(jsonPath("$.hasNext").value(true));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId).param("page", "2").param("size", "3"))
			.andExpect(jsonPath("$.items[*].windowIndex", contains(1)))
			.andExpect(jsonPath("$.hasNext").value(false));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId).param("page", "5").param("size", "3"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.items").isEmpty())
			.andExpect(jsonPath("$.totalElements").value(7));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId).param("size", "100"))
			.andExpect(jsonPath("$.items.length()").value(7));
	}

	@ParameterizedTest
	@ValueSource(strings = {"page=-1", "size=0", "size=101", "page=abc", "size=1.5", "page=21474837&size=100"})
	void 잘못된_페이지_값은_400이다(String query) throws Exception {
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses?" + query, sessionId))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
	}

	@ParameterizedTest
	@ValueSource(strings = {"/analysis-status", "/analyses", "/analyses/" + "5b1f0c2e-8d3a-4c7e-9f21-6a4d2b8e1c90"})
	void 잘못된_세션_UUID는_400이고_없는_세션은_404이다(String path) throws Exception {
		mockMvc.perform(get("/api/sessions/not-a-uuid" + path))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		mockMvc.perform(get("/api/sessions/" + UUID.randomUUID() + path))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
	}

	@Test
	void 잘못된_분석_ID는_400이고_없거나_다른_세션의_분석은_404이다() throws Exception {
		UUID otherSession = newSession();
		UUID otherAnalysis = completed(createWindows(otherSession, 5).getFirst(), "NORMAL",
			Instant.parse("2026-10-16T02:00:00.000Z"));

		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, "1-1-1-1-1"))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, UUID.randomUUID()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("ANALYSIS_NOT_FOUND"));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, otherAnalysis))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("ANALYSIS_NOT_FOUND"));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", otherSession, otherAnalysis))
			.andExpect(status().isOk());
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId))
			.andExpect(jsonPath("$.items").isEmpty());
	}

	@Test
	void 상세는_구간_구성과_JSON_필드를_객체로_반환한다() throws Exception {
		List<AnalysisWindow> windows = createWindows(sessionId, 6);
		AnalysisWindow second = windows.get(1);
		UUID analysisId = completed(second, "TRANSITION", Instant.parse("2026-10-16T02:00:05.000Z"));

		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, analysisId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.analysisId").value(analysisId.toString()))
			.andExpect(jsonPath("$.sessionId").value(sessionId.toString()))
			.andExpect(jsonPath("$.windowId").value(second.getWindowId().toString()))
			.andExpect(jsonPath("$.windowIndex").value(2))
			.andExpect(jsonPath("$.windowSize").value(5))
			.andExpect(jsonPath("$.startVisitId").value(visitIds.get(1)))
			.andExpect(jsonPath("$.endVisitId").value(visitIds.get(5)))
			.andExpect(jsonPath("$.visits[*].position", contains(1, 2, 3, 4, 5)))
			.andExpect(jsonPath("$.visits[*].sequence", contains(2, 3, 4, 5, 6)))
			.andExpect(jsonPath("$.visits[*].visitId", contains(visitIds.subList(1, 6).toArray())))
			.andExpect(jsonPath("$.processingStatus").value("COMPLETED"))
			.andExpect(jsonPath("$.result").value("TRANSITION"))
			.andExpect(jsonPath("$.pNormal").value(0.1))
			.andExpect(jsonPath("$.pTransition").value(0.3))
			.andExpect(jsonPath("$.pDrift").value(0.6))
			.andExpect(jsonPath("$.contextUsed").value(true))
			.andExpect(jsonPath("$.contextResult.contextState").value("TRANSITION"))
			.andExpect(jsonPath("$.contextResult.driftDegree").value(0.4))
			.andExpect(jsonPath("$.featureSnapshot.meanRelevance").value(0.6))
			.andExpect(jsonPath("$.modelVersions.classifier").value("rf-0.1"))
			.andExpect(jsonPath("$.inputSnapshot.goalText").value(GOAL))
			.andExpect(jsonPath("$.inputSnapshot.visits[0].activeDurationMs").value(1000))
			.andExpect(jsonPath("$.errorCode").value(nullValue()));

		UUID failedId = failed(windows.get(0), "AI_INVALID_RESPONSE");
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, failedId))
			.andExpect(jsonPath("$.processingStatus").value("FAILED"))
			.andExpect(jsonPath("$.errorCode").value("AI_INVALID_RESPONSE"))
			.andExpect(jsonPath("$.result").value(nullValue()))
			.andExpect(jsonPath("$.pNormal").value(nullValue()))
			.andExpect(jsonPath("$.analyzedAt").value(nullValue()))
			.andExpect(jsonPath("$.contextUsed").value(nullValue()))
			.andExpect(jsonPath("$.contextResult").value(nullValue()))
			.andExpect(content().string(containsString("\"contextResult\":null")))
			.andExpect(content().string(containsString("\"modelVersions\":null")))
			.andExpect(jsonPath("$.featureSnapshot").value(nullValue()))
			.andExpect(jsonPath("$.modelVersions").value(nullValue()))
			.andExpect(jsonPath("$.inputSnapshot.goalText").value(GOAL));
	}

	@Test
	void 상세의_JSON_필드는_중첩_구조를_유지한_객체이며_문자열로_이중_인코딩하지_않는다() throws Exception {
		AnalysisWindow window = createWindows(sessionId, 5).getFirst();
		AnalysisResult analysis = request(window);
		analysis.start(Instant.parse("2026-10-16T01:00:01.000Z"));
		analysis.finish(new AiAnalysisOutcome(null, "DRIFT", 0.1, 0.2, 0.7, true,
			"{\"contextState\":\"DRIFT\",\"signals\":{\"goalRelevance\":0.2,\"history\":[0.9,{\"step\":2}]},"
				+ "\"note\":\"{\\\"looks\\\":\\\"like json\\\"}\"}",
			"{}", "{\"embedding\":{\"name\":\"qwen3\",\"version\":\"0.6b\"}}", Instant.parse("2026-10-16T02:00:00.000Z")),
			Instant.parse("2026-10-16T02:00:01.000Z"));
		UUID analysisId = save(analysis);

		String body = mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, analysisId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.contextResult.signals.goalRelevance").value(0.2))
			.andExpect(jsonPath("$.contextResult.signals.history[1].step").value(2))
			// 객체 안의 문자열 값은 문자열 그대로 둔다(다시 파싱하지 않음)
			.andExpect(jsonPath("$.contextResult.note").value("{\"looks\":\"like json\"}"))
			.andExpect(jsonPath("$.featureSnapshot").isMap())
			.andExpect(jsonPath("$.featureSnapshot").isEmpty())
			.andExpect(jsonPath("$.modelVersions.embedding.version").value("0.6b"))
			.andExpect(jsonPath("$.inputSnapshot.visits[0].position").value(1))
			.andReturn().getResponse().getContentAsString();

		assertThat(body).contains("\"contextResult\":{", "\"inputSnapshot\":{", "\"modelVersions\":{", "\"featureSnapshot\":{}")
			.doesNotContain("\"contextResult\":\"", "\"inputSnapshot\":\"", "\"modelVersions\":\"");
		assertThat(analysisResultRepository.findById(analysisId).orElseThrow().getContextResult())
			.isEqualTo(analysis.getContextResult());
	}

	@Test
	void 구성_방문은_조회된_방문과_일치하면_position_순서로_반환한다() throws Exception {
		AnalysisWindow window = createWindows(sessionId, 7).get(2);
		UUID analysisId = completed(window, "NORMAL", Instant.parse("2026-10-16T02:00:00.000Z"));
		// 조회 순서가 구간 순서와 달라도 응답은 position 순서다
		List<PageVisitRepository.VisitSequence> reversed = new ArrayList<>(pageVisitRepository.findByVisitIdIn(
			visitIds.subList(2, 7).stream().map(UUID::fromString).toList()));
		assertThat(reversed).hasSize(5);
		java.util.Collections.reverse(reversed);
		doReturn(reversed).when(pageVisitRepository).findByVisitIdIn(any());

		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, analysisId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.visits[*].position", contains(1, 2, 3, 4, 5)))
			.andExpect(jsonPath("$.visits[*].sequence", contains(3, 4, 5, 6, 7)))
			.andExpect(jsonPath("$.visits[*].visitId", contains(visitIds.subList(2, 7).toArray())));
	}

	static List<String> brokenVisitLookups() {
		return List.of("일부_누락", "다른_방문_섞임", "중복_조회", "sequence_null", "visitId_null");
	}

	@ParameterizedTest
	@MethodSource("brokenVisitLookups")
	void 구성_방문_조회_결과가_구간과_다르면_건너뛰거나_채우지_않고_500이다(String kind) throws Exception {
		AnalysisWindow window = createWindows(sessionId, 5).getFirst();
		UUID analysisId = completed(window, "NORMAL", Instant.parse("2026-10-16T02:00:00.000Z"));
		// 구간 1은 sequence 1~5 방문으로 구성된다(트랜잭션 밖이라 구간의 지연 로딩 컬렉션 대신 저장한 ID를 쓴다)
		List<UUID> ids = visitIds.stream().map(UUID::fromString).toList();
		List<PageVisitRepository.VisitSequence> lookup = new ArrayList<>();
		for (int i = 0; i < ids.size(); i++) {
			lookup.add(visitSequence(ids.get(i), i + 1));
		}
		switch (kind) {
			case "일부_누락" -> lookup.remove(2);
			case "다른_방문_섞임" -> lookup.set(2, visitSequence(UUID.randomUUID(), 3));
			case "중복_조회" -> lookup.add(visitSequence(ids.get(4), 5));
			case "sequence_null" -> lookup.set(3, visitSequence(ids.get(3), null));
			case "visitId_null" -> lookup.set(1, visitSequence(null, 2));
			default -> throw new IllegalArgumentException(kind);
		}
		doReturn(lookup).when(pageVisitRepository).findByVisitIdIn(any());
		List<Map<String, Object>> before = analysisRows();

		String body = mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, analysisId))
			.andExpect(status().isInternalServerError())
			.andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
			.andExpect(jsonPath("$.message").value("서버 내부 오류가 발생했습니다."))
			.andExpect(jsonPath("$.fieldErrors").isEmpty())
			.andReturn().getResponse().getContentAsString();

		assertThat(body).doesNotContain(analysisId.toString(), window.getWindowId().toString(), "visits", "sequence");
		assertThat(analysisRows()).isEqualTo(before);
		assertThat(pageVisitRepository.count()).isEqualTo(5);
		// 404 판정은 구성 방문 조회 전에 끝나므로 그대로다
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, UUID.randomUUID()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("ANALYSIS_NOT_FOUND"));
		UUID otherSession = newSession();
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", otherSession, analysisId))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("ANALYSIS_NOT_FOUND"));
	}

	private static PageVisitRepository.VisitSequence visitSequence(UUID visitId, Integer sequence) {
		return new PageVisitRepository.VisitSequence() {
			@Override
			public UUID getVisitId() {
				return visitId;
			}

			@Override
			public Integer getSequence() {
				return sequence;
			}
		};
	}

	static List<String[]> invalidStoredJson() {
		List<String[]> cases = new ArrayList<>();
		for (String field : List.of("contextResult", "inputSnapshot", "featureSnapshot", "modelVersions")) {
			for (String value : List.of("[\"RAW-SECRET\"]", "\"RAW-SECRET\"", "42", "true")) {
				cases.add(new String[] {field, value});
			}
		}
		return cases;
	}

	@ParameterizedTest
	@MethodSource("invalidStoredJson")
	void 저장된_JSON의_최상위_값이_객체가_아니면_500이고_원문을_노출하지_않는다(String field, String stored) throws Exception {
		AnalysisWindow window = createWindows(sessionId, 5).getFirst();
		UUID analysisId = UUID.randomUUID();
		String snapshot = "inputSnapshot".equals(field) ? stored : "{\"goalText\":\"" + GOAL + "\"}";
		AnalysisResult analysis = AnalysisResult.request(analysisId, window.getWindowId(), snapshot, FIXED_REQUESTED_AT);
		analysis.start(Instant.parse("2026-10-16T01:00:01.000Z"));
		analysis.finish(new AiAnalysisOutcome(null, "NORMAL", 0.7, 0.2, 0.1, true,
			"contextResult".equals(field) ? stored : "{}", "featureSnapshot".equals(field) ? stored : null,
			"modelVersions".equals(field) ? stored : "{\"classifier\":\"rf\"}", Instant.parse("2026-10-16T02:00:00.000Z")),
			Instant.parse("2026-10-16T02:00:01.000Z"));
		save(analysis);
		List<Map<String, Object>> before = analysisRows();

		String body = mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, analysisId))
			.andExpect(status().isInternalServerError())
			.andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
			.andExpect(jsonPath("$.message").value("서버 내부 오류가 발생했습니다."))
			.andExpect(jsonPath("$.fieldErrors").isEmpty())
			.andReturn().getResponse().getContentAsString();

		assertThat(body).doesNotContain("RAW-SECRET", field, analysisId.toString(), "Exception");
		assertThat(analysisRows()).isEqualTo(before);
		// JSON 컬럼을 읽지 않는 상태·목록 조회와 다른 API는 영향받지 않는다
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.latestAnalysis.analysisId").value(analysisId.toString()));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId)).andExpect(status().isOk());
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, UUID.randomUUID()))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.code").value("ANALYSIS_NOT_FOUND"));
	}

	@Test
	void 종료된_세션도_조회할_수_있고_상세의_inputSnapshot은_분석_당시_값이다() throws Exception {
		createWindows(sessionId, 4);
		String last = saveVisit(sessionId, 5, 12000);
		AnalysisWindow window = analysisWindowRepository.findAll().getFirst();
		awaitIdle();
		UUID analysisId = analysisResultRepository.findByWindowId(window.getWindowId()).orElseThrow().getAnalysisId();
		patchBehavior(visitIds.getFirst(), 50000, 7, 1).andExpect(jsonPath("$.applied").value(true));
		patchBehavior(last, 70000, 7, 1).andExpect(jsonPath("$.applied").value(true));
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, analysisId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.inputSnapshot.analysisId").value(analysisId.toString()))
			.andExpect(jsonPath("$.inputSnapshot.visits[0].activeDurationMs").value(1000))
			.andExpect(jsonPath("$.inputSnapshot.visits[0].tabSwitchCount").value(0))
			.andExpect(jsonPath("$.inputSnapshot.visits[4].activeDurationMs").value(12000))
			.andExpect(jsonPath("$.processingStatus").value("FAILED"))
			.andExpect(jsonPath("$.errorCode").value("AI_UNAVAILABLE"))
			.andExpect(jsonPath("$.result").value(nullValue()));
		mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.sessionStatus").value("ENDED"))
			.andExpect(jsonPath("$.latestAnalysis.analysisId").value(analysisId.toString()))
			.andExpect(jsonPath("$.latestCompletedAnalysis").value(nullValue()))
			.andExpect(jsonPath("$.alert").value(nullValue()));
		mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.totalElements").value(1));
	}

	@Test
	void 조회는_분석을_만들거나_상태를_바꾸거나_AI를_호출하지_않는다() throws Exception {
		List<AnalysisWindow> windows = createWindows(sessionId, 9);
		pending(windows.get(0));
		running(windows.get(1));
		UUID completedId = completed(windows.get(2), "NORMAL", Instant.parse("2026-10-16T02:00:00.000Z"));
		failed(windows.get(3), "AI_TIMEOUT");
		// windows.get(4)은 아직 분석 요청 전(마지막 방문 10초 미만)
		List<Map<String, Object>> before = analysisRows();
		long visitsBefore = pageVisitRepository.count();
		clearInvocations(aiAnalysisClient);

		for (int i = 0; i < 3; i++) {
			mockMvc.perform(get("/api/sessions/{sessionId}/analysis-status", sessionId)).andExpect(status().isOk());
			mockMvc.perform(get("/api/sessions/{sessionId}/analyses", sessionId)).andExpect(status().isOk());
			mockMvc.perform(get("/api/sessions/{sessionId}/analyses/{analysisId}", sessionId, completedId))
				.andExpect(status().isOk());
		}
		Thread.sleep(200);

		verifyNoInteractions(aiAnalysisClient);
		assertThat(analysisRows()).isEqualTo(before);
		assertThat(analysisResultRepository.count()).isEqualTo(4);
		assertThat(analysisWindowRepository.count()).isEqualTo(5);
		assertThat(pageVisitRepository.count()).isEqualTo(visitsBefore);
		assertThat(workSessionRepository.findById(sessionId).orElseThrow().getEndedAt()).isNull();
	}

	// H2는 JSON 컬럼을 byte[]로 돌려주므로 비교할 수 있게 문자열로 바꾼다
	private List<Map<String, Object>> analysisRows() {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList("select * from analysis_result order by analysis_id");
		rows.forEach(row -> row.replaceAll((column, value) ->
			value instanceof byte[] bytes ? new String(bytes, StandardCharsets.UTF_8) : value));
		return rows;
	}

	private UUID pending(AnalysisWindow window) {
		return save(request(window));
	}

	private UUID running(AnalysisWindow window) {
		AnalysisResult analysis = request(window);
		analysis.start(Instant.parse("2026-10-16T01:00:01.000Z"));
		return save(analysis);
	}

	private UUID completed(AnalysisWindow window, String result, Instant completedAt) {
		AnalysisResult analysis = request(window);
		analysis.start(Instant.parse("2026-10-16T01:00:01.000Z"));
		analysis.finish(new AiAnalysisOutcome(null, result, 0.1, 0.3, 0.6, true,
			"{\"contextState\":\"TRANSITION\",\"driftDegree\":0.4}", "{\"meanRelevance\":0.6}",
			"{\"embedding\":\"qwen3-0.6b\",\"classifier\":\"rf-0.1\"}", Instant.parse("2026-10-16T02:00:00.123Z")), completedAt);
		return save(analysis);
	}

	private UUID failed(AnalysisWindow window, String errorCode) {
		AnalysisResult analysis = request(window);
		analysis.start(Instant.parse("2026-10-16T01:00:01.000Z"));
		analysis.finish(AiAnalysisOutcome.failed(errorCode), Instant.parse("2026-10-16T01:00:02.000Z"));
		return save(analysis);
	}

	// 실제 요청 경로와 같은 모양의 스냅샷(목표·방문 행동값)을 둔다
	private AnalysisResult request(AnalysisWindow window) {
		UUID analysisId = UUID.randomUUID();
		String snapshot = """
			{"analysisId":"%s","sessionId":"%s","windowId":"%s","windowIndex":%d,"goalText":"%s",\
			"visits":[{"position":1,"activeDurationMs":1000}]}""".formatted(analysisId, window.getSessionId(),
			window.getWindowId(), window.getWindowIndex(), GOAL);
		return AnalysisResult.request(analysisId, window.getWindowId(), snapshot, FIXED_REQUESTED_AT);
	}

	private UUID save(AnalysisResult analysis) {
		analysisResultRepository.save(analysis);
		return analysis.getAnalysisId();
	}

	// 체류 1초 방문을 저장해 분석 요청 없이 구간만 만든다(방문 n개 → 구간 n-4개)
	private List<AnalysisWindow> createWindows(UUID session, int visitCount) throws Exception {
		for (int sequence = 1; sequence <= visitCount; sequence++) {
			saveVisit(session, sequence, 1000);
		}
		return analysisWindowRepository.findAll().stream().filter(window -> window.getSessionId().equals(session))
			.sorted((a, b) -> Integer.compare(a.getWindowIndex(), b.getWindowIndex())).toList();
	}

	private String saveVisit(UUID session, int sequence, long activeDurationMs) throws Exception {
		String visitId = UUID.randomUUID().toString();
		mockMvc.perform(post("/api/sessions/{sessionId}/visits", session)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
					"domain": "example.com", "title": "제목", "content": "본문", "activeDurationMs": %d, \
					"visitedAt": "2026-10-16T01:00:00.000Z"}""".formatted(visitId, sequence, sequence, activeDurationMs)))
			.andExpect(status().isCreated());
		if (session.equals(sessionId)) {
			visitIds.add(visitId);
		}
		return visitId;
	}

	private ResultActions patchBehavior(String visitId, long activeDurationMs, int tabSwitchCount, long version)
		throws Exception {
		return mockMvc.perform(patch("/api/sessions/{sessionId}/visits/{visitId}/behavior", sessionId, visitId)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"activeDurationMs\": %d, \"tabSwitchCount\": %d, \"behaviorVersion\": %d}"
				.formatted(activeDurationMs, tabSwitchCount, version)));
	}

	private UUID newSession() {
		return workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start(GOAL, null)).getSessionId();
	}

	// 실제 요청 경로로 만든 분석은 비동기로 끝나므로(테스트 AI 주소는 연결 거부) PENDING·RUNNING이 없어질 때까지 기다린다.
	// 테스트가 직접 만든 미완료 분석(FIXED_REQUESTED_AT)은 실행기가 처리하지 않으므로 제외한다
	private void awaitIdle() throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (System.nanoTime() < deadline && analysisResultRepository.findAll().stream()
			.anyMatch(analysis -> !analysis.getRequestedAt().equals(FIXED_REQUESTED_AT)
				&& (analysis.getProcessingStatus() == AnalysisStatus.PENDING
				|| analysis.getProcessingStatus() == AnalysisStatus.RUNNING))) {
			Thread.sleep(20);
		}
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
