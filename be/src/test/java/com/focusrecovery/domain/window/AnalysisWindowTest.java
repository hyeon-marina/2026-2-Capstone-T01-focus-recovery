package com.focusrecovery.domain.window;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doCallRealMethod;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.focusrecovery.domain.alert.repository.AlertCandidateTaskRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.domain.window.service.AnalysisWindowService;

@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AnalysisWindowTest {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private JdbcTemplate jdbcTemplate;

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

	// 기본은 실제 메서드를 그대로 호출한다. 구간 저장 실패 복구 테스트에서만 오류를 주입한다
	@MockitoSpyBean
	private AnalysisWindowService analysisWindowService;

	private UUID sessionId;

	@BeforeEach
	void setUp() {
		alertCandidateTaskRepository.deleteAll();
		notificationRepository.deleteAll();
		analysisResultRepository.deleteAll();
		analysisWindowRepository.deleteAll();
		pageVisitRepository.deleteAll();
		workSessionRepository.deleteAll();
		sessionId = newSession();
	}

	// 다른 테스트 클래스가 세션을 지울 때 외래키에 걸리지 않도록 구간과 방문 기록을 남기지 않는다
	@AfterEach
	void tearDown() {
		alertCandidateTaskRepository.deleteAll();
		notificationRepository.deleteAll();
		analysisResultRepository.deleteAll();
		analysisWindowRepository.deleteAll();
		pageVisitRepository.deleteAll();
	}

	@Test
	void 방문_4개까지는_구간이_없고_5번째부터_한_칸씩_밀며_생성한다() throws Exception {
		for (int sequence = 1; sequence <= 4; sequence++) {
			saveVisit(sessionId, sequence).andExpect(status().isCreated());
		}
		assertThat(windows(sessionId)).isEmpty();

		saveVisit(sessionId, 5).andExpect(status().isCreated());
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 2, 3, 4, 5)));

		saveVisit(sessionId, 6).andExpect(status().isCreated());
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 2, 3, 4, 5), 2, List.of(2, 3, 4, 5, 6)));

		saveVisit(sessionId, 7).andExpect(status().isCreated());
		assertThat(windows(sessionId)).containsEntry(3, List.of(3, 4, 5, 6, 7)).hasSize(3);
	}

	@Test
	void 같은_방문을_재전송하면_200이고_구간은_추가되거나_바뀌지_않는다() throws Exception {
		List<String> visitIds = new ArrayList<>();
		for (int sequence = 1; sequence <= 6; sequence++) {
			String visitId = UUID.randomUUID().toString();
			visitIds.add(visitId);
			saveVisit(sessionId, visitId, sequence).andExpect(status().isCreated());
		}
		List<Map<String, Object>> before = windowRows(sessionId);

		saveVisit(sessionId, visitIds.get(5), 6).andExpect(status().isOk());
		saveVisit(sessionId, visitIds.get(2), 3).andExpect(status().isOk());

		assertThat(windowRows(sessionId)).isEqualTo(before);
	}

	// 변경: 예전에는 1,2,4,5,6에서 3을 기다렸다. sequence는 방문 후보 순서라 제외된 후보 번호가 비는 것이 정상이므로 기다리지 않는다
	@Test
	void 제외된_후보의_번호_공백이_있어도_유효_방문_5개로_구간을_만든다() throws Exception {
		for (int sequence : new int[] {1, 3, 4, 5}) {
			saveVisit(sessionId, sequence).andExpect(status().isCreated());
		}
		assertThat(windows(sessionId)).isEmpty();

		saveVisit(sessionId, 6).andExpect(status().isCreated());
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 3, 4, 5, 6)));

		saveVisit(sessionId, 8).andExpect(status().isCreated());
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 3, 4, 5, 6), 2, List.of(3, 4, 5, 6, 8)));

		saveVisit(sessionId, 12).andExpect(status().isCreated());
		assertThat(windows(sessionId)).containsEntry(3, List.of(4, 5, 6, 8, 12)).hasSize(3);
	}

	@Test
	void 번호_공백이_있어도_재전송하면_200이고_구간은_그대로다() throws Exception {
		List<String> visitIds = new ArrayList<>();
		for (int sequence : new int[] {2, 5, 6, 9, 10, 13}) {
			String visitId = UUID.randomUUID().toString();
			visitIds.add(visitId);
			saveVisit(sessionId, visitId, sequence).andExpect(status().isCreated());
		}
		List<Map<String, Object>> before = windowRows(sessionId);
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(2, 5, 6, 9, 10), 2, List.of(5, 6, 9, 10, 13)));

		saveVisit(sessionId, visitIds.get(5), 13).andExpect(status().isOk());
		saveVisit(sessionId, visitIds.get(0), 2).andExpect(status().isOk());

		assertThat(windowRows(sessionId)).isEqualTo(before);
	}

	// 변경: 예전에는 어떤 도착 순서든 최종 구간이 같았다. 첫 구간 전까지는 sequence로 정렬해 쓰고,
	// 구간이 생긴 뒤 그 끝보다 앞선 새 방문은 기존 구간을 다시 쓰지 않도록 409 VISIT_SEQUENCE_OUT_OF_ORDER로 거절한다
	@Test
	void 첫_구간_이후_마지막_구간보다_앞선_새_방문은_409이고_아무것도_저장하지_않는다() throws Exception {
		String visit3 = UUID.randomUUID().toString();
		for (int sequence : new int[] {7, 9, 1, 4}) {
			saveVisit(sessionId, sequence).andExpect(status().isCreated());
		}
		saveVisit(sessionId, visit3, 3).andExpect(status().isCreated());
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 3, 4, 7, 9)));
		List<Map<String, Object>> before = windowRows(sessionId);

		saveVisit(sessionId, 5)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VISIT_SEQUENCE_OUT_OF_ORDER"));
		assertThat(pageVisitRepository.count()).isEqualTo(5);
		assertThat(windowRows(sessionId)).isEqualTo(before);

		saveVisit(sessionId, 10).andExpect(status().isCreated());
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 3, 4, 7, 9), 2, List.of(3, 4, 7, 9, 10)));

		saveVisit(sessionId, visit3, 3).andExpect(status().isOk()).andExpect(jsonPath("$.sequence").value(3));
		assertThat(windows(sessionId)).hasSize(2);
	}

	@Test
	void 순서_오류보다_ID_sequence_충돌과_종료_오류를_먼저_판정한다() throws Exception {
		String visit3 = UUID.randomUUID().toString();
		for (int sequence : new int[] {1, 4, 7, 9}) {
			saveVisit(sessionId, sequence).andExpect(status().isCreated());
		}
		saveVisit(sessionId, visit3, 3).andExpect(status().isCreated());

		mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
				.contentType(MediaType.APPLICATION_JSON)
				.content(visitBody(visit3, 3).replace("\"title\": \"제목\"", "\"title\": \"다른 제목\"")))
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VISIT_ID_CONFLICT"));
		saveVisit(sessionId, 4)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("VISIT_SEQUENCE_CONFLICT"));
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());
		saveVisit(sessionId, 2)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("SESSION_ENDED"));
		saveVisit(sessionId, visit3, 3).andExpect(status().isOk());

		assertThat(pageVisitRepository.count()).isEqualTo(5);
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 3, 4, 7, 9)));
	}

	// 요청마다 실제 트랜잭션이 커밋·롤백되도록 테스트 자체에는 트랜잭션을 걸지 않는다
	@Test
	void 구간_저장_후_예외로_롤백되면_같은_visitId_재시도로_복구된다() throws Exception {
		for (int sequence = 1; sequence <= 4; sequence++) {
			saveVisit(sessionId, sequence).andExpect(status().isCreated());
		}
		String visitId = UUID.randomUUID().toString();
		AtomicBoolean injected = new AtomicBoolean();
		AtomicReference<String> countsInTransaction = new AtomicReference<>();
		// 스파이는 트랜잭션 프록시 안쪽에 있으므로 스텁 설정 호출이 MANDATORY 검사를 거치지 않도록 대상 객체에 건다
		AnalysisWindowService spy = AopTestUtils.getUltimateTargetObject(analysisWindowService);
		doAnswer(invocation -> {
			invocation.callRealMethod();
			// 같은 요청 트랜잭션 안에서 구간과 구성 방문이 실제로 flush 됐는지 기록한다
			countsInTransaction.set(jdbcTemplate.queryForObject(
				"select concat((select count(*) from analysis_window), '/', (select count(*) from window_visit))", String.class));
			if (injected.compareAndSet(false, true)) {
				throw new DataIntegrityViolationException("주입된 구간 저장 실패");
			}
			return null;
		}).when(spy).createWindows(any(), any());

		assertThatThrownBy(() -> saveVisit(sessionId, visitId, 5))
			.hasRootCauseInstanceOf(DataIntegrityViolationException.class)
			.hasRootCauseMessage("주입된 구간 저장 실패");

		assertThat(injected).isTrue();
		assertThat(countsInTransaction.get()).isEqualTo("1/5");
		assertThat(pageVisitRepository.existsById(UUID.fromString(visitId))).isFalse();
		assertThat(pageVisitRepository.count()).isEqualTo(4);
		assertThat(analysisWindowRepository.count()).isZero();
		assertThat(jdbcTemplate.queryForObject("select count(*) from window_visit", Integer.class)).isZero();

		doCallRealMethod().when(spy).createWindows(any(), any());
		saveVisit(sessionId, visitId, 5).andExpect(status().isCreated()).andExpect(jsonPath("$.visitId").value(visitId));

		assertThat(pageVisitRepository.count()).isEqualTo(5);
		assertThat(analysisWindowRepository.count()).isEqualTo(1);
		assertThat(jdbcTemplate.queryForObject("select count(*) from window_visit", Integer.class)).isEqualTo(5);
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 2, 3, 4, 5)));
		List<Map<String, Object>> before = windowRows(sessionId);

		saveVisit(sessionId, visitId, 5).andExpect(status().isOk()).andExpect(jsonPath("$.visitId").value(visitId));

		assertThat(pageVisitRepository.count()).isEqualTo(5);
		assertThat(analysisWindowRepository.count()).isEqualTo(1);
		assertThat(windowRows(sessionId)).isEqualTo(before);
	}

	@Test
	void 구간에는_같은_세션의_방문만_들어간다() throws Exception {
		UUID otherSessionId = newSession();
		for (int sequence = 1; sequence <= 12; sequence++) {
			saveVisit(sequence % 2 == 0 ? sessionId : otherSessionId, sequence).andExpect(status().isCreated());
		}

		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(2, 4, 6, 8, 10), 2, List.of(4, 6, 8, 10, 12)));
		assertThat(windows(otherSessionId)).isEqualTo(Map.of(1, List.of(1, 3, 5, 7, 9), 2, List.of(3, 5, 7, 9, 11)));
	}

	// 계약대로 세션마다 순서대로 보내되 여러 세션의 저장은 동시에 일어난다
	@RepeatedTest(3)
	void 여러_세션이_동시에_저장해도_세션별_구간이_정확하다() throws Exception {
		List<UUID> sessionIds = List.of(sessionId, newSession(), newSession(), newSession());
		List<Integer> sequences = List.of(1, 2, 4, 7, 8, 9, 11, 15, 16, 20);

		runConcurrently(sessionIds.size(), i -> {
			for (int sequence : sequences) {
				saveVisit(sessionIds.get(i), sequence).andExpect(status().isCreated());
			}
			return null;
		});

		for (UUID id : sessionIds) {
			assertThat(windows(id)).isEqualTo(expectedWindows(sequences));
		}
	}

	// 같은 세션에 순서 없이 동시에 보내는 것은 계약 밖이다. 201로 저장된 방문은 모두 sequence 순서대로 구간에 들어가고,
	// 거절된 방문은 VISIT_SEQUENCE_OUT_OF_ORDER이며 저장되지 않아야 한다(조용히 분석에서 빠지는 방문 없음)
	@RepeatedTest(3)
	void 같은_세션에_동시에_저장해도_저장된_방문은_모두_구간에_들어간다() throws Exception {
		List<Integer> sequences = new ArrayList<>(IntStream.rangeClosed(1, 16).map(i -> i * 2).boxed().toList());
		Collections.shuffle(sequences);

		List<MockHttpServletResponse> responses = runConcurrently(sequences.size(),
			i -> saveVisit(sessionId, sequences.get(i)).andReturn().getResponse());

		List<Integer> saved = new ArrayList<>();
		for (int i = 0; i < responses.size(); i++) {
			if (responses.get(i).getStatus() == 201) {
				saved.add(sequences.get(i));
			} else {
				assertThat(responses.get(i).getStatus()).isEqualTo(409);
				assertThat(responses.get(i).getContentAsString()).contains("VISIT_SEQUENCE_OUT_OF_ORDER");
			}
		}
		Collections.sort(saved);
		assertThat(pageVisitRepository.count()).isEqualTo(saved.size());
		assertThat(windows(sessionId)).isEqualTo(expectedWindows(saved));
		assertThat(windows(sessionId).values().stream().flatMap(List::stream).distinct().sorted().toList()).isEqualTo(saved);
	}

	@Test
	void 같은_방문을_동시에_재전송해도_구간은_한_번만_생성된다() throws Exception {
		for (int sequence : new int[] {1, 2, 4, 5}) {
			saveVisit(sessionId, sequence).andExpect(status().isCreated());
		}
		String visitId = UUID.randomUUID().toString();

		List<Integer> statuses = runConcurrently(8,
			i -> saveVisit(sessionId, visitId, 7).andReturn().getResponse().getStatus());

		assertThat(statuses).containsOnlyOnce(201).filteredOn(s -> s != 201).containsOnly(200);
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 2, 4, 5, 7)));
	}

	@Test
	void 종료된_세션에는_새_방문과_구간이_생성되지_않는다() throws Exception {
		for (int sequence : new int[] {1, 3, 4, 6, 7}) {
			saveVisit(sessionId, sequence).andExpect(status().isCreated());
		}
		List<Map<String, Object>> before = windowRows(sessionId);
		mockMvc.perform(post("/api/sessions/{sessionId}/end", sessionId)).andExpect(status().isOk());

		saveVisit(sessionId, 9)
			.andExpect(status().isConflict())
			.andExpect(jsonPath("$.code").value("SESSION_ENDED"));

		assertThat(windowRows(sessionId)).isEqualTo(before);
		assertThat(windows(sessionId)).isEqualTo(Map.of(1, List.of(1, 3, 4, 6, 7)));
		assertThat(pageVisitRepository.count()).isEqualTo(5);
	}

	private static Map<Integer, List<Integer>> expectedWindows(List<Integer> sortedSequences) {
		Map<Integer, List<Integer>> expected = new LinkedHashMap<>();
		for (int start = 0; start + 5 <= sortedSequences.size(); start++) {
			expected.put(start + 1, sortedSequences.subList(start, start + 5));
		}
		return expected;
	}
	private List<Map<String, Object>> windowRows(UUID sessionId) {
		return jdbcTemplate.queryForList("""
			select w.window_id, w.window_index, w.window_size, w.start_visit_id, w.end_visit_id, w.created_at,
				w.session_id as window_session_id, wv.visit_id, wv.position, v.sequence, v.session_id as visit_session_id
			from analysis_window w
			join window_visit wv on wv.window_id = w.window_id
			join page_visit v on v.visit_id = wv.visit_id
			where w.session_id = ?
			order by w.window_index, wv.position""", sessionId.toString());
	}

	// 구간 번호 → 구간에 담긴 방문 sequence 목록. 모든 구간의 구조(크기·위치·시작/끝·세션 소속)도 함께 검증한다
	private Map<Integer, List<Integer>> windows(UUID sessionId) {
		Map<Integer, List<Integer>> windows = new LinkedHashMap<>();
		for (Map<String, Object> row : windowRows(sessionId)) {
			assertThat(row.get("window_size")).isEqualTo(5);
			assertThat(row.get("visit_session_id")).isEqualTo(sessionId.toString());
			assertThat(row.get("created_at")).isNotNull();
			int position = (Integer) row.get("position");
			if (position == 1) {
				assertThat(row.get("visit_id")).isEqualTo(row.get("start_visit_id"));
			}
			if (position == 5) {
				assertThat(row.get("visit_id")).isEqualTo(row.get("end_visit_id"));
			}
			List<Integer> sequences = windows.computeIfAbsent((Integer) row.get("window_index"), k -> new ArrayList<>());
			assertThat(position).isEqualTo(sequences.size() + 1);
			sequences.add((Integer) row.get("sequence"));
		}
		windows.values().forEach(sequences -> assertThat(sequences).hasSize(5));
		return windows;
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
		return workSessionRepository.save(com.focusrecovery.support.SyntheticIdentities.start("구간 구성 테스트", null)).getSessionId();
	}

	private ResultActions saveVisit(UUID sessionId, int sequence) throws Exception {
		return saveVisit(sessionId, UUID.randomUUID().toString(), sequence);
	}

	private ResultActions saveVisit(UUID sessionId, String visitId, int sequence) throws Exception {
		return mockMvc.perform(post("/api/sessions/{sessionId}/visits", sessionId)
			.contentType(MediaType.APPLICATION_JSON)
			.content(visitBody(visitId, sequence)));
	}

	private static String visitBody(String visitId, int sequence) {
		return """
			{"visitId": "%s", "sequence": %d, "browserTabKey": "tab-1", "normalizedUrl": "https://example.com/%d", \
			"domain": "example.com", "title": "제목", "content": "본문", "activeDurationMs": 1000, \
			"visitedAt": "2026-10-13T01:23:45.678Z"}""".formatted(visitId, sequence, sequence);
	}
}
