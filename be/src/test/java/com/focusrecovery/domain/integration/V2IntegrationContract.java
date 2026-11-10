package com.focusrecovery.domain.integration;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.service.PageVisitService;
import com.focusrecovery.domain.visit.dto.*;
import com.focusrecovery.domain.window.entity.*;
import com.focusrecovery.domain.window.repository.*;
import com.focusrecovery.domain.window.service.WindowDecisionService;
import com.focusrecovery.domain.analysis.client.*;
import com.focusrecovery.domain.analysis.dto.*;
import com.focusrecovery.domain.analysis.entity.*;
import com.focusrecovery.domain.analysis.repository.*;
import com.focusrecovery.domain.analysis.service.*;
import com.focusrecovery.domain.composition.service.*;
import com.focusrecovery.domain.composition.repository.ComposeRequestRepository;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.alert.service.AlertDisplayService;
import com.focusrecovery.domain.privacy.service.PrivacyRetractionService;
import com.focusrecovery.domain.privacy.dto.Retraction;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.support.MockV2AiServer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.*;

@com.focusrecovery.support.SyntheticAuthenticated
abstract class V2IntegrationContract {
	static class AdjustableClock extends Clock {
		private Instant fixed;
		void resume() { fixed = null; }
		void freeze() { fixed = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS); }
		void advance(Duration duration) { fixed = fixed.plus(duration); }
		@Override public java.time.ZoneId getZone() { return java.time.ZoneOffset.UTC; }
		@Override public Clock withZone(java.time.ZoneId zone) { return this; }
		@Override public Instant instant() { return fixed == null ? Instant.now() : fixed; }
	}
	@org.springframework.boot.test.context.TestConfiguration
	static class TimeConfiguration {
		@org.springframework.context.annotation.Bean @org.springframework.context.annotation.Primary
		AdjustableClock testClock() { return new AdjustableClock(); }
	}
	@Autowired AdjustableClock clock;
	static final MockV2AiServer AI = new MockV2AiServer();
	@DynamicPropertySource static void ai(DynamicPropertyRegistry properties) { properties.add("focus-recovery.ai.base-url", AI::url); }
	@Autowired WorkSessionService sessions;
	@Autowired WorkSessionRepository sessionRows;
	@Autowired PageVisitService visits;
	@Autowired CompositionService compose;
	@Autowired ComposeRequestRepository composeRows;
	@Autowired V2Dispatcher dispatcher;
	@Autowired V2AnalysisOutboxService outbox;
	@Autowired AnalysisOutboxRepository outboxRows;
	@Autowired AnalysisResultRepository analyses;
	@Autowired AnalysisWindowRepository windows;
	@Autowired WindowStateHistoryRepository states;
	@Autowired WindowDecisionService decisions;
	@Autowired AnalysisQueryService queries;
	@Autowired PrivacyRetractionService privacy;
	@Autowired NotificationRepository notifications;
	@Autowired AlertDisplayService display;
	@Autowired V2AiClient client;
	@Autowired JsonMapper mapper;
	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;
	@Autowired MockMvc mvc;
	UUID session;
	@BeforeEach void init() { AI.reset(); clock.resume(); session = sessions.create("합성 공개 문서 비교하기", null, "2.0").sessionId(); }
	CreatePageVisitRequest request(UUID id, int sequence, long duration) {
		return new CreatePageVisitRequest(id.toString(), sequence, "synthetic-tab", "https://example.org/docs", "example.org", "합성 제목",
			"합성 테스트를 위한 공개 예제 본문입니다. ".repeat(4), null, false, Instant.parse("2026-11-10T00:00:00Z"), duration, 0, 1L, "SUCCESS");
	}
	UUID append(int sequence) { UUID id = UUID.randomUUID(); visits.save(session, request(id, sequence, 5000)); return id; }
	UUID prepare() { UUID id = UUID.randomUUID(); compose.prepareNext(session, id); return id; }
	void composeNow() { dispatcher.runComposition(session, prepare()); }
	List<AnalysisWindow> windows() { return tx.execute(s -> { var items = windows.findBySessionIdOrderByWindowIndex(session); items.forEach(w -> w.getVisitIds().size()); return items; }); }
	AnalysisResult analysis(AnalysisWindow window) { return analyses.findByWindowId(window.getWindowId()).orElseThrow(); }
	void analyzeNow(AnalysisWindow window) { dispatcher.runAnalysis(session, analysis(window).getAnalysisId()); decisions.process(session, window.getWindowId()); }
	AnalysisWindow oneWindow() { append(1); append(3); append(8); composeNow(); return windows().getFirst(); }
	V2AnalysisStatusResponse snapshotStatus() { return (V2AnalysisStatusResponse) queries.status(session); }
	WindowStateHistory latest(AnalysisWindow w) { return states.findFirstByIdWindowIdOrderByIdStateVersionDesc(w.getWindowId()).orElseThrow(); }
	void patch(UUID id, long duration, long version) { visits.updateBehavior(session, id, new UpdateVisitBehaviorRequest(duration, 0, version)); }
	void code(Runnable work, String code) { assertThatThrownBy(work::run).isInstanceOf(ConflictException.class).extracting("code").isEqualTo(code); }
	void mutateResponse(Consumer<ObjectNode> mutate) {
		AI.handler = (path, body) -> { ObjectNode response = (ObjectNode) mapper.readTree(AI.normal(path, body).body()); mutate.accept(response); return new MockV2AiServer.Reply(200, mapper.writeValueAsString(response)); };
	}
	@Test void streamOneToFiveAndSparseSequenceCreatesExactlyThreeWindows() {
		List<UUID> ids = new ArrayList<>();
		for (int sequence : List.of(1, 3, 8, 20, 21)) {
			ids.add(append(sequence)); composeNow();
			assertThat(windows()).hasSize(Math.max(0, ids.size() - 2));
			assertThat(sessionRows.findById(session).orElseThrow().getComposedThroughSequence()).isEqualTo(sequence);
		}
		for (int i = 0; i < 3; i++) assertThat(windows().get(i).getVisitIds()).containsExactlyElementsOf(ids.subList(i, i + 3));
		assertThat(AI.lastComposition.get("visits").get(0).propertyNames()).containsExactlyInAnyOrder("visitId", "sequence");
		assertThat(AI.analysisCalls.get()).isZero();
	}
	@Test void appendAndBehaviorDuringHttpPreserveFrozenPrefixAndLatestFirstDecision() {
		UUID first = append(1); append(3); UUID last = append(8); UUID job = prepare();
		AI.handler = (path, body) -> {
			assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
			if (path.endsWith("window-compositions")) { append(10); patch(first, 6000, 2); }
			else patch(last, 300000, 2);
			return AI.normal(path, body);
		};
		dispatcher.runComposition(session, job); var w = windows().getFirst(); analyzeNow(w);
		assertThat(latest(w).getId().stateVersion()).isEqualTo(1); assertThat(latest(w).getFinalState()).isEqualTo("DRIFT");
		assertThat(mapper.readTree(latest(w).getBehaviorSnapshot()).get(2).get("activeDurationMs").longValue()).isEqualTo(300000);
		assertThat(sessionRows.findById(session).orElseThrow().isCompositionDirty()).isTrue();
		assertThat(sessionRows.findById(session).orElseThrow().getComposedThroughSequence()).isEqualTo(8);
		assertThat(AI.lastAnalysis.get("visits").get(0).has("activeDurationMs")).isFalse();
		assertThat(AI.lastAnalysis.get("visits").get(0).has("searchQuery")).isTrue();
	}
	@Test void behaviorFanoutReusesAiAndWindowsAndVersionsEvenWhenStateUnchanged() {
		append(1); append(3); UUID shared = append(8); append(10); append(12); composeNow(); var all = windows();
		all.forEach(this::analyzeNow); int calls = AI.analysisCalls.get();
		patch(shared, 299999, 2);
		assertThat(windows()).allSatisfy(w -> assertThat(w.isDecisionDirty()).isTrue());
		assertThat(snapshotStatus().currentDecision().decisionStatus()).isEqualTo("PENDING");
		all.forEach(w -> decisions.process(session, w.getWindowId()));
		assertThat(all).allSatisfy(w -> assertThat(latest(w).getId().stateVersion()).isEqualTo(2));
		patch(shared, 300000, 3); all.forEach(w -> decisions.process(session, w.getWindowId()));
		assertThat(latest(all.getFirst()).getFinalState()).isEqualTo("DRIFT");
		assertThat(all).allSatisfy(w -> assertThat(latest(w).getId().stateVersion()).isEqualTo(3));
		patch(shared, 299999, 2); all.forEach(w -> decisions.process(session, w.getWindowId()));
		assertThat(AI.analysisCalls.get()).isEqualTo(calls); assertThat(windows()).hasSize(3);
		assertThat(all).allSatisfy(w -> assertThat(latest(w).getId().stateVersion()).isEqualTo(3));
	}
	@Test void finalBehaviorsAreAtomicAndRejudgeAfterSessionEndWithoutAlert() {
		var w = oneWindow(); analyzeNow(w);
		var finalValue = new com.focusrecovery.domain.session.dto.EndWorkSessionRequest.FinalBehavior(w.getEndVisitId().toString(), 300000L, 0, 2L);
		sessions.end(session, List.of(finalValue)); decisions.process(session, w.getWindowId());
		assertThat(latest(w).getFinalState()).isEqualTo("DRIFT"); assertThat(latest(w).getId().stateVersion()).isEqualTo(2);
		assertThat(snapshotStatus().alert()).isNull(); assertThat(AI.analysisCalls.get()).isEqualTo(1); assertThat(windows()).hasSize(1);
	}
	@Test void pendingAndFailedLatestWindowNeverUsesOlderSuccessAsCurrent() {
		var w1 = oneWindow(); analyzeNow(w1); append(10); composeNow(); var w2 = windows().getLast();
		assertThat(snapshotStatus().currentDecision().windowId()).isEqualTo(w2.getWindowId());
		assertThat(snapshotStatus().currentDecision().decisionStatus()).isEqualTo("PENDING"); assertThat(snapshotStatus().currentDecision().finalState()).isNull();
		assertThat(snapshotStatus().lastSuccessfulState().windowId()).isEqualTo(w1.getWindowId());
		AI.handler = (path, body) -> new MockV2AiServer.Reply(503, "{\"apiContractVersion\":2,\"code\":\"AI_NOT_READY\"}");
		analyzeNow(w2); assertThat(snapshotStatus().currentDecision().decisionStatus()).isEqualTo("FAILED");
		assertThat(snapshotStatus().alert()).isNull(); assertThat(states.findByIdWindowIdOrderByIdStateVersionDesc(w2.getWindowId())).isEmpty();
		dispatcher.runAnalysis(session, analysis(w2).getAnalysisId()); assertThat(AI.analysisCalls.get()).isEqualTo(2);
	}
	@ParameterizedTest @ValueSource(strings={"version", "hash", "id", "missing", "extra", "position", "duplicate", "reverse", "label", "score", "score-type", "rationale", "model", "timestamp", "calendar", "uuid-case"})
	void malformedAnalysisIsNeverPersisted(String mutation) {
		var w = oneWindow();
		mutateResponse(r -> {
			var pages = (ArrayNode) r.get("pageResults"); var page = (ObjectNode) pages.get(0);
			switch (mutation) {
				case "version" -> r.put("apiContractVersion", 1); case "hash" -> r.put("inputFingerprint", "a".repeat(64));
				case "id" -> r.put("windowId", UUID.randomUUID().toString()); case "missing" -> page.remove("semanticRelevance");
				case "extra" -> r.put("finalState", "NORMAL"); case "position" -> page.put("position", "1");
				case "duplicate" -> pages.set(1, page.deepCopy()); case "reverse" -> { var old = pages.get(0); pages.set(0, pages.get(2)); pages.set(2, old); }
				case "label" -> page.put("label", "NORMAL"); case "score" -> page.put("semanticRelevance", 1.01); case "score-type" -> page.put("semanticRelevance", "0.5");
				case "rationale" -> page.put("rationale", " "); case "model" -> ((ObjectNode) r.get("modelVersions")).remove("prompt");
				case "timestamp" -> r.put("analyzedAt", "2026-11-10T00:00:00Z"); case "calendar" -> r.put("analyzedAt", "2026-02-30T00:00:00.000Z");
				case "uuid-case" -> page.put("visitId", "INVALID-UUID");
			}
		});
		analyzeNow(w); assertThat(analysis(w).getErrorCode()).isEqualTo("AI_INVALID_RESPONSE");
		assertThat(analysis(w).getPageResults()).isNull(); assertThat(states.findByIdWindowIdOrderByIdStateVersionDesc(w.getWindowId())).isEmpty();
	}
	@ParameterizedTest @ValueSource(strings={"version", "hash", "id", "after", "through", "missing-window", "wrong-member", "wrong-end", "reverse", "duplicate", "extra"})
	void malformedCompositionKeepsCursorAndNoPartialWindows(String mutation) {
		append(1); append(3); append(8); append(10); UUID job = prepare();
		mutateResponse(r -> {
			var items = (ArrayNode) r.get("windows"); var first = (ObjectNode) items.get(0);
			switch (mutation) {
				case "version" -> r.put("apiContractVersion", 1); case "hash" -> r.put("inputFingerprint", "a".repeat(64));
				case "id" -> r.put("sessionId", UUID.randomUUID().toString()); case "after" -> r.put("afterSequence", 3);
				case "through" -> r.put("composedThroughSequence", 8); case "missing-window" -> items.remove(1);
				case "wrong-member" -> ((ArrayNode) first.get("visitIds")).set(0, mapper.valueToTree(UUID.randomUUID()));
				case "wrong-end" -> first.put("endVisitId", UUID.randomUUID().toString());
				case "reverse" -> { var old = items.get(0); items.set(0, items.get(1)); items.set(1, old); }
				case "duplicate" -> items.set(1, first.deepCopy()); case "extra" -> first.put("windowId", UUID.randomUUID().toString());
			}
		});
		dispatcher.runComposition(session, job); assertThat(windows()).isEmpty();
		assertThat(sessionRows.findById(session).orElseThrow().getComposedThroughSequence()).isZero();
		assertThat(composeRows.findById(job).orElseThrow().getErrorCode()).isEqualTo("AI_INVALID_RESPONSE");
	}
	@Test void receiptAndDuplicateWorkerExecuteOnlyOnce() throws Exception {
		append(1); append(3); append(8); UUID job = prepare();
		race(() -> dispatcher.runComposition(session, job));
		assertThat(AI.compositionCalls.get()).isEqualTo(1); var w = windows().getFirst();
		race(() -> dispatcher.runAnalysis(session, analysis(w).getAnalysisId()));
		assertThat(AI.analysisCalls.get()).isEqualTo(1);
		race(() -> decisions.process(session, w.getWindowId()));
		assertThat(states.findByIdWindowIdOrderByIdStateVersionDesc(w.getWindowId())).hasSize(1);
		dispatcher.runComposition(session, job); assertThat(windows()).hasSize(1); assertThat(AI.compositionCalls.get()).isEqualTo(1);
	}
	@Test void privacyWhileHttpRejectsBothLateResultsAndStatusExposure() {
		append(1); append(3); UUID id = append(8); UUID job = prepare();
		AI.handler = (path, body) -> { privacy.quarantine(session, new Retraction.Request(UUID.randomUUID(), id, "SENSITIVE_CONTENT", Instant.EPOCH)); return AI.normal(path, body); };
		dispatcher.runComposition(session, job); assertThat(windows()).isEmpty();
		assertThat(composeRows.findById(job).orElseThrow().getProcessingStatus()).isEqualTo("INVALIDATED");
		AI.reset(); clock.resume(); session = sessions.create("합성 두 번째 비교 목표", null, "2.0").sessionId(); var w = oneWindow();
		AI.handler = (path, body) -> { privacy.quarantine(session, new Retraction.Request(UUID.randomUUID(), w.getEndVisitId(), "SENSITIVE_CONTENT", Instant.EPOCH)); return AI.normal(path, body); };
		dispatcher.runAnalysis(session, analysis(w).getAnalysisId());
		assertThat(analysis(w).getProcessingStatus()).isEqualTo(AnalysisStatus.INVALIDATED); assertThat(analysis(w).getPageResults()).isNull();
		assertThat(snapshotStatus().currentDecision().decisionStatus()).isEqualTo("INVALIDATED"); assertThat(snapshotStatus().lastSuccessfulState()).isNull(); assertThat(snapshotStatus().alert()).isNull();
		assertThat(snapshotStatus().latestCompletedAnalysis()).isNull();
	}
	@Test void decisionRollbackKeepsDirtyAndRollsBackStateAndCandidate() {
		var w = oneWindow(); patch(w.getEndVisitId(), 300000, 2); dispatcher.runAnalysis(session, analysis(w).getAnalysisId());
		assertThatThrownBy(() -> tx.executeWithoutResult(s -> { decisions.process(session, w.getWindowId()); throw new IllegalStateException("synthetic rollback"); })).isInstanceOf(IllegalStateException.class);
		assertThat(states.findByIdWindowIdOrderByIdStateVersionDesc(w.getWindowId())).isEmpty();
		assertThat(notifications.findBySessionIdAndShownAtIsNull(session)).isEmpty(); assertThat(windows().getFirst().isDecisionDirty()).isTrue();
		decisions.process(session, w.getWindowId()); assertThat(latest(w).getId().stateVersion()).isEqualTo(1); assertThat(snapshotStatus().alert()).isNotNull();
	}
	@Test void candidateVersionReplacementShownHistoryAndConsecutiveDriftProtection() {
		var w = oneWindow(); patch(w.getEndVisitId(), 300000, 2); analyzeNow(w); var first = snapshotStatus().alert();
		assertThat(first).isNotNull(); decisions.process(session, w.getWindowId()); assertThat(snapshotStatus().alert().alertId()).isEqualTo(first.alertId());
		patch(w.getEndVisitId(), 300001, 3); assertThat(snapshotStatus().alert()).isNull(); decisions.process(session, w.getWindowId()); var second = snapshotStatus().alert();
		assertThat(second.stateVersion()).isEqualTo(2); assertThat(second.alertId()).isNotEqualTo(first.alertId());
		assertThat(notifications.findById(first.alertId()).orElseThrow().getInvalidatedAt()).isNotNull();
		display.markShown(session, second.alertId(), Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS));
		patch(w.getEndVisitId(), 300002, 4); decisions.process(session, w.getWindowId()); assertThat(snapshotStatus().alert()).isNull();
		assertThat(notifications.findById(second.alertId()).orElseThrow().getShownAt()).isNotNull();
		assertThat(notifications.findById(second.alertId()).orElseThrow().getInvalidatedAt()).isNull();
	}
	@Test void oldWindowLateCompletionCannotCreateCandidateAndNewestFailureBlocksAlert() {
		AI.labels = List.of("UNRELATED", "UNRELATED", "UNRELATED"); var w1 = oneWindow(); append(10); composeNow(); var w2 = windows().getLast();
		analyzeNow(w1); assertThat(latest(w1).getFinalState()).isEqualTo("DRIFT"); assertThat(snapshotStatus().alert()).isNull();
		analyzeNow(w2); assertThat(snapshotStatus().alert().windowId()).isEqualTo(w2.getWindowId());
		append(12); composeNow(); assertThat(snapshotStatus().alert()).isNull();
		assertThat(notifications.findByWindowIdAndStateVersion(w2.getWindowId(), 1).orElseThrow().getInvalidatedAt()).isNotNull();
	}
	@Test void historyApiPaginatesAndValidatesOwnershipAndPrivacy() throws Exception {
		var w = oneWindow(); analyzeNow(w); patch(w.getEndVisitId(), 300000, 2); decisions.process(session, w.getWindowId());
		String path = "/api/sessions/" + session + "/windows/" + w.getWindowId() + "/states";
		mvc.perform(get(path).param("size", "1")).andExpect(status().isOk()).andExpect(jsonPath("$.items[0].stateVersion").value(2)).andExpect(jsonPath("$.totalElements").value(2)).andExpect(jsonPath("$.totalPages").value(2));
		mvc.perform(get(path).param("page", "1").param("size", "1")).andExpect(jsonPath("$.items[0].stateVersion").value(1));
		mvc.perform(get(path).param("size", "101")).andExpect(status().isBadRequest());
		mvc.perform(get(path).param("page", "-1")).andExpect(status().isBadRequest());
		UUID other = sessions.create("합성 별도 세션 목표", null, "2.0").sessionId();
		mvc.perform(get(path.replace(session.toString(), other.toString()))).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("WINDOW_NOT_FOUND"));
		privacy.quarantine(session, new Retraction.Request(UUID.randomUUID(), w.getEndVisitId(), "SENSITIVE_CONTENT", Instant.EPOCH));
		mvc.perform(get(path)).andExpect(status().isConflict());
		mvc.perform(get("/api/sessions/" + session + "/analysis-status")).andExpect(status().isOk()).andExpect(jsonPath("$.currentDecision.finalState").isEmpty()).andExpect(jsonPath("$.lastSuccessfulState").isEmpty()).andExpect(jsonPath("$.alert").isEmpty());
	}
	@Test void leaseRecoveryFencesLateAnalysisAndCompositionRetainsIdentity() {
		var w = oneWindow(); UUID id = analysis(w).getAnalysisId(); var claim = outbox.claim(session, id);
		jdbc.update("update analysis_outbox set lease_until=? where analysis_id=?", java.sql.Timestamp.from(Instant.EPOCH), id.toString());
		outbox.recover(session, id); assertThat(analysis(w).getErrorCode()).isEqualTo("ANALYSIS_INTERRUPTED");
		var input = mapper.readValue(claim.inputSnapshot(), V2AnalysisInput.class);
		code(() -> outbox.complete(session, id, claim.token(), client.analyze(input)), "ANALYSIS_CLAIM_LOST");
		append(10); UUID job = prepare(); var old = compose.claim(session, job);
		jdbc.update("update compose_request set lease_until=? where compose_request_id=?", java.sql.Timestamp.from(Instant.EPOCH), job.toString());
		compose.recover(session, job); var next = compose.claim(session, job);
		assertThat(next.input()).isEqualTo(old.input()); assertThat(next.token()).isNotEqualTo(old.token());
		code(() -> compose.complete(session, job, old.token(), client.compose(old.input())), "COMPOSE_CLAIM_LOST");
	}
	@Test void boundedCompositionBackoffRetainsSnapshotAndDoesNotAdvanceCursor() {
		append(1); UUID job = prepare(); String frozen = composeRows.findById(job).orElseThrow().getInputSnapshot();
		AI.handler = (path, body) -> new MockV2AiServer.Reply(503, "{\"code\":\"AI_NOT_READY\"}");
		for (int attempt = 1; attempt <= 3; attempt++) {
			dispatcher.runComposition(session, job);
			assertThat(composeRows.findById(job).orElseThrow().getAttempts()).isEqualTo(attempt);
			assertThat(composeRows.findById(job).orElseThrow().getInputSnapshot()).isEqualTo(frozen);
			if (attempt < 3) { assertThat(compose.claim(session, job)).isNull(); jdbc.update("update compose_request set next_attempt_at=? where compose_request_id=?", java.sql.Timestamp.from(Instant.EPOCH), job.toString()); }
		}
		compose.prepareDirty(session); assertThat(composeRows.findBySessionId(session)).hasSize(1);
		assertThat(composeRows.findById(job).orElseThrow().getProcessingStatus()).isEqualTo("FAILED");
		assertThat(sessionRows.findById(session).orElseThrow().getComposedThroughSequence()).isZero();
	}
	@Test void latestForwardReturnAndMinimumIntervalAreBothRequired() throws Exception {
		clock.freeze(); AI.labels = List.of("UNRELATED", "UNRELATED", "UNRELATED"); var first = oneWindow(); analyzeNow(first);
		var shown = snapshotStatus().alert(); display.markShown(session, shown.alertId(), clock.instant());
		append(10); composeNow(); var returned = windows().getLast(); AI.labels = List.of("DIRECT", "DIRECT", "DIRECT"); analyzeNow(returned);
		append(12); composeNow(); var drift = windows().getLast(); AI.labels = List.of("UNRELATED", "UNRELATED", "UNRELATED"); analyzeNow(drift);
		clock.advance(Duration.ofMillis(299999));
		assertThat(snapshotStatus().alert()).isNull();
		clock.advance(Duration.ofMillis(1));
		patch(drift.getEndVisitId(), 6000, 2); decisions.process(session, drift.getWindowId());
		assertThat(snapshotStatus().alert()).isNotNull(); assertThat(snapshotStatus().alert().windowId()).isEqualTo(drift.getWindowId());
	}
	@Test void pendingAnalysisPatchAndDecisionRaceCannotLoseNewestBehavior() throws Exception {
		var w = oneWindow(); patch(w.getEndVisitId(), 299999, 2); dispatcher.runAnalysis(session, analysis(w).getAnalysisId());
		CountDownLatch calculated = new CountDownLatch(1), release = new CountDownLatch(1), patchStarted = new CountDownLatch(1);
		try (var pool = Executors.newFixedThreadPool(2)) {
			var judgment = pool.submit(() -> tx.executeWithoutResult(s -> {
				decisions.process(session, w.getWindowId()); calculated.countDown();
				try { if (!release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("test timeout"); } catch (InterruptedException e) { throw new IllegalStateException(e); }
			}));
			assertThat(calculated.await(5, TimeUnit.SECONDS)).isTrue();
			var changed = pool.submit(() -> { patchStarted.countDown(); patch(w.getEndVisitId(), 300000, 3); });
			assertThat(patchStarted.await(5, TimeUnit.SECONDS)).isTrue(); release.countDown();
			judgment.get(5, TimeUnit.SECONDS); changed.get(5, TimeUnit.SECONDS);
		}
		assertThat(latest(w).getId().stateVersion()).isEqualTo(1); assertThat(latest(w).getFinalState()).isEqualTo("NORMAL");
		assertThat(windows().getFirst().isDecisionDirty()).isTrue(); decisions.process(session, w.getWindowId());
		assertThat(latest(w).getId().stateVersion()).isEqualTo(2); assertThat(latest(w).getFinalState()).isEqualTo("DRIFT"); assertThat(AI.analysisCalls.get()).isEqualTo(1);
	}
	@Test void finalBehaviorFailureRollsBackDirtyAndBehaviorTogether() {
		var w = oneWindow(); analyzeNow(w);
		var valid = new com.focusrecovery.domain.session.dto.EndWorkSessionRequest.FinalBehavior(w.getEndVisitId().toString(), 300000L, 0, 2L);
		var invalid = new com.focusrecovery.domain.session.dto.EndWorkSessionRequest.FinalBehavior(UUID.randomUUID().toString(), 300000L, 0, 2L);
		assertThatThrownBy(() -> sessions.end(session, List.of(valid, invalid))).isInstanceOf(com.focusrecovery.domain.visit.exception.VisitNotFoundException.class);
		assertThat(windows().getFirst().isDecisionDirty()).isFalse(); assertThat(snapshotStatus().sessionStatus().name()).isEqualTo("ACTIVE");
		decisions.process(session, w.getWindowId()); assertThat(latest(w).getId().stateVersion()).isEqualTo(1); assertThat(latest(w).getFinalState()).isEqualTo("NORMAL");
	}
	@Test void privacyBeforeDecisionAndAfterShownAlwaysBlocksResultsAndAckReplay() {
		var w = oneWindow(); patch(w.getEndVisitId(), 300000, 2); analyzeNow(w); var alert = snapshotStatus().alert();
		Instant shown = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS); display.markShown(session, alert.alertId(), shown);
		patch(w.getEndVisitId(), 300001, 3); privacy.quarantine(session, new Retraction.Request(UUID.randomUUID(), w.getEndVisitId(), "CONSENT_WITHDRAWN", Instant.EPOCH));
		code(() -> decisions.process(session, w.getWindowId()), "PRIVACY_RETRACTED");
		code(() -> display.markShown(session, alert.alertId(), shown), "PRIVACY_RETRACTED");
		assertThat(states.findByIdWindowIdOrderByIdStateVersionDesc(w.getWindowId())).hasSize(1);
		assertThat(notifications.findById(alert.alertId()).orElseThrow().getShownAt()).isEqualTo(shown);
		assertThat(snapshotStatus().lastSuccessfulState()).isNull();
	}
	@Test void unicodeModelVersionUsesCodePointsAndVersionedListDetailExposeOnlyV2Evidence() throws Exception {
		var w = oneWindow();
		mutateResponse(r -> ((ObjectNode) r.get("modelVersions")).put("prompt", "😀".repeat(200)));
		analyzeNow(w); assertThat(analysis(w).getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		mvc.perform(get("/api/sessions/" + session + "/analyses")).andExpect(status().isOk()).andExpect(jsonPath("$.items[0].apiContractVersion").value(2)).andExpect(jsonPath("$.items[0].currentDecision.finalState").value("NORMAL"));
		mvc.perform(get("/api/sessions/" + session + "/analyses/" + analysis(w).getAnalysisId())).andExpect(status().isOk()).andExpect(jsonPath("$.pageResults.length()").value(3)).andExpect(jsonPath("$.pDrift").isEmpty());
	}
	@Test void sessionEndInvalidatesUnshownCandidateAndBlocksNewDisplayButKeepsHistoricalAck() {
		var w = oneWindow(); patch(w.getEndVisitId(), 300000, 2); analyzeNow(w); var candidate = snapshotStatus().alert();
		var ended = sessions.end(session, List.of());
		assertThat(snapshotStatus().alert()).isNull(); assertThat(notifications.findById(candidate.alertId()).orElseThrow().getInvalidatedAt()).isNotNull();
		code(() -> display.markShown(session, candidate.alertId(), ended.endedAt().plusMillis(1)), "ALERT_NOT_DISPLAYABLE");
	}
	void race(Runnable work) throws Exception {
		try (var pool = Executors.newFixedThreadPool(2)) {
			CountDownLatch start = new CountDownLatch(1);
			Callable<Void> call = () -> { start.await(); work.run(); return null; };
			var a = pool.submit(call); var b = pool.submit(call); start.countDown(); a.get(10, TimeUnit.SECONDS); b.get(10, TimeUnit.SECONDS);
		}
	}
    @Autowired com.focusrecovery.domain.identity.AuthenticationService authentication95;
    @Autowired com.focusrecovery.domain.consent.ConsentService consent95;
    @Autowired com.focusrecovery.domain.consent.WithdrawalService withdrawal95;
    record Actor95(UUID id, String token) {}
    Actor95 actor95() {
        UUID id = UUID.randomUUID(); byte[] bytes = new byte[32]; new java.security.SecureRandom().nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",id.toString(),com.focusrecovery.domain.identity.AuthenticationService.digest(UUID.randomUUID().toString()),java.sql.Timestamp.from(clock.instant()));
        jdbc.update("INSERT INTO access_credential(token_hash,participant_id,expires_at) VALUES(?,?,?)",com.focusrecovery.domain.identity.AuthenticationService.digest(token),id.toString(),java.sql.Timestamp.from(Instant.parse("2099-01-01T00:00:00Z")));
        var actor = new Actor95(id,token); as95(actor);
        var policy = consent95.policy(); consent95.accept(new com.focusrecovery.domain.consent.ConsentService.Accept(UUID.randomUUID(),policy.policyId(),policy.policyVersion(),true));
        return actor;
    }
    void as95(Actor95 actor) { com.focusrecovery.domain.identity.AuthenticatedParticipant.bind(authentication95.authenticate("Bearer " + actor.token())); }
    @Test void realAlertVisitWindowAndAnalysisIdsRemainOwnerScopedAfterAccountSwitch() throws Exception {
        var alice = actor95(); session = sessions.create("합성 인증 소유권 비교 목표",null,"2.0").sessionId();
        var window = oneWindow(); patch(window.getEndVisitId(),300000,2); analyzeNow(window); var alert = snapshotStatus().alert(); assertThat(alert).isNotNull();
        var bob = actor95(); UUID own = sessions.create("다른 합성 참여자 목표",null,"2.0").sessionId();
        String bearer = "Bearer " + bob.token(), base = "/api/sessions/"+session;
        for (String suffix : List.of("", "/analysis-status", "/windows/"+window.getWindowId()+"/states", "/analyses/"+analysis(window).getAnalysisId()))
            mvc.perform(get(base+suffix).header("Authorization",bearer)).andExpect(status().isNotFound());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch(base+"/alerts/"+alert.alertId()+"/shown").header("Authorization",bearer).contentType(MediaType.APPLICATION_JSON).content("{\"shownAt\":\"2026-11-10T00:00:00.000Z\"}")).andExpect(status().isNotFound());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/api/sessions/"+own+"/alerts/"+alert.alertId()+"/shown").header("Authorization",bearer).contentType(MediaType.APPLICATION_JSON).content("{\"shownAt\":\"2026-11-10T00:00:00.000Z\"}")).andExpect(status().isNotFound());
        assertThatThrownBy(() -> visits.save(own,request(window.getEndVisitId(),1,5000))).isInstanceOf(com.focusrecovery.domain.visit.exception.VisitNotFoundException.class);
        assertThatThrownBy(() -> visits.updateBehavior(session,window.getEndVisitId(),new UpdateVisitBehaviorRequest(400000L,0,3L))).isInstanceOf(com.focusrecovery.domain.session.exception.SessionNotFoundException.class);
        as95(alice); assertThat(snapshotStatus().alert().alertId()).isEqualTo(alert.alertId());
    }
    @Test void participantWithdrawalDuringAiHttpRejectsLateCommitAndInvalidatesClaims() {
        var actor = actor95(); session = sessions.create("합성 진행 중 분석 철회 목표",null,"2.0").sessionId(); var window = oneWindow();
        AI.handler = (path,body) -> {
            if (path.endsWith("analyses")) { as95(actor); try { withdrawal95.accept(UUID.randomUUID()); } finally { com.focusrecovery.domain.identity.AuthenticatedParticipant.clear(); } }
            return AI.normal(path,body);
        };
        dispatcher.runAnalysis(session,analysis(window).getAnalysisId());
        assertThat(analysis(window).getProcessingStatus()).isEqualTo(AnalysisStatus.INVALIDATED);
        assertThat(analysis(window).getPageResults()).isNull();
        code(() -> decisions.process(session,window.getWindowId()),"PRIVACY_RETRACTED");
        assertThat(states.findByIdWindowIdOrderByIdStateVersionDesc(window.getWindowId())).isEmpty();
    }
    @org.junit.jupiter.api.RepeatedTest(5) void withdrawalAndShownAckSerializeWithoutReleasingQuarantine() throws Exception {
        var actor = actor95(); session = sessions.create("합성 표시 경합 철회 목표",null,"2.0").sessionId(); var window=oneWindow();patch(window.getEndVisitId(),300000,2);analyzeNow(window);var alert=snapshotStatus().alert();
        var latch = new java.util.concurrent.CountDownLatch(1);
        try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var shown = pool.submit(() -> { as95(actor); try { latch.await(); display.markShown(session,alert.alertId(),clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)); return true; }
                catch(com.focusrecovery.global.exception.ConflictException e) { assertThat(e.getCode()).isEqualTo("PRIVACY_RETRACTED");return false; }
                finally {com.focusrecovery.domain.identity.AuthenticatedParticipant.clear();} });
            var withdrawn = pool.submit(() -> {as95(actor);try {latch.await();return withdrawal95.accept(UUID.randomUUID());}finally {com.focusrecovery.domain.identity.AuthenticatedParticipant.clear();}});
            latch.countDown();boolean stored=shown.get(10,java.util.concurrent.TimeUnit.SECONDS);var receipt=withdrawn.get(10,java.util.concurrent.TimeUnit.SECONDS);
            assertThat(receipt.status()).isEqualTo("QUARANTINED");assertThat(sessionRows.findById(session).orElseThrow().isQuarantined()).isTrue();
            assertThat(notifications.findById(alert.alertId()).orElseThrow().getShownAt()!=null).isEqualTo(stored);
            code(() -> display.markShown(session,alert.alertId(),clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)),"PRIVACY_RETRACTED");
        }
    }
    @Test void withdrawalInventoryFailurePersistsAndRetryPreservesQuarantine() {
        var actor=actor95();session=sessions.create("합성 철회 실패 복구 목표",null,"2.0").sessionId();UUID visit=append(1),id=withdrawal95.accept(UUID.randomUUID()).withdrawalId();
        jdbc.update("UPDATE page_visit SET visit_id='synthetic-corrupt-id' WHERE visit_id=?",visit.toString());
        assertThatThrownBy(() -> withdrawal95.inventory(id,session)).isInstanceOf(IllegalArgumentException.class);withdrawal95.failed(id,session);
        assertThat(withdrawal95.status(id).sessions().getFirst().errorCode()).isEqualTo("INVENTORY_FAILED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM withdrawal_retraction WHERE withdrawal_id=?",Integer.class,id.toString())).isZero();
        jdbc.update("UPDATE page_visit SET visit_id=? WHERE visit_id='synthetic-corrupt-id' AND session_id=?",visit.toString(),session.toString());
        withdrawal95.inventory(id,session);assertThat(withdrawal95.status(id).sessions().getFirst().status()).isEqualTo("INVENTORIED");
        assertThat(withdrawal95.status(id).status()).isEqualTo("QUARANTINED");assertThat(sessionRows.findById(session).orElseThrow().isQuarantined()).isTrue();
    }

}
