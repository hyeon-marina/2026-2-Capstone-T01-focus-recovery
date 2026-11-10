package com.focusrecovery.domain.storage;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.IntStream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.visit.service.PageVisitService;
import com.focusrecovery.domain.visit.dto.*;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.repository.*;
import com.focusrecovery.domain.window.service.WindowStateHistoryService;
import com.focusrecovery.domain.window.dto.SaveWindowState;
import com.focusrecovery.domain.composition.dto.Composition;
import com.focusrecovery.domain.composition.service.CompositionService;
import com.focusrecovery.domain.composition.repository.ComposeRequestRepository;
import com.focusrecovery.domain.analysis.dto.V2AnalysisCompletion;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.*;
import com.focusrecovery.domain.analysis.service.*;
import com.focusrecovery.domain.privacy.dto.Retraction;
import com.focusrecovery.domain.privacy.repository.*;
import com.focusrecovery.domain.privacy.service.PrivacyRetractionService;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.util.CanonicalJson;
import tools.jackson.databind.json.JsonMapper;

// 같은 저장 계약을 H2와 opt-in 실제 MySQL에서 실행한다. 모든 입력은 합성 데이터다.
abstract class V2StorageContract {
	static final Instant TIME = Instant.parse("2026-11-10T00:00:00.000Z");
	@Autowired WorkSessionService sessions;
	@Autowired WorkSessionRepository sessionRows;
	@Autowired PageVisitService visits;
	@Autowired PageVisitRepository visitRows;
	@Autowired CompositionService compose;
	@Autowired ComposeRequestRepository jobs;
	@Autowired AnalysisWindowRepository windows;
	@Autowired AnalysisResultRepository analyses;
	@Autowired AnalysisOutboxRepository tasks;
	@Autowired V2AnalysisOutboxService outbox;
	@Autowired AnalysisExecutor legacyExecutor;
	@Autowired AnalysisRecovery legacyRecovery;
	@Autowired WindowStateHistoryService states;
	@Autowired WindowStateHistoryRepository history;
	@Autowired PrivacyRetractionService privacy;
	@Autowired PrivacyRetractionRepository retractions;
	@Autowired VisitTombstoneRepository tombstones;
	@Autowired RetractionTargetRepository targets;
	@Autowired JdbcTemplate jdbc;
	@Autowired TransactionTemplate tx;
	@Autowired CanonicalJson json;
	@Autowired JsonMapper mapper;
	@Autowired MockMvc mvc;
	UUID session;
	@BeforeEach void start() { session = sessions.create("합성 문서 비교하기", UUID.randomUUID().toString(), "2.0").sessionId(); }
	@AfterEach void cleanup() {
		for (String table : List.of("retraction_target", "visit_tombstone", "privacy_retraction", "window_state_history",
			"analysis_outbox", "compose_request", "notification_response", "alert_candidate_task", "notification",
			"analysis_result", "window_visit", "analysis_window", "page_visit", "work_session")) jdbc.update("delete from " + table);
	}
	CreatePageVisitRequest request(UUID id, int sequence, long duration) {
		return new CreatePageVisitRequest(id.toString(), sequence, "synthetic-tab", "https://example.org/docs", "example.org",
			"합성 공개 문서", "합성 문서의 본문만으로 저장 계약을 검증합니다. ".repeat(4), null, false, TIME, duration, 0, 1L, "SUCCESS");
	}
	UUID append(int sequence) { UUID id = UUID.randomUUID(); visits.save(session, request(id, sequence, 5000)); return id; }
	Composition.Claim claimCompose() {
		UUID id = UUID.randomUUID(); compose.prepareNext(session, id); return compose.claim(session, id);
	}
	Composition.Output output(Composition.Input input) {
		// 모의 AI의 합성 응답. 제품 Backend에 Window 구성 알고리즘으로 사용하지 않는다.
		List<Composition.Window> items = IntStream.range(0, Math.max(0, input.visits().size() - 2)).mapToObj(i -> {
			List<UUID> ids = input.visits().subList(i, i + 3).stream().map(Composition.Visit::visitId).toList();
			return new Composition.Window(ids, ids.getLast());
		}).toList();
		return new Composition.Output(2, input.composeRequestId(), session, input.afterSequence(), input.inputFingerprint(),
			input.visits().getLast().sequence(), items);
	}
	Composition.Receipt complete(Composition.Claim claim) { return compose.complete(session, claim.input().composeRequestId(), claim.token(), output(claim.input())); }
	Composition.StoredWindow window() {
		append(1); append(3); append(4); return complete(claimCompose()).windows().getFirst();
	}
	void finish(Composition.StoredWindow window) {
		var claim = outbox.claim(session, window.analysisId());
		outbox.complete(session, window.analysisId(), claim.token(), result(window));
	}
	V2AnalysisCompletion result(Composition.StoredWindow window) {
		List<UUID> ids = tx.execute(s -> windows.findById(window.windowId()).orElseThrow().getVisitIds());
		return new V2AnalysisCompletion(2, window.analysisId(), session, window.windowId(),
			analyses.findById(window.analysisId()).orElseThrow().getInputFingerprint(),
			IntStream.range(0,3).mapToObj(i -> new V2AnalysisCompletion.Page(i+1,ids.get(i),"DIRECT",0.5,"합성 근거")).toList(),
			Map.of("embedding","synthetic","context","synthetic","prompt","synthetic","labelGuide","synthetic"),TIME);
	}
	SaveWindowState state(Composition.StoredWindow window, String finalState) {
		List<SaveWindowState.Behavior> snapshot = tx.execute(s -> windows.findById(window.windowId()).orElseThrow().getVisitIds().stream()
			.map(id -> SaveWindowState.Behavior.of(visitRows.findById(id).orElseThrow())).toList());
		String hash = json.fingerprint(Map.of("analysisId",window.analysisId(),"ruleVersion","suffix3-v2-proposed.1","behaviorSnapshot",snapshot));
		return new SaveWindowState(window.analysisId(),"suffix3-v2-proposed.1",finalState,snapshot,hash);
	}
	void code(Runnable action, String code) { assertThatThrownBy(action::run).isInstanceOf(ConflictException.class).extracting("code").isEqualTo(code); }

