package com.focusrecovery.domain.collection;

import java.time.*;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Team decisions are supplied, never synthesized by setup. RAW_ONLY has no model evidence. */
@Component
public class LocalCollectionPolicy {
    private final JsonMapper mapper;
    public LocalCollectionPolicy(JsonMapper mapper) { this.mapper=mapper; }
    public CollectionPlanService.Plan validate(JsonNode n, Instant now) {
        if (!n.path("schemaVersion").asText().equals("focus-local-policy/1") || !n.path("mode").asText().equals("RAW_ONLY")) fail("LOCAL_POLICY_MODE: 원본 전용 정책이 필요합니다.");
        if (!n.path("status").asText().equals("CONFIRMED")) fail("LOCAL_POLICY_DRAFT: 팀이 실제 확정한 정책을 적용하세요.");
        for (String key:List.of("policyId","policyVersion","buildId")) CollectionAdministration.reference(n.path(key).asText());
        for(String key:List.of("policyId","policyVersion","buildId")) if(!n.path(key).asText().matches("[A-Za-z0-9_.-]{1,100}"))fail("LOCAL_POLICY_IDENTIFIER: 정책·빌드 식별자를 확인하세요.");
        for (String key:List.of("purpose","collectionItems","useScope","retentionPolicy","sensitivePageExclusions","textPrivacyPolicy","changePolicy","collectionScope"))
            if (n.path(key).asText().isBlank() || n.path(key).asText().length()>12000) fail("LOCAL_POLICY_INCOMPLETE: 수집·보존·제외·변경 방침을 확인하세요.");
        if (!n.path("siteScope").asText().isEmpty() && !n.path("siteScope").asText().equals("PUBLIC_HTTP_HTTPS")) fail("LOCAL_POLICY_SCOPE: unknown website scope");
        var institution=n.path("institution");
        if (!Set.of("UNRESOLVED","REQUIRED_SATISFIED","NOT_REQUIRED").contains(institution.path("decision").asText())) fail("INSTITUTION_INVALID: 기관 판단 상태를 확인하세요.");
        if (!institution.path("decision").asText().equals("UNRESOLVED")) CollectionAdministration.reference(institution.path("evidenceRef").asText());
        Instant start=Instant.parse(n.path("notBefore").asText()),end=Instant.parse(n.path("expiresAt").asText());
        if (start.isAfter(now) || !end.isAfter(now) || !end.isAfter(start)) fail("LOCAL_POLICY_EXPIRED: 정책 적용 기간을 확인하세요.");
        var p=mapper.treeToValue(n.path("plan"),CollectionPlanService.Plan.class);
        CollectionPlanService.validate(p);
        if (p.revision()<1 || p.goals().stream().anyMatch(g->!g.status().equals("CONFIRMED")) || p.slots().stream().anyMatch(s->s.participantId()!=null)) fail("GOAL_UNCONFIRMED: 공통 확정 목표·revision·빈 슬롯 원본이 필요합니다.");
        var draft=CollectionPlanService.draft();
        if (!p.assignments().equals(draft.assignments()) || !p.goals().stream().map(CollectionPlanService.Goal::goalId).toList().equals(draft.goals().stream().map(CollectionPlanService.Goal::goalId).toList())) fail("LOCAL_PLAN_MISMATCH: 기존 20목표·160배정·A54/B53/C53을 유지하세요.");
        if (!checksum(p).equals(n.path("planChecksum").asText())) fail("LOCAL_PLAN_CHECKSUM: 공통 Plan 체크섬이 다릅니다.");
        return p;
    }
    public static boolean institutionCleared(JsonNode n) {
        return Set.of("REQUIRED_SATISFIED","NOT_REQUIRED").contains(n.path("institution").path("decision").asText());
    }
    public static String operationalRef(JsonNode n) {
        return "repository:" + n.path("policyId").asText() + ":" + n.path("policyVersion").asText();
    }
    public String checksum(CollectionPlanService.Plan p) {
        // Typed, ordered JSON is shared across all PCs; local participant UUIDs are excluded.
        return com.focusrecovery.domain.identity.AuthenticationService.digest(canonical(p));
    }
    public String canonical(Object value) { return mapper.writeValueAsString(sorted(mapper.convertValue(value,Object.class))); }
    private Object sorted(Object value) {
        if(value instanceof Map<?,?> map) {var result=new TreeMap<String,Object>();map.forEach((k,v)->result.put(k.toString(),sorted(v)));return result;}
        if(value instanceof List<?> list)return list.stream().map(this::sorted).toList();
        return value;
    }
    static void fail(String message) { throw new IllegalArgumentException(message); }
}
