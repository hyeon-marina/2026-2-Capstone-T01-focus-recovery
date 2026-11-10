package com.focusrecovery.domain.integration;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import com.focusrecovery.domain.privacy.entity.*;
import com.focusrecovery.domain.privacy.repository.*;
import com.focusrecovery.domain.privacy.service.*;
import com.focusrecovery.domain.privacy.dto.Retraction;
import tools.jackson.databind.node.ObjectNode;

abstract class V2RetractionContract extends V2IntegrationContract {
    @Autowired RetractionWorkService retractionWork;
    @Autowired RetractionDispatcher retractionDispatcher;
    @Autowired PrivacyRetractionRepository retractionRows;
    @Autowired RetractionTargetRepository targetRows;
    @Autowired VisitTombstoneRepository tombstoneRows;
    static final String AUTH = "Bearer " + com.focusrecovery.support.SyntheticIdentities.TOKEN;
    @BeforeEach void owner() {
        jdbc.execute("CREATE TABLE IF NOT EXISTS synthetic_retraction_owner (session_id CHAR(36) PRIMARY KEY, subject VARCHAR(30) NOT NULL)");
        jdbc.update("INSERT INTO synthetic_retraction_owner VALUES (?, 'alice')", session.toString());
    }
    ObjectNode retractBody(UUID visit) {
        return mapper.createObjectNode().put("retractionId", UUID.randomUUID().toString()).put("visitId", visit.toString())
            .put("observedAt", "2026-11-10T00:00:00.000Z").put("reasonCode", "SENSITIVE_CONTENT");
    }
    String path() { return "/api/sessions/" + session + "/visit-retractions"; }
    String postBody(ObjectNode body, int status) throws Exception {
        return mvc.perform(post(path()).header("Authorization", AUTH).contentType(MediaType.APPLICATION_JSON).content(body.toString()))
            .andExpect(status().is(status)).andReturn().getResponse().getContentAsString();
    }
    @Test void authenticatedApiMissingVisitReplayAndConflict() throws Exception {
        UUID id = UUID.randomUUID(); var body = retractBody(id);
        var first = mapper.readTree(postBody(body, 202));
        assertThat(first.path("status").asString()).isEqualTo("QUARANTINED");
        assertThat(first.size()).isEqualTo(4); assertThat(first.path("invalidatedWindowIds").size()).isZero();
        assertThat(postBody(body, 200)).isEqualTo(first.toString());
        assertThat(tombstoneRows.existsById(id)).isTrue();
        assertThat(sessionRows.findById(session).orElseThrow().getPrivacyRevision()).isEqualTo(1);
        code(() -> visits.save(session, request(id, 1, 5000)), "PRIVACY_RETRACTED");
        body.put("observedAt", "2026-11-10T00:00:00.001Z"); postBody(body, 409);
    }
    @ParameterizedTest @ValueSource(strings={"uuid", "variant", "upper", "time", "offset", "precision", "calendar", "reason", "extra", "null", "missing"})
    void malformedWireRejected(String mutation) throws Exception {
        var body = retractBody(UUID.randomUUID());
        switch (mutation) {
            case "uuid" -> body.put("visitId", "1-1-1-1-1");
            case "variant" -> body.put("retractionId", "00000000-0000-4000-0000-000000000001");
            case "upper" -> body.put("visitId", "AAAAAAAA-0000-4000-8000-000000000001");
            case "time" -> body.put("observedAt", "2026-11-10T00:00:00.000Z\n");
            case "offset" -> body.put("observedAt", "2026-11-10T09:00:00.000+09:00");
            case "precision" -> body.put("observedAt", "2026-11-10T00:00:00Z");
            case "calendar" -> body.put("observedAt", "2026-02-30T00:00:00.000Z");
            case "reason" -> body.put("reasonCode", "PRIVATE_ORIGINAL_DO_NOT_ECHO");
            case "extra" -> body.put("content", "PRIVATE_ORIGINAL_DO_NOT_ECHO");
            case "null" -> body.putNull("visitId");
            case "missing" -> body.remove("observedAt");
        }
        assertThat(postBody(body, 400)).doesNotContain("PRIVATE_ORIGINAL_DO_NOT_ECHO");
        assertThat(sessionRows.findById(session).orElseThrow().isQuarantined()).isFalse();
    }
    @Test void authenticationAndOwnershipCannotBeReplacedByIds() throws Exception {
        var body = retractBody(UUID.randomUUID());
        mvc.perform(post(path()).header("Authorization", "").contentType(MediaType.APPLICATION_JSON).content(body.toString())).andExpect(status().isUnauthorized());
        String bob = "Bearer " + com.focusrecovery.support.SyntheticIdentities.BOB_TOKEN;
        mvc.perform(post(path()).header("Authorization", bob).contentType(MediaType.APPLICATION_JSON).content(body.toString())).andExpect(status().isNotFound());
        assertThat(tombstoneRows.existsById(UUID.fromString(body.path("visitId").asString()))).isFalse();
    }
    @Test void otherSessionVisitRejectedWithoutQuarantiningEither() throws Exception {
        UUID other = sessions.create("다른 합성 세션 공개 문서 비교", null, "2.0").sessionId();
        UUID visit = UUID.randomUUID(); visits.save(other, request(visit, 1, 5000));
        postBody(retractBody(visit), 404);
        assertThat(sessionRows.findById(session).orElseThrow().isQuarantined()).isFalse();
        assertThat(sessionRows.findById(other).orElseThrow().isQuarantined()).isFalse();
    }
    @Test void endedSessionRemainsRetractableAndPayloadScrubbingPreservesFkAndShownFacts() throws Exception {
        var window = oneWindow(); patch(window.getEndVisitId(), 300000, 2); analyzeNow(window);
        var alert = snapshotStatus().alert(); assertThat(alert).isNotNull();
        Instant shown = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        display.markShown(session, alert.alertId(), shown);
        sessions.end(session, List.of());
        var body = retractBody(window.getVisitIds().getFirst()); var receipt = mapper.readTree(postBody(body, 202));
        assertThat(receipt.path("invalidatedWindowIds").size()).isEqualTo(1);
        UUID job = UUID.fromString(body.path("retractionId").asString());
        var target = new RetractionTargetId(job, "BE_PAYLOADS", session.toString());
        retractionDispatcher.run(target); retractionDispatcher.run(target);
        assertThat(targetRows.findById(target).orElseThrow().getProcessingStatus()).isEqualTo("VERIFIED");
        assertThat(jdbc.queryForObject("SELECT content FROM page_visit WHERE visit_id=?", String.class, window.getVisitIds().getFirst().toString())).isNull();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM analysis_result WHERE window_id=? AND input_snapshot IS NULL AND response_snapshot IS NULL AND page_results IS NULL", Integer.class, window.getWindowId().toString())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT message FROM notification WHERE alert_id=?", String.class, alert.alertId().toString())).isEmpty();
        assertThat(notifications.findById(alert.alertId()).orElseThrow().getShownAt()).isEqualTo(shown);
        assertThat(snapshotStatus().currentDecision().decisionStatus()).isEqualTo("INVALIDATED");
        assertThat(snapshotStatus().lastSuccessfulState()).isNull(); assertThat(snapshotStatus().alert()).isNull();
        assertThat(retractionWork.completion(job).status()).isEqualTo("QUARANTINED");
        assertThat(retractionWork.completion(job).missing()).contains("BACKUPS", "EXPORT_COPIES", "TRAINED_ARTIFACTS", "CLIENT_LOCAL_COPIES");
        postBody(body, 200);
    }
    @Test void concurrentApiRequestsCreateOneJobAndTombstone() throws Exception {
        var body = retractBody(UUID.randomUUID()); var pool = Executors.newFixedThreadPool(2);
        try {
            var tasks = List.<Callable<Integer>>of(() -> mvc.perform(post(path()).header("Authorization", AUTH).contentType(MediaType.APPLICATION_JSON).content(body.toString())).andReturn().getResponse().getStatus(),
                () -> mvc.perform(post(path()).header("Authorization", AUTH).contentType(MediaType.APPLICATION_JSON).content(body.toString())).andReturn().getResponse().getStatus());
            var results = pool.invokeAll(tasks);
            assertThat(List.of(results.get(0).get(), results.get(1).get())).containsExactlyInAnyOrder(202, 200);
        } finally { pool.shutdownNow(); }
        assertThat(sessionRows.findById(session).orElseThrow().getPrivacyRevision()).isEqualTo(1);
    }
    @Test void expiredClaimIsRecoveredAndLateCompletionCannotOverwriteNewClaim() throws Exception {
        var body = retractBody(UUID.randomUUID()); postBody(body, 202);
        UUID job = UUID.fromString(body.path("retractionId").asString());
        var id = new RetractionTargetId(job, "AI_CACHE_AND_MEMORY", session.toString());
        clock.freeze(); var old = retractionWork.claim(id); assertThat(old).isNotNull();
        assertThat(retractionWork.claim(id)).isNull(); clock.advance(Duration.ofSeconds(31));
        var next = retractionWork.claim(id); assertThat(next.token()).isNotEqualTo(old.token());
        retractionWork.finishAi(old, true); assertThat(targetRows.findById(id).orElseThrow().getProcessingStatus()).isEqualTo("RUNNING");
        retractionWork.finishAi(next, false); assertThat(targetRows.findById(id).orElseThrow().getErrorCode()).isEqualTo("PROPAGATION_UNCONFIRMED");
        assertThat(retractionWork.claim(id)).isNull(); clock.advance(Duration.ofMinutes(6));
        assertThat(retractionWork.claim(id)).isNotNull();
    }
    @Test void unsupportedExternalEvidenceTargetCannotBeClaimedAsDeletionWork() throws Exception {
        var body = retractBody(UUID.randomUUID()); postBody(body, 202);
        var id = new RetractionTargetId(UUID.fromString(body.path("retractionId").asString()), "BACKUPS", session.toString());
        privacy.recordFailure(session, id, "EXTERNAL_EVIDENCE_MISSING");
        assertThat(retractionWork.claim(id)).isNull();
        assertThat(targetRows.findById(id).orElseThrow().getProcessingStatus()).isEqualTo("BLOCKED");
        assertThat(retractionWork.completion(id.retractionId()).missing()).contains("BACKUPS");
    }
    @Test void transactionFailureRollsBackScrubAndEvidenceButNotExistingQuarantine() throws Exception {
        UUID visit = append(1); var body = retractBody(visit); postBody(body, 202);
        var id = new RetractionTargetId(UUID.fromString(body.path("retractionId").asString()), "BE_PAYLOADS", session.toString());
        var claim = retractionWork.claim(id);
        assertThatThrownBy(() -> tx.execute(status -> { retractionWork.scrub(claim); throw new IllegalStateException("synthetic rollback"); })).isInstanceOf(IllegalStateException.class);
        assertThat(jdbc.queryForObject("SELECT content FROM page_visit WHERE visit_id=?", String.class, visit.toString())).contains("합성");
        assertThat(targetRows.findById(id).orElseThrow().getProcessingStatus()).isEqualTo("RUNNING");
        assertThat(sessionRows.findById(session).orElseThrow().isQuarantined()).isTrue();
    }
}
