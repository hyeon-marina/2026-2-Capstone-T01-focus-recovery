package com.focusrecovery.domain.analysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.analysis.client.AiAnalysisClient;
import com.focusrecovery.domain.analysis.client.AiProperties;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.analysis.service.AnalysisExecutor;
import com.focusrecovery.domain.analysis.service.AnalysisProperties;
import com.focusrecovery.domain.analysis.service.AnalysisRecovery;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.support.MockAiServer;

import tools.jackson.databind.json.JsonMapper;

// 미완료 분석 복구·예상 밖 예외·실행기 포화를 HTTP 모의 AI 서버로 검증한다(실제 AI 서버 아님).
// 포화를 재현하려고 실행기를 스레드 1개·큐 3개로 줄이고, 복구는 스케줄 대신 기준 시각을 넘겨 직접 호출한다
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AnalysisRecoveryTest {

	private static final MockAiServer AI = new MockAiServer();

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("focus-recovery.ai.base-url", AI::baseUrl);
		registry.add("focus-recovery.ai.response-timeout", () -> "1s");
		registry.add("focus-recovery.analysis.executor.pool-size", () -> "1");
		registry.add("focus-recovery.analysis.executor.queue-capacity", () -> "3");
		registry.add("focus-recovery.analysis.recovery.interval", () -> "1h");
		registry.add("focus-recovery.analysis.recovery.pending-timeout", () -> "10s");
		registry.add("focus-recovery.analysis.recovery.running-timeout", () -> "5s");
	}

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JsonMapper jsonMapper;

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

	@Autowired
	private AnalysisRecovery analysisRecovery;

	@Autowired
	private ThreadPoolTaskExecutor analysisTaskExecutor;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@MockitoSpyBean
	private AiAnalysisClient aiAnalysisClient;

	private UUID sessionId;

	@BeforeEach
	void setUp() {
		AI.reset(request -> MockAiServer.ok(validBody(request)));
		cleanUp();
		sessionId = workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start("복구 테스트 목표", null)).getSessionId();
	}

	@AfterEach
	void tearDown() throws Exception {
		AI.release();
		awaitExecutorIdle();
		cleanUp();
	}

	@Test
	void 제한_시간을_넘긴_PENDING과_RUNNING만_실패로_확정하고_진행_중인_작업은_유지한다() throws Exception {
		List<AnalysisWindow> windows = createWindows(9);
		Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		UUID stalePending = insert(windows.get(0), now.minusSeconds(11), null);
		UUID waitingPending = insert(windows.get(1), now.minusSeconds(9), null);
		UUID staleRunning = insert(windows.get(2), now.minusSeconds(30), now.minusSeconds(6));
		// 요청은 오래됐지만 방금 실행을 시작한 작업: RUNNING은 started_at 기준이므로 유지해야 한다
		UUID activeRunning = insert(windows.get(3), now.minusSeconds(30), now.minusSeconds(1));
		UUID completed = insert(windows.get(4), now.minusSeconds(60), null);
		analysisExecutor.run(completed);
		assertThat(analysisResultRepository.findById(completed).orElseThrow().getProcessingStatus())
			.isEqualTo(AnalysisStatus.COMPLETED);
		AI.reset(request -> MockAiServer.ok(validBody(request)));

		analysisRecovery.recoverStale(now);

		assertFailed(stalePending, "ANALYSIS_NOT_STARTED");
		assertFailed(staleRunning, "ANALYSIS_INTERRUPTED");
		assertThat(statusOf(waitingPending)).isEqualTo(AnalysisStatus.PENDING);
		assertThat(statusOf(activeRunning)).isEqualTo(AnalysisStatus.RUNNING);
		assertThat(statusOf(completed)).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(analysisResultRepository.findById(completed).orElseThrow().getErrorCode()).isNull();

		// 실패로 확정된 PENDING은 뒤늦게 실행기가 잡아도 AI를 호출하지 않는다
		analysisExecutor.run(stalePending);
		assertThat(AI.requests()).isEmpty();
		assertFailed(stalePending, "ANALYSIS_NOT_STARTED");
	}

	// V4에서 RUNNING이 된 행은 V5가 추가한 started_at이 null이다. 기준: requested_at + pending-timeout(10s) + running-timeout(5s)
	@Test
	void started_at이_없는_기존_RUNNING도_요청_시각_기준으로_복구하고_최근_작업과_완료_결과는_유지한다() throws Exception {
		List<AnalysisWindow> windows = createWindows(8);
		Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		UUID legacyStale = insert(windows.get(0), now.minusSeconds(16), null);
		UUID legacyRecent = insert(windows.get(1), now.minusSeconds(14), null);
		UUID legacyCompleted = insert(windows.get(2), now.minusSeconds(60), null);
		analysisExecutor.run(legacyCompleted);
		// V4 시절 행 재현: started_at 없이 RUNNING으로 남은 상태(완료 행도 started_at을 지워 V4 데이터와 같게 만든다)
		jdbcTemplate.update("update analysis_result set processing_status = 'RUNNING', started_at = null where analysis_id in (?, ?)",
			legacyStale.toString(), legacyRecent.toString());
		jdbcTemplate.update("update analysis_result set started_at = null where analysis_id = ?", legacyCompleted.toString());
		assertThat(jdbcTemplate.queryForObject("select count(*) from analysis_result where started_at is null", Integer.class))
			.isEqualTo(3);

		analysisRecovery.recoverStale(now);

		assertFailed(legacyStale, "ANALYSIS_INTERRUPTED");
		assertThat(statusOf(legacyRecent)).isEqualTo(AnalysisStatus.RUNNING);
		AnalysisResult completed = analysisResultRepository.findById(legacyCompleted).orElseThrow();
		assertThat(completed.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(completed.getResult()).isEqualTo("NORMAL");
		assertThat(completed.getErrorCode()).isNull();

		analysisRecovery.recoverStale(now.plusSeconds(2));
		assertFailed(legacyRecent, "ANALYSIS_INTERRUPTED");
		assertThat(statusOf(legacyCompleted)).isEqualTo(AnalysisStatus.COMPLETED);
	}

	// 스케줄러가 부르는 인자 없는 진입점도 트랜잭션 안에서 갱신해야 한다(같은 클래스 내부 호출은 프록시를 거치지 않음)
	@Test
	void 스케줄_진입점으로_실행해도_현재_시각_기준으로_복구한다() throws Exception {
		List<AnalysisWindow> windows = createWindows(6);
		Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
		UUID stalePending = insert(windows.get(0), now.minusSeconds(11), null);
		UUID waitingPending = insert(windows.get(1), now, null);

		analysisRecovery.recoverStale();

		assertFailed(stalePending, "ANALYSIS_NOT_STARTED");
		assertThat(statusOf(waitingPending)).isEqualTo(AnalysisStatus.PENDING);
	}

	@Test
	void 실패로_확정된_뒤_늦게_도착한_AI_응답은_결과를_덮어쓰지_않는다() throws Exception {
		AI.hold();
		createWindows(4);
		saveVisit(5, 12000);
		AI.awaitRequests(1);
		UUID analysisId = analysisResultRepository.findAll().getFirst().getAnalysisId();
		assertThat(statusOf(analysisId)).isEqualTo(AnalysisStatus.RUNNING);

		analysisRecovery.recoverStale(Instant.now().plusSeconds(6));
		assertFailed(analysisId, "ANALYSIS_INTERRUPTED");

		AI.release();
		awaitExecutorIdle();
		assertFailed(analysisId, "ANALYSIS_INTERRUPTED");
	}

	@Test
	void AI_호출_중_예상하지_못한_예외는_실패로_기록하고_같은_이벤트의_나머지_분석을_계속한다() throws Exception {
		doAnswer(invocation -> {
			if (jsonMapper.readTree((String) invocation.getArgument(0)).get("windowIndex").intValue() == 2) {
				throw new IllegalStateException("주입된 예외");
			}
			return invocation.callRealMethod();
		}).when(aiAnalysisClient).analyze(anyString(), any(), any(), any());
		createWindows(7);

		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		awaitExecutorIdle();
		Map<Integer, AnalysisResult> byIndex = analysesByWindowIndex();
		assertThat(byIndex.get(1).getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(byIndex.get(2).getProcessingStatus()).isEqualTo(AnalysisStatus.FAILED);
		assertThat(byIndex.get(2).getErrorCode()).isEqualTo("ANALYSIS_INTERNAL_ERROR");
		assertThat(byIndex.get(2).getResult()).isNull();
		assertThat(byIndex.get(3).getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(AI.requests()).hasSize(2);
	}

	@Test
	void 실행기_큐가_가득_차도_종료_요청은_성공하고_실행하지_못한_분석은_실패로_기록한다() throws Exception {
		AI.hold();
		createWindows(9);

		long started = System.nanoTime();
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());
		// 요청 스레드가 AI를 대신 호출했다면 붙잡힌 응답 때문에 여기서 막힌다
		assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(1));

		// 유휴 스레드가 작업을 가져가기 전에는 그 작업도 큐 자리를 차지하므로 거절은 1~2건이다(스레드 1 + 큐 3, 분석 5건)
		Map<Integer, AnalysisResult> byIndex = analysesByWindowIndex();
		assertThat(byIndex).hasSize(5);
		List<Integer> rejected = byIndex.entrySet().stream()
			.filter(entry -> "ANALYSIS_QUEUE_FULL".equals(entry.getValue().getErrorCode()))
			.map(Map.Entry::getKey).sorted().toList();
		assertThat(rejected).isNotEmpty().hasSizeLessThanOrEqualTo(2).allMatch(index -> index >= 4);
		for (int index : rejected) {
			assertThat(byIndex.get(index).getProcessingStatus()).isEqualTo(AnalysisStatus.FAILED);
			assertThat(byIndex.get(index).getCompletedAt()).isNotNull();
		}

		AI.release();
		awaitExecutorIdle();
		byIndex = analysesByWindowIndex();
		for (int index = 1; index <= 5; index++) {
			if (rejected.contains(index)) {
				assertThat(byIndex.get(index).getErrorCode()).isEqualTo("ANALYSIS_QUEUE_FULL");
			} else {
				assertThat(byIndex.get(index).getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
			}
		}
		assertThat(AI.requests()).hasSize(5 - rejected.size());
	}

	@Test
	void 진행_중인_작업을_잘라내는_제한_시간은_시작할_때_거부한다() {
		AiProperties ai = new AiProperties(URI.create("http://localhost"), Duration.ofSeconds(2), Duration.ofSeconds(10), 0.001);
		AnalysisProperties.Executor executor = new AnalysisProperties.Executor(4, 100);
		Duration interval = Duration.ofMinutes(1);

		AnalysisRecovery.validate(new AnalysisProperties(executor,
			new AnalysisProperties.Recovery(interval, Duration.ofMinutes(10), Duration.ofMinutes(1))), ai);
		assertThatThrownBy(() -> AnalysisRecovery.validate(new AnalysisProperties(executor,
			new AnalysisProperties.Recovery(interval, Duration.ofMinutes(10), Duration.ofSeconds(10))), ai))
			.hasMessageContaining("running-timeout");
		// 큐 100 / 스레드 4 → 최대 대기 (25 + 1) × 10s = 260s
		assertThatThrownBy(() -> AnalysisRecovery.validate(new AnalysisProperties(executor,
			new AnalysisProperties.Recovery(interval, Duration.ofSeconds(260), Duration.ofMinutes(1))), ai))
			.hasMessageContaining("pending-timeout");
	}

	private UUID insert(AnalysisWindow window, Instant requestedAt, Instant startedAt) {
		UUID analysisId = UUID.randomUUID();
		String snapshot = jsonMapper.createObjectNode().put("analysisId", analysisId.toString())
			.put("sessionId", sessionId.toString()).put("windowId", window.getWindowId().toString()).toString();
		AnalysisResult analysis = AnalysisResult.request(analysisId, window.getWindowId(), snapshot, requestedAt);
		if (startedAt != null) {
			analysis.start(startedAt);
		}
		analysisResultRepository.save(analysis);
		return analysisId;
	}

	private AnalysisStatus statusOf(UUID analysisId) {
		return analysisResultRepository.findById(analysisId).orElseThrow().getProcessingStatus();
	}

	private void assertFailed(UUID analysisId, String errorCode) {
		AnalysisResult analysis = analysisResultRepository.findById(analysisId).orElseThrow();
		assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.FAILED);
		assertThat(analysis.getErrorCode()).isEqualTo(errorCode);
		assertThat(analysis.getResult()).isNull();
		assertThat(analysis.getPDrift()).isNull();
		assertThat(analysis.getCompletedAt()).isNotNull();
	}

	private Map<Integer, AnalysisResult> analysesByWindowIndex() {
		Map<UUID, Integer> indexes = analysisWindowRepository.findAll().stream()
			.collect(Collectors.toMap(AnalysisWindow::getWindowId, AnalysisWindow::getWindowIndex));
		return analysisResultRepository.findAll().stream()
			.collect(Collectors.toMap(analysis -> indexes.get(analysis.getWindowId()), Function.identity()));
	}

	// 체류 1초 방문을 저장해 분석 없이 구간만 만든다(방문 n개 → 구간 n-4개)
	private List<AnalysisWindow> createWindows(int visitCount) throws Exception {
		for (int sequence = 1; sequence <= visitCount; sequence++) {
			saveVisit(sequence, 1000);
		}
		return analysisWindowRepository.findAll().stream()
			.sorted((a, b) -> Integer.compare(a.getWindowIndex(), b.getWindowIndex())).toList();
	}

	private void saveVisit(int sequence, long activeDurationMs) throws Exception {
		mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
					"domain": "example.com", "title": "제목", "content": "본문", "activeDurationMs": %d, \
					"visitedAt": "2026-10-16T01:00:00.000Z"}""".formatted(UUID.randomUUID(), sequence, sequence, activeDurationMs)))
			.andExpect(status().isCreated());
	}

	private String validBody(String request) {
		var body = jsonMapper.readTree(request);
		return jsonMapper.createObjectNode()
			.put("analysisId", body.get("analysisId").stringValue())
			.put("sessionId", body.get("sessionId").stringValue())
			.put("windowId", body.get("windowId").stringValue())
			.put("result", "NORMAL").put("pNormal", 0.7).put("pTransition", 0.2).put("pDrift", 0.1)
			.put("contextUsed", false).putNull("contextResult").putNull("featureSnapshot")
			.<tools.jackson.databind.node.ObjectNode>set("modelVersions", jsonMapper.createObjectNode().put("classifier", "mock"))
			.put("analyzedAt", "2026-10-16T02:00:00.000Z").toString();
	}

	private void awaitExecutorIdle() throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
		while (System.nanoTime() < deadline && (analysisTaskExecutor.getActiveCount() > 0
			|| !analysisTaskExecutor.getThreadPoolExecutor().getQueue().isEmpty())) {
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
