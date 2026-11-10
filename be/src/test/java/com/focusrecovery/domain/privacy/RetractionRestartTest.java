package com.focusrecovery.domain.privacy;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import com.focusrecovery.FocusRecoveryApplication;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.domain.visit.service.PageVisitService;
import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;
import com.focusrecovery.domain.privacy.service.*;
import com.focusrecovery.domain.privacy.repository.*;
import com.focusrecovery.domain.privacy.entity.*;
import com.focusrecovery.domain.privacy.dto.Retraction;

class RetractionRestartTest {
    @TempDir Path directory;
    ConfigurableApplicationContext open() {
        return new SpringApplicationBuilder(FocusRecoveryApplication.class, SyntheticRetractionConfiguration.class)
            .profiles("test").web(WebApplicationType.NONE).run(
            "--spring.datasource.url=jdbc:h2:file:" + directory.resolve("privacy93") + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE",
            "--focus-recovery.v2.storage.enabled=true", "--focus-recovery.v2.retraction.interval=1h", "--focus-recovery.v2.storage.recovery-interval=1h",
            "--spring.main.banner-mode=off", "--logging.level.root=ERROR");
    }
    @Test void restartRecoversClaimAndUnconfirmedDeliveryAndKeepsTombstone() {
        UUID session, visit = UUID.randomUUID(), job = UUID.randomUUID();
        var request = new Retraction.Request(job, visit, "SENSITIVE_CONTENT", Instant.EPOCH);
        try (var app = open()) {
            session = app.getBean(WorkSessionService.class).create("합성 회수 재시작 목표입니다", null, "2.0").sessionId();
            var jdbc = app.getBean(JdbcTemplate.class);
            jdbc.execute("CREATE TABLE synthetic_retraction_owner (session_id CHAR(36) PRIMARY KEY, subject VARCHAR(30) NOT NULL)");
            jdbc.update("INSERT INTO synthetic_retraction_owner VALUES (?, 'alice')", session.toString());
            app.getBean(PageVisitService.class).save(session, new CreatePageVisitRequest(visit.toString(), 1, "synthetic-tab", "https://example.org/docs", "example.org", "합성 문서",
                "합성 회수 재시작 테스트를 위한 공개 예제 본문입니다. ".repeat(4), null, false, Instant.EPOCH, 5000L, 0, 1L, "SUCCESS"));
            app.getBean(PrivacyRetractionService.class).accept(session, request);
            app.getBean(RetractionWorkService.class).claim(new RetractionTargetId(job, "BE_PAYLOADS", session.toString()));
            jdbc.update("UPDATE retraction_target SET lease_until=? WHERE retraction_id=? AND target_type='BE_PAYLOADS'", java.sql.Timestamp.from(Instant.EPOCH), job.toString());
        }
        try (var app = open()) {
            var replay = app.getBean(PrivacyRetractionService.class).accept(session, request);
            assertThat(replay.created()).isFalse(); assertThat(replay.receipt().status()).isEqualTo("QUARANTINED");
            assertThat(app.getBean(VisitTombstoneRepository.class).existsById(visit)).isTrue();
            app.getBean(RetractionDispatcher.class).dispatch();
            var target = app.getBean(RetractionTargetRepository.class).findById(new RetractionTargetId(job, "BE_PAYLOADS", session.toString())).orElseThrow();
            assertThat(target.getProcessingStatus()).isEqualTo("VERIFIED"); assertThat(target.getAttempts()).isEqualTo(2);
            assertThat(app.getBean(JdbcTemplate.class).queryForObject("SELECT content FROM page_visit WHERE visit_id=?", String.class, visit.toString())).isNull();
            assertThat(app.getBean(RetractionTargetRepository.class).findById(new RetractionTargetId(job, "AI_CACHE_AND_MEMORY", session.toString())).orElseThrow().getProcessingStatus()).isEqualTo("FAILED");
        }
        try (var app = open()) {
            assertThat(app.getBean(RetractionWorkService.class).completion(job).status()).isEqualTo("QUARANTINED");
            assertThat(app.getBean(VisitTombstoneRepository.class).existsById(visit)).isTrue();
        }
    }
}
