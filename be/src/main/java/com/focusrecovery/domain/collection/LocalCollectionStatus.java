package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.identity.*;
import com.focusrecovery.domain.consent.ConsentService;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.json.JsonMapper;

@RestController
@Profile("individual-local")
public class LocalCollectionStatus {
    private final JdbcTemplate jdbc;private final CollectionSitePolicy sites;private final ConsentService consent;private final Environment env;private final JsonMapper mapper;
    public LocalCollectionStatus(JdbcTemplate jdbc,CollectionSitePolicy sites,ConsentService consent,Environment env,JsonMapper mapper){this.jdbc=jdbc;this.sites=sites;this.consent=consent;this.env=env;this.mapper=mapper;}
    public record Recollect(String reasonCode) {}
    @PostMapping("/api/collection/attempts/{attempt}/recollect")
    @org.springframework.transaction.annotation.Transactional
    @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void recollect(@PathVariable UUID attempt,@RequestBody Recollect input) {
        if(!Arrays.equals(env.getActiveProfiles(),new String[]{"individual-local"}))throw new AccessDenied(404);
        var actor=AuthenticatedParticipant.required();consent.lockParticipant(actor.participantId());consent.requireConsent(actor.participantId());
        if(input==null || input.reasonCode()==null || !Set.of("INSUFFICIENT_VISITS","DELIVERY_FAILED","USER_REQUEST").contains(input.reasonCode()))throw new com.focusrecovery.global.exception.InvalidRequestException("정해진 재수집 사유를 선택하세요.");
        if(jdbc.queryForObject("SELECT COUNT(*) FROM collection_local_owner WHERE participant_id=?",Integer.class,actor.participantId().toString())!=1)throw new AccessDenied(404);
        if(jdbc.update("UPDATE collection_attempt SET review_status='RECOLLECT_REQUIRED',reason_code=? WHERE attempt_id=? AND participant_id=? AND session_id IN (SELECT session_id FROM work_session WHERE status='ENDED' AND privacy_status='CLEAR')",input.reasonCode(),attempt.toString(),actor.participantId().toString())!=1)throw new AccessDenied(404);
        jdbc.update("INSERT INTO collection_audit VALUES(?,?,?,?,?,?)",UUID.randomUUID().toString(),actor.participantId().toString(),"LOCAL_RECOLLECT",attempt.toString(),input.reasonCode(),java.sql.Timestamp.from(Instant.now()));
    }
    @GetMapping("/api/collection/local-status") public Map<String,Object> status() {
        if(!Arrays.equals(env.getActiveProfiles(),new String[]{"individual-local"}))throw new AccessDenied(404);
        var actor=AuthenticatedParticipant.required();
        var owner=jdbc.queryForList("SELECT slot_id,policy_digest,plan_checksum FROM collection_local_owner WHERE participant_id=?",actor.participantId().toString());
        List<String> blockers=new ArrayList<>();String digest="",slot="",planChecksum="",goalChecksum="",assignmentChecksum="";long revision=0;Map<String,String> details=new LinkedHashMap<>();
        if(owner.size()!=1)blockers.add("LOCAL_SETUP_REQUIRED");
        else {slot=(String)owner.getFirst().get("slot_id");digest=Objects.toString(owner.getFirst().get("policy_digest"),"");planChecksum=Objects.toString(owner.getFirst().get("plan_checksum"),"");}
        if(sites.current()!=null) {
            try {
                var n=mapper.readTree(Files.readAllBytes(Path.of(env.getRequiredProperty("focus-recovery.collection.site-policy-file"))));
                if(n.path("schemaVersion").asText().equals("focus-local-policy/1")) {
                    var validator=new LocalCollectionPolicy(mapper);var plan=validator.validate(n,Instant.now());revision=plan.revision();
                    goalChecksum=AuthenticationService.digest(plan.goals().stream().map(g->validator.canonical(g)+"\n").collect(java.util.stream.Collectors.joining()));
                    assignmentChecksum=AuthenticationService.digest(plan.assignments().stream().map(g->validator.canonical(g)+"\n").collect(java.util.stream.Collectors.joining()));
                }
                for(String key:List.of("retentionPolicy","sensitivePageExclusions","textPrivacyPolicy","changePolicy","collectionScope"))details.put(key,n.path(key).asText());
            } catch(Exception e) {blockers.add("LOCAL_POLICY_MISSING");}
        } else {
            try {
                var n=mapper.readTree(Files.readAllBytes(Path.of(env.getRequiredProperty("focus-recovery.collection.site-policy-file"))));
                if(n.path("status").asText().equals("DRAFT"))blockers.add("LOCAL_POLICY_DRAFT");
                else if(!Instant.parse(n.path("expiresAt").asText()).isAfter(Instant.now()))blockers.add("LOCAL_POLICY_EXPIRED");
                else blockers.add("LOCAL_POLICY_MISMATCH");
            } catch(Exception e) {blockers.add("LOCAL_POLICY_MISSING");}
        }
        if(jdbc.queryForObject("SELECT COUNT(*) FROM collection_goal WHERE status='CONFIRMED'",Integer.class)!=20)blockers.add("GOAL_UNCONFIRMED");
        var access=consent.state();
        if(access.withdrawn())blockers.add("PRIVACY_WITHDRAWN");
        else if(!access.consentValid())blockers.add("CONSENT_REQUIRED");
        return Map.of("slot",slot,"policyDigest",digest,"blockers",blockers,"planRevision",revision,"planChecksum",planChecksum,"goalChecksum",goalChecksum,"assignmentChecksum",assignmentChecksum,"details",details,"ready",blockers.isEmpty() && access.collectionEnabled());
    }
}
