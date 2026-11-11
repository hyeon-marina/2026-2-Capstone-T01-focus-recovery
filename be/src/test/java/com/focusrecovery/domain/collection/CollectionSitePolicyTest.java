package com.focusrecovery.domain.collection;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import com.focusrecovery.global.config.V2StorageGate;

class CollectionSitePolicyTest {
    @TempDir Path dir;
    MockEnvironment env;JdbcTemplate jdbc;JsonMapper mapper=JsonMapper.builder().build();
    CollectionSitePolicy policy;Map<String,Object> artifact;
    void setup(String profile) throws Exception {
        env=new MockEnvironment();env.setActiveProfiles(profile);env.setProperty("focus-recovery.v2.storage.enabled","true");
        env.setProperty("focus-recovery.collection.site-policy-file",dir.resolve("policy.json").toString());
        jdbc=mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(),eq(Integer.class),any(),any(),any(),any())).thenReturn(1);
        policy=new CollectionSitePolicy(env,jdbc,Clock.fixed(Instant.parse("2026-11-11T00:00:00Z"),ZoneOffset.UTC),mapper);
        artifact=new HashMap<>();
        for(String k:List.of("approvalRef","contractApprovalRef","retentionRef","institutionRef","modelEvidenceRef","privacyEvidenceRef","startAuthorizationRef"))artifact.put(k,"synthetic-evidence-only");
        artifact.putAll(Map.of("status",profile.equals("test")?"SYNTHETIC":"APPROVED","buildId","synthetic-build","policyId","test-policy","policyVersion","1","notBefore","2026-11-10T00:00:00Z","expiresAt","2026-11-12T00:00:00Z","sites",List.of(Map.of("origin","https://docs.example.org","pathPrefix","/guide"))));save();
    }
    void save() throws Exception { Files.writeString(dir.resolve("policy.json"),mapper.writeValueAsString(artifact)); }
    @Test void flagAloneDoesNotEnableProduction() throws Exception {
        setup("real-collection");Files.delete(dir.resolve("policy.json"));assertThat(new V2StorageGate(env,null,policy).enabled()).isFalse();
    }
    @Test void requiresIndependentDatabaseRelease() throws Exception {
        setup("real-collection");assertThat(policy.current()).isNotNull();
        when(jdbc.queryForObject(anyString(),eq(Integer.class),any(),any(),any(),any())).thenReturn(0);
        assertThat(policy.current()).isNull();
    }
    @Test void checksExpiryEvidenceStatusOriginsAndProfile() throws Exception {
        setup("real-collection");
        for(var change:List.of(Map.entry("status",(Object)"DRAFT"),Map.entry("expiresAt",(Object)"2020-01-01T00:00:00Z"),Map.entry("privacyEvidenceRef",(Object)""),Map.entry("sites",(Object)List.of(Map.of("origin","https://*.example.org","pathPrefix","/"))),Map.entry("sites",(Object)List.of(Map.of("origin","http://docs.example.org","pathPrefix","/"))))) {
            Object previous=artifact.put(change.getKey(),change.getValue());save();assertThat(policy.current()).isNull();artifact.put(change.getKey(),previous);
        }
        save();env.setActiveProfiles("real-collection","test");assertThat(policy.current()).isNull();
    }
    @Test void sessionScopeAndNormalizedSiteAreRequired() throws Exception {
        setup("real-collection");
        when(jdbc.queryForObject(anyString(),eq(Integer.class),any(),any(),any())).thenReturn(0);
        var session=com.focusrecovery.domain.session.entity.WorkSession.start("synthetic goal",null,"2.0");
        assertThatThrownBy(()->policy.check(session)).hasFieldOrPropertyWithValue("code","COLLECTION_POLICY_BLOCKED");
        when(jdbc.queryForObject(anyString(),eq(Integer.class),any(),any(),any())).thenReturn(1);
        policy.checkVisit(session,"https://docs.example.org/guide/public");
        for(String url:List.of("https://docs.example.org.evil/guide/public","https://docs.example.org/guides/public","http://docs.example.org/guide/public","https://docs.example.org/guide/account","https://docs.example.org/guide/%61ccount","https://docs.example.org/guide/public?token=private"))
            assertThatThrownBy(()->policy.checkVisit(session,url)).hasFieldOrPropertyWithValue("code","COLLECTION_POLICY_BLOCKED");
    }
    @Test void deploymentReadinessDoesNotRequireAiDispatch() throws Exception {
        setup("individual-local");env.setProperty("focus-recovery.v2.dispatch.enabled","false");
        var consent=new com.focusrecovery.domain.consent.ConsentService(jdbc,Clock.systemUTC(),env,policy) {
            @Override public Policy policy(){return new Policy("test-policy","1","SESSION_COLLECTION","synthetic test","synthetic test","synthetic test","synthetic-retention","synthetic-approval","APPROVED",Instant.EPOCH);}
        };
        assertThat(consent.deploymentConfigured()).isTrue();
        artifact.put("status","DRAFT");save();assertThat(consent.deploymentConfigured()).isFalse();
    }
    @Test void individualLocalUsesTheSameArtifactReleaseAndExactProfileBoundary() throws Exception {
        setup("individual-local");assertThat(policy.current()).isNotNull();
        when(jdbc.queryForObject(anyString(),eq(Integer.class),any(),any(),any(),any())).thenReturn(0);
        assertThat(new V2StorageGate(env,null,policy).enabled()).isFalse();
        env.setActiveProfiles("individual-local","test");assertThat(policy.realProfile()).isFalse();
    }
    @Test void syntheticReleaseNeverEnablesRealProfile() throws Exception {
        setup("test");assertThat(policy.current()).isNotNull();env.setActiveProfiles("real-collection");assertThat(policy.current()).isNull();
    }
}