	@Test void versionAndIdempotency() {
		String key = UUID.randomUUID().toString();
		var first = sessions.create("합성 문서 비교하기", key, "2.0");
		assertThat(sessions.create(" 합성 문서 비교하기 ",key,"2.0").sessionId()).isEqualTo(first.sessionId());
		assertThatThrownBy(() -> sessions.create("합성 문서 비교하기",key,null)).isInstanceOf(com.focusrecovery.domain.session.exception.IdempotencyKeyMismatchException.class);
		assertThatThrownBy(() -> sessions.create("합성 다른 목표입니다",key,"2.0")).isInstanceOf(com.focusrecovery.domain.session.exception.IdempotencyKeyMismatchException.class);
		assertThatThrownBy(() -> sessions.create("합성 문서 비교하기",null,"3.0")).isInstanceOf(com.focusrecovery.global.exception.InvalidRequestException.class);
	}
	@Test void minimumDurationAndLegacy() {
		UUID id = UUID.randomUUID();
		assertThatThrownBy(() -> visits.save(session, request(id,1,4999))).isInstanceOf(com.focusrecovery.global.exception.InvalidRequestException.class);
		assertThat(sessionRows.findById(session).orElseThrow().getLastAcceptedSequence()).isZero();
		assertThat(visits.save(session,request(id,1,5000)).created()).isTrue();
		UUID v1 = sessions.create("합성 기존 목표입니다",null).sessionId();
		var old = request(UUID.randomUUID(),1,1000);
		visits.save(v1,new CreatePageVisitRequest(old.visitId(),1,old.browserTabKey(),old.normalizedUrl(),old.domain(),null,null,null,false,TIME,1000L,null,null));
		assertThat(sessionRows.findById(v1).orElseThrow().getCollectionSpecVersion()).isEqualTo("1.0");
		code(() -> visits.save(v1, request(UUID.randomUUID(),2,5000)),"COLLECTION_VERSION_MISMATCH");
	}
	@Test void sequenceGapsReplayConflictAndEndedSession() {
		UUID id = append(1); append(3); append(4);
		assertThat(visits.save(session,request(id,1,5000)).created()).isFalse();
		code(() -> visits.save(session,request(id,2,5000)),"VISIT_ID_CONFLICT");
		code(() -> visits.save(session,request(UUID.randomUUID(),3,5000)),"VISIT_SEQUENCE_CONFLICT");
		code(() -> visits.save(session,request(UUID.randomUUID(),2,5000)),"VISIT_SEQUENCE_OUT_OF_ORDER");
		assertThat(sessionRows.findById(session).orElseThrow().getLastAcceptedSequence()).isEqualTo(4);
		assertThat(windows.count()).isZero();
		sessions.end(session,null);
		assertThat(visits.save(session,request(id,1,5000)).created()).isFalse();
		code(() -> append(5),"SESSION_ENDED");
	}
	@Test void concurrentPostsDoNotBypassWatermark() throws Exception {
		UUID id = UUID.randomUUID(); var outcomes = race(() -> visits.save(session,request(id,1,5000)).created(), () -> visits.save(session,request(id,1,5000)).created());
		assertThat(outcomes).containsExactlyInAnyOrder(true,false);
		var sparse = race(() -> saveSequence(3), () -> saveSequence(4));
		assertThat(sparse).contains("ACCEPTED");
		assertThat(sessionRows.findById(session).orElseThrow().getLastAcceptedSequence()).isEqualTo(4);
		assertThat(visitRows.findBySessionIdOrderBySequence(session)).extracting(v -> v.getSequence()).contains(1,4).doesNotContain(2);
	}
	String saveSequence(int sequence) { try { append(sequence); return "ACCEPTED"; } catch (ConflictException e) { return e.getCode(); } }
	static <T> List<T> race(Callable<T> a, Callable<T> b) throws Exception {
		try (var pool = Executors.newFixedThreadPool(2)) {
			CountDownLatch start = new CountDownLatch(1);
			var one = pool.submit(() -> {start.await();return a.call();}); var two = pool.submit(() -> {start.await();return b.call();});
			start.countDown(); return List.of(one.get(15,TimeUnit.SECONDS),two.get(15,TimeUnit.SECONDS));
		}
	}
	@Test void immutableInputReplayConflictAndAppend() {
		append(1); append(3); append(4); var claim = claimCompose(); var input = claim.input();
		assertThat(compose.prepare(session,input.composeRequestId(),0,input.visits())).isEqualTo(input);
		code(() -> compose.prepare(session,input.composeRequestId(),1,input.visits()),"COMPOSE_ID_CONFLICT");
		code(() -> compose.prepareNext(session,UUID.randomUUID()),"COMPOSE_IN_PROGRESS");
		append(6); var receipt = complete(claim);
		assertThat(receipt.composedThroughSequence()).isEqualTo(4);
		assertThat(complete(claim)).isEqualTo(receipt);
		assertThat(sessionRows.findById(session).orElseThrow().isCompositionDirty()).isTrue();
		var next = claimCompose(); assertThat(next.input().visits()).extracting(Composition.Visit::sequence).containsExactly(3,4,6);
		assertThat(complete(next).windows().getFirst().windowIndex()).isEqualTo(2);
		assertThat(tasks.count()).isEqualTo(2);
	}
	@Test void oneAndTwoVisitEmptyWindowsAdvanceSparseCursor() {
		append(3); assertThat(complete(claimCompose()).windows()).isEmpty();
		append(7); assertThat(complete(claimCompose()).windows()).isEmpty();
		append(9); var receipt = complete(claimCompose());
		assertThat(receipt.composedThroughSequence()).isEqualTo(9); assertThat(receipt.windows()).hasSize(1);
	}
	@Test void malformedCompositionAndFailureNeverAdvanceCursor() {
		append(1);append(3);append(4);var claim = claimCompose();var good = output(claim.input());
		var bad = new Composition.Output(2,good.composeRequestId(),session,0,good.inputFingerprint(),4,List.of());
		code(() -> compose.complete(session,good.composeRequestId(),claim.token(),bad),"AI_INVALID_RESPONSE");
		assertThat(windows.count()).isZero(); assertThat(sessionRows.findById(session).orElseThrow().getComposedThroughSequence()).isZero();
		compose.fail(session,good.composeRequestId(),claim.token());
		assertThat(jobs.findById(good.composeRequestId()).orElseThrow().getProcessingStatus()).isEqualTo("FAILED");
		complete(claimCompose());
	}
	@Test void transactionRollbackIncludesWindowsAnalysesOutboxCursorReceipt() {
		append(1);append(3);append(4);var claim = claimCompose();
		assertThatThrownBy(() -> tx.executeWithoutResult(status -> {complete(claim);throw new IllegalStateException("synthetic abort");})).isInstanceOf(IllegalStateException.class);
		assertThat(windows.count()).isZero(); assertThat(analyses.count()).isZero(); assertThat(tasks.count()).isZero();
		assertThat(sessionRows.findById(session).orElseThrow().getComposedThroughSequence()).isZero();
		assertThat(jobs.findById(claim.input().composeRequestId()).orElseThrow().getReceipt()).isNull();
		assertThat(complete(claim).windows()).hasSize(1);
	}
	@Test void expiredCompositionClaimRecoversAndFencesOldWorker() {
		append(1); var old = claimCompose();
		jdbc.update("update compose_request set lease_until=? where compose_request_id=?",java.sql.Timestamp.from(Instant.EPOCH),old.input().composeRequestId().toString());
		compose.recover(session,old.input().composeRequestId());
		var current = compose.claim(session,old.input().composeRequestId());
		code(() -> complete(old),"COMPOSE_CLAIM_LOST"); assertThat(current.token()).isNotEqualTo(old.token()); complete(current);
	}
	@Test void outboxDurablePendingDuplicateClaimCompletionAndLegacyIsolation() throws Exception {
		var window = window(); assertThat(outbox.pending()).containsExactly(window.analysisId());
		legacyExecutor.run(window.analysisId()); legacyRecovery.recoverStale(Instant.now().plusSeconds(86400));
		assertThat(analyses.findById(window.analysisId()).orElseThrow().getProcessingStatus()).isEqualTo(AnalysisStatus.PENDING);
		var claims = race(() -> Optional.ofNullable(outbox.claim(session,window.analysisId())), () -> Optional.ofNullable(outbox.claim(session,window.analysisId())));
		var claim = claims.stream().flatMap(Optional::stream).toList(); assertThat(claim).hasSize(1);
		outbox.complete(session,window.analysisId(),claim.getFirst().token(),result(window));
		outbox.complete(session,window.analysisId(),claim.getFirst().token(),result(window));
		assertThat(outbox.pending()).isEmpty(); assertThat(outbox.claim(session,window.analysisId())).isNull();
		var stored = analyses.findById(window.analysisId()).orElseThrow();
		assertThat(stored.getResult()).isNull(); assertThat(stored.getPNormal()).isNull(); assertThat(stored.getPageResults()).contains("DIRECT");
	}
	@Test void expiredOutboxFailsAndCannotBeReexecuted() {
		var window=window();var claim=outbox.claim(session,window.analysisId());
		jdbc.update("update analysis_outbox set lease_until=? where analysis_id=?",java.sql.Timestamp.from(Instant.EPOCH),window.analysisId().toString());
		outbox.recover(session,window.analysisId());
		code(() -> outbox.complete(session,window.analysisId(),claim.token(),result(window)),"ANALYSIS_CLAIM_LOST");
		assertThat(outbox.claim(session,window.analysisId())).isNull();
		assertThat(analyses.findById(window.analysisId()).orElseThrow().getErrorCode()).isEqualTo("ANALYSIS_INTERRUPTED");
	}
	@Test void stateHistoryReplayChangedInputAndStaleSnapshot() {
		var window=window();finish(window);var initial=state(window,"NORMAL");
		assertThat(states.save(session,window.windowId(),initial).state().getId().stateVersion()).isEqualTo(1);
		assertThat(states.save(session,window.windowId(),initial).created()).isFalse();
		UUID visit=initial.behaviorSnapshot().getLast().visitId();
		visits.updateBehavior(session,visit,new UpdateVisitBehaviorRequest(6000L,0,2L));
		var second=state(window,"NORMAL");
		assertThat(states.save(session,window.windowId(),second).state().getId().stateVersion()).isEqualTo(2);
		visits.updateBehavior(session,visit,new UpdateVisitBehaviorRequest(7000L,0,3L));var stale=state(window,"DRIFT");
		visits.updateBehavior(session,visit,new UpdateVisitBehaviorRequest(8000L,0,4L));
		code(() -> states.save(session,window.windowId(),stale),"STALE_STATE_INPUT");
		assertThat(history.count()).isEqualTo(2); assertThat(tasks.count()).isEqualTo(1);assertThat(windows.count()).isEqualTo(1);
	}
	@Test void concurrentStateVersionsAndDifferentWindows() throws Exception {
		var window=window();finish(window);var initial=state(window,"NORMAL");
		var saved=race(() -> states.save(session,window.windowId(),initial), () -> states.save(session,window.windowId(),initial));
		assertThat(saved).extracting(WindowStateHistoryService.Saved::created).containsExactlyInAnyOrder(true,false);
		UUID last=initial.behaviorSnapshot().getLast().visitId();visits.updateBehavior(session,last,new UpdateVisitBehaviorRequest(6000L,0,2L));
		var changed=state(window,"NORMAL");
		var next=race(() -> states.save(session,window.windowId(),changed), () -> states.save(session,window.windowId(),changed));
		assertThat(next).allSatisfy(s -> assertThat(s.state().getId().stateVersion()).isEqualTo(2));
		append(6); var second=complete(claimCompose()).windows().getFirst();finish(second);
		assertThat(states.save(session,second.windowId(),state(second,"DRIFT")).state().getId().stateVersion()).isEqualTo(1);
	}
	@Test void privacyTombstonePrecedesReplayAndBlocksPendingResults() {
		var window=window();var running=outbox.claim(session,window.analysisId());
		UUID visit=visitRows.findBySessionIdOrderBySequence(session).getFirst().getVisitId();append(6);var composing=claimCompose();
		var request=new Retraction.Request(UUID.randomUUID(),visit,"SENSITIVE_CONTENT",TIME);
		var receipt=privacy.quarantine(session,request);assertThat(receipt.status()).isEqualTo("QUARANTINED");
		assertThat(receipt.invalidatedWindowIds()).containsExactly(window.windowId());
		assertThat(privacy.quarantine(session,request)).isEqualTo(receipt);
		assertThat(sessionRows.findById(session).orElseThrow().getPrivacyRevision()).isEqualTo(1);
		code(() -> visits.save(session,request(visit,1,5000)),"PRIVACY_RETRACTED");
		code(() -> outbox.complete(session,window.analysisId(),running.token(),result(window)),"PRIVACY_RETRACTED");
		code(() -> complete(composing),"PRIVACY_RETRACTED");
		code(() -> states.save(session,window.windowId(),state(window,"NORMAL")),"PRIVACY_RETRACTED");
		assertThat(visitRows.findById(visit)).isPresent();assertThat(targets.findByIdRetractionId(request.retractionId())).extracting(t -> t.getId().targetType())
			.contains("PAGE_VISIT","ANALYSIS_PAYLOAD","WINDOW_STATE_HISTORY","COMPOSE_SNAPSHOT_RECEIPT","EXPORT_COPIES","TRAINED_ARTIFACTS","BACKUPS");
		privacy.recordFailure(session,targets.findByIdRetractionId(request.retractionId()).getFirst().getId(),"DELETE_NOT_IMPLEMENTED");
		assertThat(retractions.findById(request.retractionId()).orElseThrow().getProcessingStatus()).isEqualTo("QUARANTINED");
		code(() -> privacy.quarantine(session,new Retraction.Request(request.retractionId(),visit,"CONSENT_WITHDRAWN",TIME)),"RETRACTION_ID_CONFLICT");
	}
	@Test void retractBeforePostAndNoPublicRetractionEndpoint() throws Exception {
		UUID visit=UUID.randomUUID();privacy.quarantine(session,new Retraction.Request(UUID.randomUUID(),visit,"CONSENT_WITHDRAWN",TIME));
		assertThat(tombstones.existsById(visit)).isTrue();code(() -> visits.save(session,request(visit,1,5000)),"PRIVACY_RETRACTED");
		mvc.perform(post("/api/sessions/{id}/visit-retractions",session).contentType(MediaType.APPLICATION_JSON).content("{}"))
			.andExpect(status().isNotFound());
	}
	@ParameterizedTest @ValueSource(strings={"missing-extraction","failed-extraction","missing-query","string-sequence","extra-field","long-title","bad-timestamp"})
	void strictV2Json(String mutation) throws Exception {
		var body=mapper.valueToTree(request(UUID.randomUUID(),1,5000)).deepCopy();
		var node=(tools.jackson.databind.node.ObjectNode)body;
		switch(mutation) {
			case "missing-extraction" -> node.remove("extractionStatus"); case "failed-extraction" -> node.put("extractionStatus","EXTRACTION_FAILED");
			case "missing-query" -> node.remove("searchQuery"); case "string-sequence" -> node.put("sequence","1");
			case "extra-field" -> node.put("rawUrl","synthetic"); case "long-title" -> node.put("title","가".repeat(501));
			case "bad-timestamp" -> node.put("visitedAt","2026-11-10T00:00:00Z");
		}
		mvc.perform(post("/api/sessions/{id}/visits",session).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(node)))
			.andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
	}
	@Test void validV2ApiAck() throws Exception {
		var body=mapper.valueToTree(request(UUID.randomUUID(),1,5000));
		((tools.jackson.databind.node.ObjectNode)body).put("visitedAt","2026-11-10T00:00:00.000Z");
		mvc.perform(post("/api/sessions/{id}/visits",session).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
			.andExpect(status().isCreated()).andExpect(jsonPath("$.extractionStatus").value("SUCCESS"));
	}
	@Test void concurrentDistinctSnapshotsCannotInstallOlderInput() throws Exception {
		var window=window();finish(window);var initial=state(window,"NORMAL");
		states.save(session,window.windowId(),initial);
		UUID visit=initial.behaviorSnapshot().getLast().visitId();
		visits.updateBehavior(session,visit,new UpdateVisitBehaviorRequest(6000L,0,2L));var older=state(window,"NORMAL");
		visits.updateBehavior(session,visit,new UpdateVisitBehaviorRequest(7000L,0,3L));var newer=state(window,"DRIFT");
		var results=race(() -> {try {states.save(session,window.windowId(),older);return "UNEXPECTED";}catch(ConflictException e){return e.getCode();}},
			() -> "VERSION_"+states.save(session,window.windowId(),newer).state().getId().stateVersion());
		assertThat(results).containsExactlyInAnyOrder("STALE_STATE_INPUT","VERSION_2");
	}
	@Test void compositionUsesIdentitySnapshotDespiteBehaviorPatchAndConcurrentCompletion() throws Exception {
		UUID visit=append(1);append(3);append(4);var claim=claimCompose();
		visits.updateBehavior(session,visit,new UpdateVisitBehaviorRequest(6000L,0,2L));
		var receipts=race(() -> complete(claim), () -> complete(claim));
		assertThat(receipts.get(0)).isEqualTo(receipts.get(1));assertThat(windows.count()).isEqualTo(1);assertThat(tasks.count()).isEqualTo(1);
	}
	@Test void foreignMembersInvalidShapeAndFailedResultCannotCreateHistory() {
		var window=window();var running=outbox.claim(session,window.analysisId());var correct=result(window);
		var foreign=new V2AnalysisCompletion(2,correct.analysisId(),session,correct.windowId(),correct.inputFingerprint(),
			List.of(new V2AnalysisCompletion.Page(1,UUID.randomUUID(),"DIRECT",0.5,"합성 근거"),correct.pageResults().get(1),correct.pageResults().get(2)),correct.modelVersions(),TIME);
		code(() -> outbox.complete(session,window.analysisId(),running.token(),foreign),"AI_INVALID_RESPONSE");
		code(() -> states.save(session,window.windowId(),state(window,"NORMAL")),"ANALYSIS_NOT_COMPLETED");
		outbox.fail(session,window.analysisId(),running.token());
		assertThat(tasks.findById(window.analysisId()).orElseThrow().getProcessingStatus()).isEqualTo("FAILED");
	}
	@Test void legacyQueriesAndAlertsCannotExposeQuarantinedV2() throws Exception {
		UUID visit=append(1);privacy.quarantine(session,new Retraction.Request(UUID.randomUUID(),visit,"SENSITIVE_CONTENT",TIME));
		for(String suffix:List.of("","/visits","/analysis-status","/analyses","/alerts"))
			mvc.perform(get("/api/sessions/"+session+suffix)).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("PRIVACY_RETRACTED"));
	}
	@Test void stateFingerprintAndAnalysisOwnershipAreValidated() {
		var first=window();finish(first);var initial=state(first,"NORMAL");
		var wrongHash=new SaveWindowState(initial.analysisId(),initial.ruleVersion(),initial.finalState(),initial.behaviorSnapshot(),"a".repeat(64));
		code(() -> states.save(session,first.windowId(),wrongHash),"STATE_INPUT_MISMATCH");
		append(6);var second=complete(claimCompose()).windows().getFirst();finish(second);
		code(() -> states.save(session,second.windowId(),initial),"ANALYSIS_ID_CONFLICT");
		states.save(session,first.windowId(),initial);
		var conflicting=new SaveWindowState(initial.analysisId(),initial.ruleVersion(),"DRIFT",initial.behaviorSnapshot(),initial.inputFingerprint());
		code(() -> states.save(session,first.windowId(),conflicting),"STATE_INPUT_CONFLICT");
	}

	@Test void visitAndWatermarkRollbackTogether() {
		UUID id=UUID.randomUUID();
		assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
			visits.save(session,request(id,3,5000));throw new IllegalStateException("synthetic abort");
		})).isInstanceOf(IllegalStateException.class);
		assertThat(visitRows.existsById(id)).isFalse();
		assertThat(sessionRows.findById(session).orElseThrow().getLastAcceptedSequence()).isZero();
		assertThat(sessionRows.findById(session).orElseThrow().isCompositionDirty()).isFalse();
		assertThat(visits.save(session,request(id,3,5000)).created()).isTrue();
	}
	@Test void compositionRetryBudgetRemainsBoundedAndNeverAdvancesCursor() {
		append(1);UUID id=UUID.randomUUID();compose.prepareNext(session,id);
		for(int attempt=1;attempt<=3;attempt++) {
			var claim=compose.claim(session,id);assertThat(claim).isNotNull();
			jdbc.update("update compose_request set lease_until=? where compose_request_id=?",java.sql.Timestamp.from(Instant.EPOCH),id.toString());
			compose.recover(session,id);
		}
		assertThat(compose.claim(session,id)).isNull();assertThat(jobs.findById(id).orElseThrow().getAttempts()).isEqualTo(3);
		assertThat(jobs.findById(id).orElseThrow().getProcessingStatus()).isEqualTo("FAILED");
		assertThat(sessionRows.findById(session).orElseThrow().getComposedThroughSequence()).isZero();
	}

	@Test void retryableCompositionFailureKeepsIdentityAndFencesPreviousClaim() {
		append(1);append(3);append(4);var first=claimCompose();UUID id=first.input().composeRequestId();
		compose.retry(session,id,first.token(),"AI_TIMEOUT");var second=compose.claim(session,id);
		assertThat(second.input()).isEqualTo(first.input());
		code(() -> complete(first),"COMPOSE_CLAIM_LOST");
		assertThat(sessionRows.findById(session).orElseThrow().getComposedThroughSequence()).isZero();
		assertThat(complete(second).windows()).hasSize(1);
	}

}
