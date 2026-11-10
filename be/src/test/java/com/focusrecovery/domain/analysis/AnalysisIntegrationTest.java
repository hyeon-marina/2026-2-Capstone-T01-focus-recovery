package com.focusrecovery.domain.analysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.analysis.service.AnalysisExecutor;
import com.focusrecovery.domain.analysis.service.AnalysisRequestService;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.support.MockAiServer;
import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

// 실제 AI 서버가 아닌 JDK HttpServer 모의 서버로 AI-API-01(잠정 계약) 연동을 검증한다.
// 요청별 트랜잭션의 커밋·롤백과 비동기 호출을 그대로 확인하려고 테스트에는 트랜잭션을 걸지 않는다
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AnalysisIntegrationTest {

	private static final String GOAL = "Spring JPA 엔터티 매핑 학습";
	private static final MockAiServer AI = new MockAiServer();

	@DynamicPropertySource
	static void aiProperties(DynamicPropertyRegistry registry) {
		registry.add("focus-recovery.ai.base-url", AI::baseUrl);
		registry.add("focus-recovery.ai.response-timeout", () -> "1s");
	}

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JsonMapper jsonMapper;

	@Autowired
	private TransactionTemplate transactionTemplate;

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

	@Autowired
	private AnalysisExecutor analysisExecutor;

	// 기본은 실제 메서드를 호출한다. 롤백 테스트에서만 오류를 주입한다
	@MockitoSpyBean
	private AnalysisRequestService analysisRequestService;

	private UUID sessionId;

	@BeforeEach
	void setUp() {
		AI.reset(this::validResponse);
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
	void 마지막_방문이_10초에_도달하면_목표와_방문_5개를_보내고_정상_결과를_저장한다() throws Exception {
		List<String> visitIds = saveVisits(4, 3000);
		String last = UUID.randomUUID().toString();
		saveVisit(last, 5, 12000).andExpect(status().isCreated());

		AnalysisResult analysis = awaitFinished(onlyWindow());
		assertThat(AI.requests()).hasSize(1);
		JsonNode request = jsonMapper.readTree(AI.requests().getFirst());
		AnalysisWindow window = onlyWindow();
		assertThat(request.get("analysisId").stringValue()).isEqualTo(analysis.getAnalysisId().toString());
		assertThat(request.get("sessionId").stringValue()).isEqualTo(sessionId.toString());
		assertThat(request.get("windowId").stringValue()).isEqualTo(window.getWindowId().toString());
		assertThat(request.get("windowIndex").intValue()).isEqualTo(1);
		assertThat(request.get("goalText").stringValue()).isEqualTo(GOAL);
		JsonNode visits = request.get("visits");
		assertThat(visits).hasSize(5);
		for (int i = 0; i < 5; i++) {
			JsonNode visit = visits.get(i);
			assertThat(visit.get("position").intValue()).isEqualTo(i + 1);
			assertThat(visit.get("sequence").intValue()).isEqualTo(i + 1);
			assertThat(visit.get("visitId").stringValue()).isEqualTo(i < 4 ? visitIds.get(i) : last);
			assertThat(visit.get("content").stringValue()).isEqualTo("본문 " + (i + 1));
			assertThat(visit.get("activeDurationMs").longValue()).isEqualTo(i < 4 ? 3000 : 12000);
			assertThat(visit.get("tabSwitchCount").intValue()).isEqualTo(i + 1);
			assertThat(visit.get("visitedAt").stringValue()).isEqualTo("2026-10-16T01:00:0" + i + ".000Z");
			assertThat(visit.has("isSearchResultPage")).isTrue();
			assertThat(visit.has("sessionId")).isFalse();
			assertThat(visit.has("updatedAt")).isFalse();
		}

		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(analysis.getResult()).isEqualTo("TRANSITION");
		assertThat(analysis.getPNormal()).isEqualTo(0.3);
		assertThat(analysis.getPTransition()).isEqualTo(0.5);
		assertThat(analysis.getPDrift()).isEqualTo(0.2);
		assertThat(analysis.getContextUsed()).isTrue();
		assertThat(jsonMapper.readTree(analysis.getContextResult()).get("driftDegree").doubleValue()).isEqualTo(0.4);
		assertThat(jsonMapper.readTree(analysis.getFeatureSnapshot()).get("meanRelevance").doubleValue()).isEqualTo(0.6);
		assertThat(jsonMapper.readTree(analysis.getModelVersions()).get("classifier").stringValue()).isEqualTo("rf-0.1");
		assertThat(analysis.getAnalyzedAt()).isEqualTo("2026-10-16T02:00:00.123Z");
		assertThat(analysis.getCompletedAt()).isNotNull();
		assertThat(analysis.getErrorCode()).isNull();
		assertThat(jsonMapper.readTree(analysis.getInputSnapshot())).isEqualTo(request);
	}

	// h2c 호환성: AI 서버(uvicorn 등)가 HTTP/2 업그레이드 요청을 처리하지 못하므로 평문 HTTP/1.1로만 보내야 한다.
	// JDK HttpServer는 업그레이드 헤더가 있어도 HTTP/1.1로 응답하므로 프로토콜만으로는 잡히지 않아 헤더도 확인한다
	@Test
	void AI_요청은_h2c_업그레이드_없이_HTTP_1_1로_보내고_정상_결과를_저장한다() throws Exception {
		saveVisits(4, 3000);
		saveVisit(UUID.randomUUID().toString(), 5, 12000).andExpect(status().isCreated());

		AnalysisResult analysis = awaitFinished(onlyWindow());

		assertThat(AI.receivedRequests()).hasSize(1);
		MockAiServer.ReceivedRequest received = AI.receivedRequests().getFirst();
		assertThat(received.protocol()).isEqualTo("HTTP/1.1");
		assertThat(received.header("Upgrade")).isEmpty();
		assertThat(received.header("HTTP2-Settings")).isEmpty();
		assertThat(received.header("Connection").stream()
			.flatMap(value -> java.util.Arrays.stream(value.split(",")))
			.map(token -> token.trim().toLowerCase(java.util.Locale.ROOT)))
			.doesNotContain("upgrade", "http2-settings");
		assertThat(jsonMapper.readTree(received.body())).isEqualTo(jsonMapper.readTree(analysis.getInputSnapshot()));
		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(analysis.getResult()).isEqualTo("TRANSITION");
	}

	@Test
	void 마지막_방문이_10초_전이면_분석하지_않고_PATCH로_10초에_도달하면_분석한다() throws Exception {
		saveVisits(4, 3000);
		String last = UUID.randomUUID().toString();
		saveVisit(last, 5, 1000).andExpect(status().isCreated());
		patchBehavior(last, 9999, 5, 1).andExpect(jsonPath("$.applied").value(true));
		assertThat(analysisResultRepository.count()).isZero();

		patchBehavior(last, 10000, 5, 2).andExpect(jsonPath("$.applied").value(true));

		AnalysisResult analysis = awaitFinished(onlyWindow());
		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(jsonMapper.readTree(AI.requests().getFirst()).get("visits").get(4).get("activeDurationMs").longValue())
			.isEqualTo(10000);
		patchBehavior(last, 20000, 6, 3).andExpect(jsonPath("$.applied").value(true));
		Thread.sleep(300);
		assertThat(analysisResultRepository.count()).isEqualTo(1);
		assertThat(AI.requests()).hasSize(1);
	}

	@Test
	void 세션을_종료하면_분석을_기다리던_구간을_모두_요청하고_종료_후_도착한_결과도_저장한다() throws Exception {
		saveVisits(7, 2000);
		assertThat(analysisWindowRepository.count()).isEqualTo(3);
		assertThat(analysisResultRepository.count()).isZero();

		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		for (AnalysisWindow window : analysisWindowRepository.findAll()) {
			assertThat(awaitFinished(window).getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		}
		assertThat(AI.requests()).hasSize(3);
		assertThat(AI.requests().stream().map(body -> jsonMapper.readTree(body).get("windowIndex").intValue()).sorted())
			.containsExactly(1, 2, 3);
	}

	@Test
	void 분석_중에_세션이_종료되어도_늦게_도착한_결과를_기록한다() throws Exception {
		AI.hold();
		saveVisits(4, 3000);
		saveVisit(UUID.randomUUID().toString(), 5, 15000).andExpect(status().isCreated());
		AI.awaitRequests(1);
		assertThat(analysisResultRepository.findAll()).extracting(AnalysisResult::getProcessingStatus)
			.containsExactly(AnalysisStatus.RUNNING);

		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());
		AI.release();

		assertThat(awaitFinished(onlyWindow()).getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(AI.requests()).hasSize(1);
	}

	static List<Function<ObjectNode, String>> invalidResponses() {
		return List.of(
			body -> body.put("analysisId", UUID.randomUUID().toString()).toString(),
			body -> body.put("sessionId", UUID.randomUUID().toString()).toString(),
			body -> body.put("windowId", UUID.randomUUID().toString()).toString(),
			body -> body.put("windowId", "not-a-uuid").toString(),
			body -> body.put("result", "UNKNOWN").toString(),
			body -> body.put("result", "normal").toString(),
			body -> body.remove("result") == null ? "" : body.toString(),
			body -> body.put("pDrift", 1.2).put("pNormal", -0.4).toString(),
			body -> body.put("pNormal", "0.3").toString(),
			body -> body.put("pNormal", 0.302).toString(),
			body -> body.remove("pTransition") == null ? "" : body.toString(),
			body -> body.remove("contextUsed") == null ? "" : body.toString(),
			body -> body.put("contextUsed", "true").toString(),
			body -> body.put("contextResult", "text").toString(),
			body -> body.set("featureSnapshot", body.arrayNode()).toString(),
			body -> body.set("modelVersions", body.objectNode()).toString(),
			body -> body.set("modelVersions", body.objectNode().put("classifier", 1)).toString(),
			body -> body.put("analyzedAt", "2026-10-16T02:00:00Z").toString(),
			body -> body.put("analyzedAt", "어제").toString(),
			body -> "[]",
			body -> "not json");
	}

	@ParameterizedTest
	@MethodSource("invalidResponses")
	void 응답이_계약과_다르면_NORMAL로_대체하지_않고_실패로_기록한다(Function<ObjectNode, String> mutation) throws Exception {
		AI.reset(request -> MockAiServer.ok(mutation.apply(validBody(request))));

		AnalysisResult analysis = analyzeOneWindow();

		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.FAILED);
		assertThat(analysis.getErrorCode()).isEqualTo("AI_INVALID_RESPONSE");
		assertThat(analysis.getResult()).isNull();
		assertThat(analysis.getPNormal()).isNull();
		assertThat(analysis.getPTransition()).isNull();
		assertThat(analysis.getPDrift()).isNull();
		assertThat(analysis.getContextUsed()).isNull();
		assertThat(analysis.getModelVersions()).isNull();
		assertThat(analysis.getAnalyzedAt()).isNull();
		assertThat(analysis.getCompletedAt()).isNotNull();
	}

	// 형식(정규식)은 맞지만 존재하지 않는 날짜·시각이면 Instant.parse에서 실패한다. RUNNING에 남지 않아야 한다
	@ParameterizedTest
	@ValueSource(strings = {"2026-13-16T02:00:00.123Z", "2026-02-30T02:00:00.123Z", "2026-10-16T25:00:00.123Z",
		"2026-10-16T02:60:00.123Z"})
	void 존재하지_않는_analyzedAt은_실패로_기록하고_이후_정상_분석도_처리한다(String analyzedAt) throws Exception {
		AI.reset(request -> MockAiServer.ok(validBody(request).put("analyzedAt", analyzedAt).toString()));

		AnalysisResult failed = analyzeOneWindow();

		assertThat(failed.getProcessingStatus()).isEqualTo(AnalysisStatus.FAILED);
		assertThat(failed.getErrorCode()).isEqualTo("AI_INVALID_RESPONSE");
		assertThat(failed.getResult()).isNull();
		assertThat(failed.getPDrift()).isNull();
		assertThat(failed.getAnalyzedAt()).isNull();
		assertThat(failed.getCompletedAt()).isNotNull();

		AI.reset(this::validResponse);
		saveVisit(UUID.randomUUID().toString(), 6, 12000).andExpect(status().isCreated());
		AnalysisWindow next = analysisWindowRepository.findAll().stream()
			.filter(window -> window.getWindowIndex() == 2).findFirst().orElseThrow();
		AnalysisResult completed = awaitFinished(next);

		assertThat(completed.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(completed.getAnalyzedAt()).isEqualTo("2026-10-16T02:00:00.123Z");
		assertThat(AI.requests()).hasSize(1);
		assertThat(analysisResultRepository.findById(failed.getAnalysisId()).orElseThrow().getProcessingStatus())
			.isEqualTo(AnalysisStatus.FAILED);
	}

	// DRIFT는 임계값으로 판정하므로 pDrift가 가장 크지 않아도 정상이며, 합 오차 0.001(잠정) 이내도 정상이다
	@Test
	void DRIFT_판정은_확률_최댓값과_달라도_정상이고_합_오차_허용치_이내면_통과한다() throws Exception {
		AI.reset(request -> MockAiServer.ok(validBody(request)
			.put("result", "DRIFT").put("pNormal", 0.5).put("pTransition", 0.2).put("pDrift", 0.3009)
			.putNull("contextResult").putNull("featureSnapshot").put("contextUsed", false).toString()));

		AnalysisResult analysis = analyzeOneWindow();

		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(analysis.getResult()).isEqualTo("DRIFT");
		assertThat(analysis.getContextUsed()).isFalse();
		assertThat(analysis.getContextResult()).isNull();
		assertThat(analysis.getFeatureSnapshot()).isNull();
	}

	@Test
	void AI_오류_응답의_정의된_코드는_그대로_기록하고_그_외_오류는_잘못된_응답으로_기록한다() throws Exception {
		AI.reset(request -> new MockAiServer.Response(422,
			"{\"code\":\"AI_ANALYSIS_FAILED\",\"message\":\"실패\",\"fieldErrors\":[]}", 0));
		assertThat(analyzeOneWindow().getErrorCode()).isEqualTo("AI_ANALYSIS_FAILED");

		cleanUp();
		sessionId = workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start(GOAL, null)).getSessionId();
		AI.reset(request -> new MockAiServer.Response(500, "<html>error</html>", 0));
		AnalysisResult analysis = analyzeOneWindow();
		assertThat(analysis.getErrorCode()).isEqualTo("AI_INVALID_RESPONSE");
		assertThat(analysis.getResult()).isNull();
	}

	@Test
	void AI_응답이_제한시간을_넘으면_타임아웃으로_기록하고_방문_저장은_기다리지_않는다() throws Exception {
		AI.reset(request -> new MockAiServer.Response(200, validBody(request).toString(), 3000));
		saveVisits(4, 3000);

		long started = System.nanoTime();
		saveVisit(UUID.randomUUID().toString(), 5, 12000).andExpect(status().isCreated());
		assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(900));

		AnalysisResult analysis = awaitFinished(onlyWindow());
		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.FAILED);
		assertThat(analysis.getErrorCode()).isEqualTo("AI_TIMEOUT");
		assertThat(analysis.getResult()).isNull();
		assertThat(Duration.between(analysis.getRequestedAt(), analysis.getCompletedAt())).isLessThan(Duration.ofMillis(2500));
	}

	@Test
	void AI_연결이_끊기면_통신_실패로_기록하고_세션은_계속_사용할_수_있다() throws Exception {
		AI.reset(request -> MockAiServer.DISCONNECT);

		AnalysisResult analysis = analyzeOneWindow();

		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.FAILED);
		assertThat(analysis.getErrorCode()).isEqualTo("AI_UNAVAILABLE");
		saveVisit(UUID.randomUUID().toString(), 6, 1000).andExpect(status().isCreated());
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());
	}

	@Test
	void 같은_분석을_동시에_여러_번_실행해도_AI는_한_번만_호출하고_완료_결과를_덮어쓰지_않는다() throws Exception {
		AI.hold();
		saveVisits(4, 3000);
		saveVisit(UUID.randomUUID().toString(), 5, 12000).andExpect(status().isCreated());
		AI.awaitRequests(1);
		UUID analysisId = analysisResultRepository.findAll().getFirst().getAnalysisId();

		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(8);
		List<Future<?>> futures = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			futures.add(executor.submit(() -> {
				ready.await();
				analysisExecutor.run(analysisId);
				return null;
			}));
		}
		ready.countDown();
		for (Future<?> future : futures) {
			future.get(5, TimeUnit.SECONDS);
		}
		executor.shutdown();
		AI.release();
		AnalysisResult completed = awaitFinished(onlyWindow());
		assertThat(completed.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);

		AI.reset(request -> MockAiServer.ok(validBody(request).put("result", "DRIFT").toString()));
		analysisExecutor.run(analysisId);

		assertThat(AI.requests()).isEmpty();
		AnalysisResult after = analysisResultRepository.findById(analysisId).orElseThrow();
		assertThat(after.getResult()).isEqualTo("TRANSITION");
		assertThat(after.getCompletedAt()).isEqualTo(completed.getCompletedAt());
		assertThat(analysisResultRepository.count()).isEqualTo(1);
	}

	@Test
	void 마지막_방문의_행동_갱신이_동시에_와도_구간당_분석은_하나다() throws Exception {
		saveVisits(4, 3000);
		String last = UUID.randomUUID().toString();
		saveVisit(last, 5, 1000).andExpect(status().isCreated());

		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(6);
		List<Future<Integer>> futures = new ArrayList<>();
		for (int i = 1; i <= 6; i++) {
			int version = i;
			Callable<Integer> task = () -> {
				ready.await();
				return patchBehavior(last, 10000L + version, 5, version).andReturn().getResponse().getStatus();
			};
			futures.add(executor.submit(task));
		}
		ready.countDown();
		for (Future<Integer> future : futures) {
			assertThat(future.get(5, TimeUnit.SECONDS)).isEqualTo(200);
		}
		executor.shutdown();

		assertThat(awaitFinished(onlyWindow()).getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(analysisResultRepository.count()).isEqualTo(1);
		assertThat(AI.requests()).hasSize(1);
	}

	@Test
	void 분석_요청_후_행동_정보가_바뀌어도_입력_스냅샷과_결과는_그대로이고_재분석하지_않는다() throws Exception {
		AI.hold();
		List<String> visitIds = saveVisits(4, 3000);
		String last = UUID.randomUUID().toString();
		saveVisit(last, 5, 12000).andExpect(status().isCreated());
		AI.awaitRequests(1);
		String snapshot = analysisResultRepository.findAll().getFirst().getInputSnapshot();

		patchBehavior(visitIds.getFirst(), 50000, 9, 1).andExpect(jsonPath("$.applied").value(true));
		patchBehavior(last, 60000, 9, 1).andExpect(jsonPath("$.applied").value(true));
		AI.release();
		AnalysisResult analysis = awaitFinished(onlyWindow());

		assertThat(analysis.getInputSnapshot()).isEqualTo(snapshot);
		JsonNode sent = jsonMapper.readTree(AI.requests().getFirst());
		assertThat(sent.get("visits").get(0).get("activeDurationMs").longValue()).isEqualTo(3000);
		assertThat(sent.get("visits").get(4).get("activeDurationMs").longValue()).isEqualTo(12000);
		Thread.sleep(300);
		assertThat(AI.requests()).hasSize(1);
		assertThat(analysisResultRepository.count()).isEqualTo(1);
		assertThat(analysisResultRepository.findById(analysis.getAnalysisId()).orElseThrow().getCompletedAt())
			.isEqualTo(analysis.getCompletedAt());
	}

	@Test
	void 분석_요청을_만든_트랜잭션이_롤백되면_분석_기록도_AI_호출도_없다() throws Exception {
		saveVisits(4, 3000);
		AnalysisRequestService target = AopTestUtils.getUltimateTargetObject(analysisRequestService);
		doAnswer(invocation -> {
			invocation.callRealMethod();
			throw new DataIntegrityViolationException("주입된 실패");
		}).when(target).requestReadyWindows(any(), any());

		String visitId = UUID.randomUUID().toString();
		assertThatThrownBy(() -> saveVisit(visitId, 5, 12000))
			.hasRootCauseInstanceOf(DataIntegrityViolationException.class);

		Thread.sleep(500);
		assertThat(AI.requests()).isEmpty();
		assertThat(analysisResultRepository.count()).isZero();
		assertThat(analysisWindowRepository.count()).isZero();
		assertThat(pageVisitRepository.count()).isEqualTo(4);
	}

	private AnalysisResult analyzeOneWindow() throws Exception {
		saveVisits(4, 3000);
		saveVisit(UUID.randomUUID().toString(), 5, 12000).andExpect(status().isCreated());
		return awaitFinished(onlyWindow());
	}

	private MockAiServer.Response validResponse(String request) {
		return MockAiServer.ok(validBody(request).toString());
	}

	// 요청 식별자를 그대로 돌려주는 정상 응답
	private ObjectNode validBody(String request) {
		JsonNode body = jsonMapper.readTree(request);
		ObjectNode response = jsonMapper.createObjectNode();
		response.put("analysisId", body.get("analysisId").stringValue());
		response.put("sessionId", body.get("sessionId").stringValue());
		response.put("windowId", body.get("windowId").stringValue());
		response.put("result", "TRANSITION");
		response.put("pNormal", 0.3);
		response.put("pTransition", 0.5);
		response.put("pDrift", 0.2);
		response.put("contextUsed", true);
		response.set("contextResult", jsonMapper.createObjectNode().put("driftDegree", 0.4).put("contextState", "TRANSITION"));
		response.set("featureSnapshot", jsonMapper.createObjectNode().put("meanRelevance", 0.6));
		response.set("modelVersions", jsonMapper.createObjectNode().put("embedding", "qwen3-0.6b").put("classifier", "rf-0.1"));
		response.put("analyzedAt", "2026-10-16T02:00:00.123Z");
		return response;
	}

	private AnalysisWindow onlyWindow() {
		List<AnalysisWindow> windows = analysisWindowRepository.findAll();
		assertThat(windows).hasSize(1);
		return windows.getFirst();
	}

	private AnalysisResult awaitFinished(AnalysisWindow window) throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (System.nanoTime() < deadline) {
			AnalysisResult analysis = analysisResultRepository.findByWindowId(window.getWindowId()).orElse(null);
			if (analysis != null && (analysis.getProcessingStatus() == AnalysisStatus.COMPLETED
				|| analysis.getProcessingStatus() == AnalysisStatus.FAILED)) {
				return analysis;
			}
			Thread.sleep(20);
		}
		throw new AssertionError("분석이 끝나지 않았습니다: " + analysisResultRepository.findByWindowId(window.getWindowId()));
	}

	// 다음 테스트가 지운 행을 이전 테스트의 비동기 작업이 갱신하지 않도록 진행 중인 분석이 끝날 때까지 기다린다
	private void awaitIdle() throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (System.nanoTime() < deadline && analysisResultRepository.findAll().stream()
			.anyMatch(a -> a.getProcessingStatus() == AnalysisStatus.PENDING || a.getProcessingStatus() == AnalysisStatus.RUNNING)) {
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

	private List<String> saveVisits(int count, long activeDurationMs) throws Exception {
		List<String> visitIds = new ArrayList<>();
		for (int sequence = 1; sequence <= count; sequence++) {
			String visitId = UUID.randomUUID().toString();
			visitIds.add(visitId);
			saveVisit(visitId, sequence, activeDurationMs).andExpect(status().isCreated());
		}
		return visitIds;
	}

	private ResultActions saveVisit(String visitId, int sequence, long activeDurationMs) throws Exception {
		return mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
			.contentType(MediaType.APPLICATION_JSON)
			.content("""
				{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
				"domain": "example.com", "title": "제목 %d", "content": "본문 %d", "activeDurationMs": %d, \
				"tabSwitchCount": %d, "visitedAt": "2026-10-16T01:00:0%d.000Z"}"""
				.formatted(visitId, sequence, sequence, sequence, sequence, activeDurationMs, sequence, sequence - 1)));
	}

	private ResultActions patchBehavior(String visitId, long activeDurationMs, int tabSwitchCount, long version)
		throws Exception {
		return mockMvc.perform(patch("/api/sessions/{sessionId}/visits/{visitId}/behavior", sessionId, visitId)
			.contentType(MediaType.APPLICATION_JSON)
			.content("{\"activeDurationMs\": %d, \"tabSwitchCount\": %d, \"behaviorVersion\": %d}"
				.formatted(activeDurationMs, tabSwitchCount, version)));
	}

	// POST /api/ai/analyses만 받는 모의 AI 서버. 응답을 붙잡아 두거나(hold) 지연·연결 끊기를 흉내 낸다
}
