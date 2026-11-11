package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class TeamPolicyProposalTest {
    @Test void proposalPreservesOriginalGoalsAssignmentsAndDoesNotFabricateApproval() throws Exception {
        var mapper=JsonMapper.builder().build();var validator=new LocalCollectionPolicy(mapper);
        var root=Path.of("../docs/data-collection");byte[] bytes=Files.readAllBytes(root.resolve("TEAM_POLICY.json"));
        var n=mapper.readTree(bytes);
        var draft=mapper.readTree(Files.readAllBytes(root.resolve("local-policy.draft.json")));
        assertThat(n.path("plan")).isEqualTo(draft.path("plan"));
        var goals=mapper.readTree(Files.readAllBytes(root.resolve("goals.candidates.json"))).path("goals");
        for(int i=0;i<20;i++) assertThat(n.path("plan").path("goals").get(i).path("description")).isEqualTo(goals.get(i).path("description"));
        var plan=mapper.treeToValue(n.path("plan"),CollectionPlanService.Plan.class);CollectionPlanService.validate(plan);
        assertThat(plan.assignments()).isEqualTo(CollectionPlanService.draft().assignments());
        assertThat(validator.checksum(plan)).isEqualTo(n.path("planChecksum").asText());
        for(var slot:List.of("A","B","C")) assertThat(plan.assignments().stream().filter(a->a.slotId().equals(slot)).count()).isEqualTo(slot.equals("A")?54:53);
        assertThat(n.path("status").asText()).isEqualTo("DRAFT");
        assertThat(n.path("institution").path("decision").asText()).isEqualTo("UNRESOLVED");
        for(String key:List.of("teamDecisionRef","retentionRef","privacyEvidenceRef","startAuthorizationRef","notBefore","expiresAt"))assertThat(n.path(key).asText()).isEmpty();
        assertThatThrownBy(()->validator.validate(n,Instant.now())).hasMessageContaining("LOCAL_POLICY_DRAFT");
        var sites=new CollectionSitePolicy(new org.springframework.mock.env.MockEnvironment(),null,java.time.Clock.systemUTC(),mapper).validateLocalSites(n);
        assertThat(sites).hasSize(20);
        assertThat(sites.stream().map(CollectionSitePolicy.Site::origin)).doesNotContain("https://www.youtube.com","https://www.google.com","https://search.naver.com","https://blog.naver.com");
        assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))).isEqualTo(Files.readString(root.resolve("TEAM_POLICY.sha256")).split(" ")[0]);
    }
}
