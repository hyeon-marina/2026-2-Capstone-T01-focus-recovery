package com.focusrecovery.domain.privacy;

import static org.assertj.core.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.*;
import org.springframework.jdbc.core.JdbcTemplate;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.domain.privacy.repository.*;
import com.focusrecovery.domain.privacy.service.*;
import com.focusrecovery.domain.composition.dto.Composition;
import com.focusrecovery.global.util.CanonicalJson;
import tools.jackson.databind.json.JsonMapper;

@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
    "focus-recovery.v2.storage.enabled=true", "focus-recovery.v2.dispatch.enabled=true", "focus-recovery.v2.dispatch.interval=50ms",
    "focus-recovery.v2.retraction.interval=50ms", "focus-recovery.v2.storage.recovery-interval=1h",
    "focus-recovery.v2.retraction.service-secret=synthetic-service-only-secret-93-0123456789",
    "spring.datasource.url=jdbc:h2:mem:privacy93live;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"})
@org.springframework.context.annotation.Import(SyntheticRetractionConfiguration.class)
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named="FOCUS93_AI_URL", matches="http://127\\.0\\.0\\.1:8893")
class RetractionLiveHttpTest {
    @LocalServerPort int port;
    @Autowired WorkSessionService sessions;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper mapper;
    @Autowired CanonicalJson canonical;
    @Autowired RetractionTargetRepository targets;
    @Autowired PrivacyRetractionRepository jobs;
    @Autowired RetractionWorkService work;
    @DynamicPropertySource static void ai(DynamicPropertyRegistry p) { p.add("focus-recovery.ai.base-url", () -> System.getenv("FOCUS93_AI_URL")); }
    @Test void actualFeRuntimeToBeToAiWithDurableReplayAndSyntheticScrubbing() throws Exception {
        var session = sessions.create("Synthetic TypeScript transaction research", null, "2.0");
        jdbc.execute("CREATE TABLE IF NOT EXISTS synthetic_retraction_owner (session_id CHAR(36) PRIMARY KEY, subject VARCHAR(30) NOT NULL)");
        jdbc.update("INSERT INTO synthetic_retraction_owner VALUES (?, 'alice')", session.sessionId().toString());
        var process = new ProcessBuilder("npm", "exec", "--", "vitest", "run", "tests/v2-retraction-http.test.ts", "--reporter=dot")
            .directory(Path.of("../fe").toFile()).redirectErrorStream(true).redirectOutput(Path.of("/private/tmp/focus93-fe-live.log").toFile());
        process.environment().put("FOCUS93_BE_URL", "http://127.0.0.1:" + port);
        process.environment().put("FOCUS93_SESSION", mapper.writeValueAsString(session));
        var child = process.start();
        try { assertThat(child.waitFor(40, java.util.concurrent.TimeUnit.SECONDS)).isTrue(); assertThat(child.exitValue()).as(Files.readString(Path.of("/private/tmp/focus93-fe-live.log"))).isZero(); }
        finally { if (child.isAlive()) child.destroyForcibly(); }
        var evidence = mapper.readTree(Files.readString(Path.of("/private/tmp/focus93-http-evidence/fe.json")));
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline && jdbc.queryForObject("SELECT COUNT(*) FROM retraction_target t JOIN privacy_retraction r ON r.retraction_id=t.retraction_id WHERE r.session_id=? AND t.target_type IN ('BE_PAYLOADS','AI_CACHE_AND_MEMORY') AND t.processing_status<>'VERIFIED'", Integer.class, session.sessionId().toString()) != 0) Thread.sleep(20);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM page_visit WHERE session_id=? AND content IS NOT NULL", Integer.class, session.sessionId().toString())).isZero();
        for (var request : evidence.get("requests")) {
            UUID id = UUID.fromString(request.get("retractionId").stringValue());
            var rows = targets.findByIdRetractionId(id);
            assertThat(rows).filteredOn(t -> Set.of("BE_PAYLOADS", "AI_CACHE_AND_MEMORY").contains(t.getId().targetType())).allSatisfy(t -> assertThat(t.getProcessingStatus()).isEqualTo("VERIFIED"));
            assertThat(work.completion(id).status()).isEqualTo("QUARANTINED");
        }
        UUID visit = UUID.fromString(evidence.at("/requests/0/visitId").stringValue());
        UUID compose = UUID.randomUUID(); var visits = List.of(new Composition.Visit(visit, 1));
        String fingerprint = canonical.fingerprint(Map.of("apiContractVersion", 2, "composeRequestId", compose, "sessionId", session.sessionId(), "afterSequence", 0, "visits", visits));
        var input = new Composition.Input(2, compose, session.sessionId(), 0, fingerprint, visits);
        var denied = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build().send(HttpRequest.newBuilder(URI.create(System.getenv("FOCUS93_AI_URL") + "/api/ai/window-compositions"))
            .header("Content-Type", "application/json").header("Authorization", "Bearer synthetic-internal-service-token-95-0123456789").POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(input))).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(denied.statusCode()).isEqualTo(409); assertThat(mapper.readTree(denied.body()).path("code").asString()).isEqualTo("PRIVACY_RETRACTED");
        Files.writeString(Path.of("/private/tmp/focus93-http-evidence/be-targets.json"), mapper.writeValueAsString(jobs.findAll().stream().filter(j -> j.getSessionId().equals(session.sessionId())).map(j -> Map.of("retractionId", j.getRetractionId(), "status", j.getProcessingStatus(), "targets", targets.findByIdRetractionId(j.getRetractionId()).stream().map(t -> Map.of("type", t.getId().targetType(), "status", t.getProcessingStatus(), "evidence", Objects.toString(t.getEvidenceCode(), ""))).toList())).toList()));
    }
}
