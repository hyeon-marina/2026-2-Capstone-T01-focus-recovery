package com.focusrecovery.domain.privacy;

import static org.assertj.core.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import com.focusrecovery.FocusRecoveryApplication;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.domain.privacy.service.*;
import com.focusrecovery.domain.privacy.repository.*;
import com.focusrecovery.domain.privacy.entity.*;
import com.focusrecovery.domain.privacy.dto.Retraction;
import tools.jackson.databind.json.JsonMapper;

/** Opt-in real FastAPI receiver + independently provisioned MySQL; no inference, fake ACK or production rows. */
@EnabledIfEnvironmentVariable(named="FOCUS_RETRACTION_AI_URL", matches="http://127\\.0\\.0\\.1:8899")
class RetractionReceiverRecoveryTest {
    static final String SECRET = "synthetic-service-only-secret-93-0123456789";
    ConfigurableApplicationContext open(boolean configured) {
        String url = System.getenv("FOCUS93_MYSQL_URL");
        assertThat(url).matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus93.*");
        var app = new SpringApplicationBuilder(FocusRecoveryApplication.class, SyntheticRetractionConfiguration.class)
            .profiles("test").web(WebApplicationType.NONE).run(
            "--spring.datasource.url=" + url, "--spring.datasource.username=root",
            "--spring.datasource.password=" + System.getenv("FOCUS93_MYSQL_PASSWORD"),
            "--focus-recovery.v2.storage.enabled=true", "--focus-recovery.v2.dispatch.enabled=false",
            "--focus-recovery.v2.retraction.interval=1h", "--focus-recovery.v2.storage.recovery-interval=1h",
            "--focus-recovery.v2.retraction.base-url=" + System.getenv("FOCUS_RETRACTION_AI_URL"),
            "--focus-recovery.v2.retraction.service-secret=" + (configured ? SECRET : ""),
            "--spring.main.banner-mode=off", "--logging.level.root=ERROR");
        com.focusrecovery.support.SyntheticIdentities.seed(app.getBean(JdbcTemplate.class));
        com.focusrecovery.support.SyntheticIdentities.bind();
        return app;
    }
    @Test void threeFailedRequestsRecoverWithSameIdsAfterAckLossAndBackendRestart() throws Exception {
        List<Retraction.Request> requests = new ArrayList<>();
        List<UUID> sessions = new ArrayList<>();
        List<String> fingerprints = new ArrayList<>();
        try (var app = open(false)) {
            var jdbc = app.getBean(JdbcTemplate.class);
            jdbc.execute("CREATE TABLE IF NOT EXISTS synthetic_retraction_owner (session_id CHAR(36) PRIMARY KEY, subject VARCHAR(30) NOT NULL)");
            for (int i = 0; i < 3; i++) {
                UUID session = app.getBean(WorkSessionService.class).create("합성 회수 전파 복구 검증 목표입니다", null, "2.0").sessionId();
                jdbc.update("INSERT INTO synthetic_retraction_owner VALUES (?, 'alice')", session.toString());
                var request = new Retraction.Request(UUID.randomUUID(), UUID.randomUUID(), "SENSITIVE_CONTENT", Instant.EPOCH);
                app.getBean(PrivacyRetractionService.class).accept(session, request);
                sessions.add(session); requests.add(request);
                fingerprints.add(app.getBean(PrivacyRetractionRepository.class).findById(request.retractionId()).orElseThrow().getInputFingerprint());
                var id = new RetractionTargetId(request.retractionId(), "AI_CACHE_AND_MEMORY", session.toString());
                app.getBean(RetractionDispatcher.class).run(id);
                var target = app.getBean(RetractionTargetRepository.class).findById(id).orElseThrow();
                assertThat(target.getProcessingStatus()).isEqualTo("FAILED");
                assertThat(target.getErrorCode()).isEqualTo("AI_RETRACTION_AUTH_NOT_CONFIGURED");
                assertThat(target.getAttempts()).isEqualTo(1);
            }
            // Receiver commits the first request but its ACK never reaches the BE worker.
            var request = requests.getFirst();
            var body = JsonMapper.builder().build().writeValueAsString(Map.of("retractionId", request.retractionId(), "sessionId", sessions.getFirst(), "visitId", request.visitId()));
            var response = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build().send(HttpRequest.newBuilder(URI.create(System.getenv("FOCUS_RETRACTION_AI_URL") + "/internal/v2/visit-retractions"))
                .header("Content-Type", "application/json").header("Authorization", "Bearer " + SECRET).POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).isEqualTo(200);
        }
        Thread.sleep(2100); // Real retry backoff; no operational timestamps or data changed.
        for (int restart = 0; restart < 2; restart++) {
            try (var app = open(true)) {
                for (int i = 0; i < 3; i++) {
                    var request = requests.get(i); UUID session = sessions.get(i);
                    var id = new RetractionTargetId(request.retractionId(), "AI_CACHE_AND_MEMORY", session.toString());
                    app.getBean(RetractionDispatcher.class).run(id);
                    var target = app.getBean(RetractionTargetRepository.class).findById(id).orElseThrow();
                    assertThat(target.getProcessingStatus()).isEqualTo("VERIFIED");
                    assertThat(target.getErrorCode()).isNull();
                    assertThat(target.getEvidenceCode()).isEqualTo("AI_DURABLE_QUARANTINE_ACK_ONLY");
                    assertThat(target.getAttempts()).isEqualTo(2);
                    var job = app.getBean(PrivacyRetractionRepository.class).findById(request.retractionId()).orElseThrow();
                    assertThat(job.getInputFingerprint()).isEqualTo(fingerprints.get(i));
                    assertThat(job.getAttempts()).isEqualTo(1); // Failure history retained.
                    assertThat(job.getProcessingStatus()).isEqualTo("QUARANTINED");
                    assertThat(app.getBean(VisitTombstoneRepository.class).existsById(request.visitId())).isTrue();
                    assertThat(app.getBean(RetractionWorkService.class).completion(request.retractionId()).missing()).contains("BACKUPS", "TRAINED_ARTIFACTS").doesNotContain("AI_CACHE_AND_MEMORY");
                    var jdbc = app.getBean(JdbcTemplate.class);
                    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM analysis_window WHERE session_id=?", Integer.class, session.toString())).isZero();
                    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM page_visit WHERE session_id=?", Integer.class, session.toString())).isZero();
                }
            }
        }
    }
}
