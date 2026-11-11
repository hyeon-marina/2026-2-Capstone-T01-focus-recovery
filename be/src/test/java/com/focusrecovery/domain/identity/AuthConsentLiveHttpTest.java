package com.focusrecovery.domain.identity;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import com.focusrecovery.domain.privacy.service.RetractionExecutionPolicy;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "spring.datasource.url=jdbc:h2:mem:auth95live;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "focus-recovery.v2.storage.enabled=true","focus-recovery.v2.dispatch.enabled=true","focus-recovery.v2.dispatch.interval=50ms",
    "focus-recovery.v2.withdrawal.interval=50ms","focus-recovery.v2.retraction.interval=50ms","focus-recovery.v2.storage.recovery-interval=1h",
    "focus-recovery.v2.retraction.service-secret=synthetic-service-only-secret-93-0123456789"})
@ActiveProfiles("test") @Import(AuthConsentLiveHttpTest.SyntheticExecution.class)
@EnabledIfEnvironmentVariable(named="FOCUS95_AI_URL",matches="http://127\\.0\\.0\\.1:8895")
class AuthConsentLiveHttpTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @DynamicPropertySource static void ai(DynamicPropertyRegistry p) { p.add("focus-recovery.ai.base-url",()->System.getenv("FOCUS95_AI_URL")); }
    @TestConfiguration static class SyntheticExecution {
        @Bean @Primary RetractionExecutionPolicy syntheticPolicy(JdbcTemplate jdbc) {
            return new RetractionExecutionPolicy(null,null) {
                @Override public boolean permitsSyntheticExecution(UUID session) {
                    return jdbc.queryForObject("SELECT COUNT(*) FROM work_session s JOIN consent_record c ON c.consent_id=s.consent_id JOIN consent_policy p ON p.policy_id=c.policy_id AND p.policy_version=c.policy_version WHERE s.session_id=? AND p.status='SYNTHETIC'",Integer.class,session.toString())==1;
                }
            };
        }
    }
    @Test void authenticatedFeRuntimeToRealSpringAndFastApiThenParticipantWithdrawal() throws Exception {
        var credential=provision();UUID owner=credential.owner();String token=credential.token();
        var builder=new ProcessBuilder("npm","exec","--","vitest","run","tests/v2-auth-http.test.ts","--reporter=dot")
            .directory(Path.of("../fe").toFile()).redirectErrorStream(true).redirectOutput(Path.of("/private/tmp/focus95-fe-live.log").toFile());
        builder.environment().put("FOCUS95_BE_URL","http://127.0.0.1:"+port);builder.environment().put("FOCUS95_TOKEN",token);
        var child=builder.start();
        try { assertThat(child.waitFor(90,java.util.concurrent.TimeUnit.SECONDS)).isTrue();assertThat(child.exitValue()).as(Files.readString(Path.of("/private/tmp/focus95-fe-live.log"))).isZero(); }
        finally { if(child.isAlive())child.destroyForcibly(); }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM consent_withdrawal WHERE participant_id=?",Integer.class,owner.toString())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM work_session WHERE owner_participant_id=? AND privacy_status<>'QUARANTINED'",Integer.class,owner.toString())).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM page_visit v JOIN work_session s ON s.session_id=v.session_id WHERE s.owner_participant_id=? AND v.content IS NOT NULL",Integer.class,owner.toString())).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM retraction_target t JOIN privacy_retraction r ON r.retraction_id=t.retraction_id JOIN work_session s ON s.session_id=r.session_id WHERE s.owner_participant_id=? AND t.target_type='AI_CACHE_AND_MEMORY' AND t.processing_status='VERIFIED'",Integer.class,owner.toString())).isGreaterThanOrEqualTo(3);
    }
    record Credential(UUID owner,String token) {}
    Credential provision() {
        UUID owner=UUID.randomUUID();byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",owner.toString(),AuthenticationService.digest(UUID.randomUUID().toString()),Timestamp.from(Instant.now()));
        jdbc.update("INSERT INTO access_credential(token_hash,participant_id,expires_at) VALUES(?,?,?)",AuthenticationService.digest(token),owner.toString(),Timestamp.from(Instant.now().plusSeconds(1800)));
        if(jdbc.queryForObject("SELECT COUNT(*) FROM consent_policy WHERE policy_id='SYNTHETIC-HTTP-95'",Integer.class)==0) jdbc.update("INSERT INTO consent_policy VALUES('SYNTHETIC-HTTP-95','1','SESSION_COLLECTION','Synthetic HTTP integration only','Closed public catalog fixtures and behavior','No participant data',NULL,NULL,'SYNTHETIC',?)",Timestamp.from(Instant.EPOCH));
        return new Credential(owner,token);
    }
    @Test @EnabledIfEnvironmentVariable(named="CHROMIUM_PATH",matches=".+")
    void actualChromeExtensionToSpringAndFastApiUsesSameAuthenticationConsentAndWithdrawal() throws Exception {
        var credential=provision();
        var builder=new ProcessBuilder("npm","run","test:v2:browser").directory(Path.of("../fe").toFile())
            .redirectErrorStream(true).redirectOutput(Path.of("/private/tmp/focus95-chrome-http.log").toFile());
        builder.environment().put("FE91_REAL_BE_URL","http://127.0.0.1:"+port);
        builder.environment().put("FE95_SYNTHETIC_TOKEN",credential.token());
        builder.environment().put("FE91_EVIDENCE","/private/tmp/focus95-chrome-http-evidence");
        var child=builder.start();
        try {assertThat(child.waitFor(150,java.util.concurrent.TimeUnit.SECONDS)).isTrue();assertThat(child.exitValue()).as(Files.readString(Path.of("/private/tmp/focus95-chrome-http.log"))).isZero();}
        finally {if(child.isAlive())child.destroyForcibly();}
        long deadline=System.nanoTime()+Duration.ofSeconds(15).toNanos();
        while(System.nanoTime()<deadline && jdbc.queryForObject("SELECT COUNT(*) FROM retraction_target t JOIN privacy_retraction r ON r.retraction_id=t.retraction_id JOIN work_session s ON s.session_id=r.session_id WHERE s.owner_participant_id=? AND t.target_type IN ('AI_CACHE_AND_MEMORY','BE_PAYLOADS') AND t.processing_status<>'VERIFIED'",Integer.class,credential.owner().toString())!=0)Thread.sleep(20);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM consent_withdrawal WHERE participant_id=?",Integer.class,credential.owner().toString())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM page_visit v JOIN work_session s ON s.session_id=v.session_id WHERE s.owner_participant_id=? AND v.content IS NOT NULL",Integer.class,credential.owner().toString())).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM retraction_target t JOIN privacy_retraction r ON r.retraction_id=t.retraction_id JOIN work_session s ON s.session_id=r.session_id WHERE s.owner_participant_id=? AND t.target_type='AI_CACHE_AND_MEMORY' AND t.processing_status='VERIFIED'",Integer.class,credential.owner().toString())).isGreaterThanOrEqualTo(5);
    }

}
