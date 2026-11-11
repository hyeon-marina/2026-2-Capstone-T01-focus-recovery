package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class TeamPolicyProposalTest {
    @Test void operationalPolicyPreservesPlanWithoutFabricatingInstitutionDecision() throws Exception {
        var mapper=JsonMapper.builder().build();var validator=new LocalCollectionPolicy(mapper);
        var root=Path.of("../docs/data-collection");byte[] bytes=Files.readAllBytes(root.resolve("TEAM_POLICY.json"));
        var n=mapper.readTree(bytes);
        var draft=mapper.readTree(Files.readAllBytes(root.resolve("local-policy.draft.json")));
        assertThat(n.path("plan").path("assignments")).isEqualTo(draft.path("plan").path("assignments"));
        assertThat(n.path("plan").path("revision").asInt()).isEqualTo(1);
        var goals=mapper.readTree(Files.readAllBytes(root.resolve("goals.candidates.json"))).path("goals");
        for(int i=0;i<20;i++) assertThat(n.path("plan").path("goals").get(i).path("description")).isEqualTo(goals.get(i).path("description"));
        var plan=mapper.treeToValue(n.path("plan"),CollectionPlanService.Plan.class);CollectionPlanService.validate(plan);
        assertThat(plan.assignments()).isEqualTo(CollectionPlanService.draft().assignments());
        assertThat(validator.checksum(plan)).isEqualTo(n.path("planChecksum").asText());
        for(var slot:List.of("A","B","C")) assertThat(plan.assignments().stream().filter(a->a.slotId().equals(slot)).count()).isEqualTo(slot.equals("A")?54:53);
        assertThat(n.path("status").asText()).isEqualTo("CONFIRMED");
        assertThat(n.path("institution").path("decision").asText()).isEqualTo("NOT_REQUIRED");
        for(String key:List.of("teamDecisionRef","retentionRef","privacyEvidenceRef","startAuthorizationRef"))assertThat(n.path(key).asText()).isEmpty();
        assertThat(validator.validate(n,Instant.now())).isEqualTo(plan);
        assertThat(LocalCollectionPolicy.institutionCleared(n)).isTrue();
        assertThat(Files.isRegularFile(Path.of("..").resolve(n.path("institution").path("evidenceRef").asText()))).isTrue();
        assertThat(plan.goals()).allMatch(g->g.status().equals("CONFIRMED"));
        var sites=new CollectionSitePolicy(new org.springframework.mock.env.MockEnvironment(),null,java.time.Clock.systemUTC(),mapper).validateLocalSites(n);
        assertThat(sites).hasSize(15);
        assertThat(sites.stream().map(CollectionSitePolicy.Site::origin)).doesNotContain("https://www.youtube.com","https://www.google.com","https://search.naver.com","https://blog.naver.com");
        assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))).isEqualTo(Files.readString(root.resolve("TEAM_POLICY.sha256")).split(" ")[0]);
    }
}
