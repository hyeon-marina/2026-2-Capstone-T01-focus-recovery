package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;
import tools.jackson.databind.json.JsonMapper;

class LocalCollectionPolicyTest {
    JsonMapper mapper=JsonMapper.builder().build();LocalCollectionPolicy validator=new LocalCollectionPolicy(mapper);
    Instant now=Instant.parse("2026-11-11T00:00:00Z");
    Map<String,Object> fixture() {
        var draft=CollectionPlanService.draft();
        var plan=new CollectionPlanService.Plan(1,draft.goals().stream().map(g->new CollectionPlanService.Goal(g.goalId(),"SYNTHETIC TEST goal "+g.goalId(),"CONFIRMED","synthetic-test-only")).toList(),draft.assignments(),draft.slots());
        var n=new HashMap<String,Object>();
        n.put("plan",plan);n.put("planChecksum",validator.checksum(plan));
        n.putAll(Map.of("schemaVersion","focus-local-policy/1","mode","RAW_ONLY","status","CONFIRMED","notBefore",now.minusSeconds(1).toString(),"expiresAt",now.plusSeconds(3600).toString()));
        for(var key:List.of("policyId","policyVersion","buildId","teamDecisionRef","retentionRef","privacyEvidenceRef","startAuthorizationRef","purpose","collectionItems","useScope","retentionPolicy","sensitivePageExclusions","textPrivacyPolicy","changePolicy","collectionScope"))n.put(key,"synthetic-test-only");
        n.put("institution",Map.of("decision","NOT_REQUIRED","evidenceRef","synthetic-test-only"));
        return n;
    }
    @Test void rawOnlyDoesNotRequireModelEvidenceAndKeepsDistribution() {
        var p=validator.validate(mapper.valueToTree(fixture()),now);
        assertThat(p.assignments()).hasSize(160);
        for(var slot:List.of("A","B","C"))assertThat(p.assignments().stream().filter(a->a.slotId().equals(slot)).count()).isEqualTo(slot.equals("A")?54:53);
        assertThat(fixture()).doesNotContainKey("modelEvidenceRef");
    }
    @Test void rejectsDraftMissingEvidenceExpiryAiAndTampering() {
        for(var change:List.of(Map.entry("status","DRAFT"),Map.entry("mode","AI_ACTIVE"),Map.entry("teamDecisionRef",""),Map.entry("retentionPolicy",""),Map.entry("planChecksum","0".repeat(64)),Map.entry("expiresAt",now.toString()))) {
            var n=fixture();n.put(change.getKey(),change.getValue());assertThatThrownBy(()->validator.validate(mapper.valueToTree(n),now)).isInstanceOf(RuntimeException.class);
        }
        var n=fixture();n.put("institution",Map.of("decision","UNRESOLVED","evidenceRef",""));assertThatThrownBy(()->validator.validate(mapper.valueToTree(n),now)).hasMessageContaining("INSTITUTION");
    }
    @Test void rejectsHttpWildcardAndEmptySites() {
        var sites=new CollectionSitePolicy(new MockEnvironment(),null,Clock.systemUTC(),mapper);
        for(var origin:List.of("http://127.0.0.1:8911","https://*.example.org","https://user@example.org","https://example.org/","https://bank.example.org","https://accounts.example.org"))
            assertThatThrownBy(()->sites.validateLocalSites(mapper.valueToTree(Map.of("sites",List.of(Map.of("origin",origin,"pathPrefix","/public")))))).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(()->sites.validateLocalSites(mapper.valueToTree(Map.of("sites",List.of())))).isInstanceOf(RuntimeException.class);
        assertThat(sites.validateLocalSites(mapper.valueToTree(Map.of("sites",List.of(Map.of("origin","https://example.org","pathPrefix","/public")))))).hasSize(1);
    }
    @Test void setupCannotRunInWebOrNonLocalDatabase() {
        var env=new MockEnvironment();env.setActiveProfiles("individual-local");env.setProperty("spring.main.web-application-type","servlet");
        var setup=new LocalCollectionSetup(null,org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class),env,mapper,validator,null,null);
        assertThatThrownBy(()->setup.run(null)).hasMessageContaining("offline");
    }
    @TempDir Path dir;
    @Test void rejectsSymlinkOrSharedOwnerFile() throws Exception {
        Path file=dir.resolve("key");Files.writeString(file,"synthetic");
        if(Files.getFileStore(file).supportsFileAttributeView("posix")) {
            Files.setPosixFilePermissions(file,java.nio.file.attribute.PosixFilePermissions.fromString("rw-r--r--"));
            assertThatThrownBy(()->LocalCollectionSetup.owned(file)).hasMessageContaining("Owner-only");
            Files.setPosixFilePermissions(file,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));LocalCollectionSetup.owned(file);
            Path link=dir.resolve("link");Files.createSymbolicLink(link,file);assertThatThrownBy(()->LocalCollectionSetup.owned(link)).hasMessageContaining("regular");
        }
    }
}
