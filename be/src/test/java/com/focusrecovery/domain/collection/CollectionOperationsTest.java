package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.focusrecovery.domain.identity.*;
import com.focusrecovery.domain.consent.*;
import com.focusrecovery.global.exception.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:collection97;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","focus-recovery.collection.administration-enabled=true","focus-recovery.v2.storage.enabled=true","focus-recovery.v2.storage.recovery-interval=1h","focus-recovery.v2.withdrawal.interval=1h"})
@ActiveProfiles("test") @AutoConfigureMockMvc
class CollectionOperationsTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired CollectionAdministration admin;
    @Autowired CollectionPlanService plans;
    @Autowired CollectionProgressService progress;
    @Autowired AuthenticationService auth;
    @Autowired ConsentService consent;
    @Autowired MockMvc mvc;
    UUID operator,alice,bob;String operatorToken,aliceToken,bobToken;
    String token(UUID owner) {
        String t=Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.SecureRandom.getSeed(32));
        jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",owner.toString(),AuthenticationService.digest(UUID.randomUUID().toString()),Timestamp.from(Instant.now()));
        jdbc.update("INSERT INTO access_credential VALUES(?,?,?,NULL)",AuthenticationService.digest(t),owner.toString(),Timestamp.from(Instant.now().plusSeconds(3600)));return t;
    }
    void as(String t){AuthenticatedParticipant.bind(auth.authenticate("Bearer "+t));}
    @BeforeEach void setup(){
        for(String table:List.of("collection_failure","collection_attempt","collection_assignment","collection_goal","collection_slot","collection_plan","collection_audit","collection_operator"))jdbc.update("DELETE FROM "+table);
        operator=UUID.randomUUID();alice=UUID.randomUUID();bob=UUID.randomUUID();operatorToken=token(operator);aliceToken=token(alice);bobToken=token(bob);
        jdbc.update("INSERT INTO collection_operator VALUES(?,'test-authority-97',?,NULL)",operator.toString(),Timestamp.from(Instant.now()));
        as(operatorToken);plans.initialize();
        if(jdbc.queryForObject("SELECT COUNT(*) FROM consent_policy WHERE policy_id='SYNTHETIC-97'",Integer.class)==0)jdbc.update("INSERT INTO consent_policy VALUES('SYNTHETIC-97','1','SESSION_COLLECTION','Closed catalog synthetic test only','No participant information','Testing only',NULL,NULL,'SYNTHETIC',?)",Timestamp.from(Instant.EPOCH));
    }
    @AfterEach void clear(){AuthenticatedParticipant.clear();}
    CollectionPlanService.Plan assigned(boolean confirmed) {
        var p=plans.read();return plans.save(new CollectionPlanService.Plan(p.revision(),p.goals().stream().map(g->new CollectionPlanService.Goal(g.goalId(),confirmed?"Synthetic TypeScript transaction research":null,confirmed?"CONFIRMED":"DRAFT",confirmed?"synthetic-fixture-97":null)).toList(),p.assignments(),List.of(new CollectionPlanService.Slot("A",alice),new CollectionPlanService.Slot("B",bob),new CollectionPlanService.Slot("C",null))));
    }
    void agree(String token){as(token);consent.accept(new ConsentService.Accept(UUID.randomUUID(),"SYNTHETIC-97","1",true));}
    @Test void exactPlanAndBalancedScenarioDistribution(){
        var p=plans.read();CollectionPlanService.validate(p);
        assertThat(p.assignments()).hasSize(160);assertThat(p.goals()).hasSize(20).allMatch(g->g.description()==null && g.status().equals("DRAFT"));
        assertThat(p.assignments().stream().collect(java.util.stream.Collectors.groupingBy(CollectionPlanService.Assignment::slotId,java.util.stream.Collectors.counting()))).containsEntry("A",54L).containsEntry("B",53L).containsEntry("C",53L);
        for(var goal:p.goals())for(String scenario:CollectionPlanService.SCENARIOS)assertThat(p.assignments().stream().filter(a->a.goalId().equals(goal.goalId())&&a.scenarioType().equals(scenario)).count()).isEqualTo(2);
    }
    @Test void checkedInDraftMatchesExecutablePlan() throws Exception {
        var checked=tools.jackson.databind.json.JsonMapper.builder().build().readValue(java.nio.file.Files.readString(java.nio.file.Path.of("../docs/data-collection/plan.draft.json")),CollectionPlanService.Plan.class);
        assertThat(checked.assignments()).isEqualTo(CollectionPlanService.draft().assignments());
        assertThat(checked.slots()).isEqualTo(CollectionPlanService.draft().slots());
        assertThat(checked.goals()).hasSize(20).allSatisfy(g->{assertThat(g.status()).isEqualTo("DRAFT");assertThat(g.description()).isNotBlank();assertThat(g.evidenceRef()).isNull();});
        CollectionPlanService.validate(checked);
    }
    @Test void approvedPolicyCannotOpenActualCollection() {
        assigned(true);
        jdbc.update("UPDATE consent_policy SET status='APPROVED',approval_ref='synthetic-approval-fixture',retention_policy_ref='synthetic-retention-fixture' WHERE policy_id='SYNTHETIC-97'");
        try { agree(aliceToken);assertThatThrownBy(()->plans.start("PLAN-001","approval-is-not-activation")).hasFieldOrPropertyWithValue("code","PARTICIPANT_COLLECTION_BLOCKED"); }
        finally { jdbc.update("UPDATE consent_policy SET status='SYNTHETIC',approval_ref=NULL,retention_policy_ref=NULL WHERE policy_id='SYNTHETIC-97'"); }
    }
    @Test void duplicateDistributionAndStaleEditsAreRejected(){
        var p=plans.read();var list=new ArrayList<>(p.assignments());list.set(1,list.getFirst());
        assertThatThrownBy(()->plans.save(new CollectionPlanService.Plan(0,p.goals(),list,p.slots()))).isInstanceOf(InvalidRequestException.class);
        plans.save(p);assertThatThrownBy(()->plans.save(p)).hasFieldOrPropertyWithValue("code","PLAN_REVISION_CONFLICT");
    }
    @Test void enrollmentAndRotationKeepOnlyHashesAndAudit(){
        var input=new CollectionAdministration.Enrollment(AuthenticationService.digest("synthetic-enrollment-97"),"test-roster-97");
        var enrolled=admin.enroll(input);assertThat(admin.enroll(input)).isEqualTo(enrolled);
        UUID id=UUID.fromString((String)enrolled.get("participantId"));
        var a=admin.issue(id,new CollectionAdministration.Issue(Instant.now().plusSeconds(900),"test-issue-97"));
        assertThat(a.toString()).doesNotContain(a.credential());assertThat(auth.authenticate("Bearer "+a.credential()).participantId()).isEqualTo(id);
        var b=admin.issue(id,new CollectionAdministration.Issue(Instant.now().plusSeconds(900),"test-reissue-97"));
        assertThatThrownBy(()->auth.authenticate("Bearer "+a.credential())).isInstanceOf(AccessDenied.class);
        admin.revoke(b.credentialId(),"test-revoke-97");assertThatThrownBy(()->auth.authenticate("Bearer "+b.credential())).isInstanceOf(AccessDenied.class);
        assertThat(admin.auditLog().toString()).doesNotContain(a.credential(),b.credential());
        assertThatThrownBy(()->admin.issue(id,new CollectionAdministration.Issue(Instant.now().plusSeconds(90000),"too-long"))).isInstanceOf(InvalidRequestException.class);
    }
    @Test void operatorCanRenewOwnCredentialWithoutLosingAudit(){
        var issued=admin.issue(operator,new CollectionAdministration.Issue(Instant.now().plusSeconds(900),"test-renewal"));
        assertThatThrownBy(()->auth.authenticate("Bearer "+operatorToken)).isInstanceOf(AccessDenied.class);
        as(issued.credential());assertThat(admin.requireOperator()).isEqualTo(operator);
    }
    @Test void adminAuthorizationCannotBeObtainedByAuthenticationOrEnvironmentAlone() throws Exception {
        mvc.perform(get("/api/collection/admin/progress")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/collection/admin/progress").header("Authorization","Bearer "+aliceToken)).andExpect(status().isForbidden());
        as(aliceToken);assertThatThrownBy(()->admin.enroll(new CollectionAdministration.Enrollment("0".repeat(64),"test"))).isInstanceOf(AccessDenied.class);
        as(operatorToken);jdbc.update("UPDATE collection_operator SET revoked_at=?",Timestamp.from(Instant.now()));
        assertThatThrownBy(admin::requireOperator).isInstanceOf(AccessDenied.class);
    }
    @Test void unconfirmedGoalsAndOtherParticipantsAreBlocked(){
        assigned(false);agree(aliceToken);
        assertThatThrownBy(()->plans.start("PLAN-001","first")).hasFieldOrPropertyWithValue("code","GOAL_UNCONFIRMED");
        assertThatThrownBy(()->plans.start("PLAN-002","other")).isInstanceOf(AccessDenied.class);
        assertThat(plans.mine()).hasSize(54);as(bobToken);assertThat(plans.mine()).hasSize(53);
    }
    @Test void startIsAtomicIdempotentAndCannotChangeActualAssignment() {
        assigned(true);agree(aliceToken);var s=plans.start("PLAN-001","first");assertThat(plans.start("PLAN-001","first").sessionId()).isEqualTo(s.sessionId());
        assertThatThrownBy(()->plans.start("PLAN-001","second")).hasFieldOrPropertyWithValue("code","ASSIGNMENT_ALREADY_STARTED");
        assertThatThrownBy(()->plans.start("PLAN-004","first")).hasFieldOrPropertyWithValue("code","ASSIGNMENT_KEY_CONFLICT");
        as(operatorToken);var p=plans.read();var assignments=new ArrayList<>(p.assignments());var old=assignments.getFirst();assignments.set(0,new CollectionPlanService.Assignment(old.plannedSessionId(),old.goalId(),old.scenarioType(),old.repetition(),"B"));
        assertThatThrownBy(()->plans.save(new CollectionPlanService.Plan(p.revision(),p.goals(),assignments,p.slots()))).hasFieldOrPropertyWithValue("code","PLAN_HAS_ACTUALS");
        assertThat(jdbc.queryForObject("SELECT slot_id FROM collection_assignment WHERE planned_session_id='PLAN-001'",String.class)).isEqualTo("A");
    }
    @Test void syntheticAttemptsNeverCountAsRealCollectedOrExposePayload(){
        assigned(true);agree(aliceToken);plans.start("PLAN-001","first");
        var mine=progress.mine();assertThat(mine.planned()).isEqualTo(54);assertThat(mine.actualSessions()).isZero();assertThat(mine.completed()).isZero();assertThat(mine.syntheticSessions()).isEqualTo(1);assertThat(mine.attempts().getFirst().quality().validVisits()).isZero();
        assertThatCode(()->Instant.parse(mine.attempts().getFirst().collectedAt())).doesNotThrowAnyException();
        assertThat(mine.toString()).doesNotContain("Synthetic TypeScript",aliceToken,"content=","searchQuery=");
        as(bobToken);assertThat(progress.mine().attempts()).isEmpty();
        as(operatorToken);assertThat(progress.operator().planned()).isEqualTo(160);
    }
    @Test void ownershipFkAndFailureIdempotency() throws Exception {
        assigned(true);agree(aliceToken);var s=plans.start("PLAN-001","first");var attempt=progress.mine().attempts().getFirst().attemptId();
        assertThatThrownBy(()->jdbc.update("UPDATE collection_attempt SET participant_id=? WHERE attempt_id=?",bob.toString(),attempt)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        var f=new CollectionPlanService.Failure(UUID.randomUUID(),"EXTRACTION_FAILED",Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS));
        plans.failure(UUID.fromString(attempt),f);plans.failure(UUID.fromString(attempt),f);
        assertThat(progress.mine().attempts().getFirst().extractionFailures()).isEqualTo(1);
        mvc.perform(post("/api/collection/attempts/"+attempt+"/delivered").header("Authorization","Bearer "+bobToken).contentType("application/json").content("{\"visitCount\":0,\"lastSequence\":0}")).andExpect(status().isNotFound());
        as(bobToken);assertThatThrownBy(()->plans.failure(UUID.fromString(attempt),f)).isInstanceOf(AccessDenied.class);
        mvc.perform(get("/api/sessions/"+s.sessionId()).header("Authorization","Bearer "+bobToken)).andExpect(status().isNotFound());
    }
    @Test void everyReviewPreservesStatusReasonAndOriginalAttemptInAudit() {
        assigned(true);agree(aliceToken);plans.start("PLAN-001","review-history");
        var attempt=progress.mine().attempts().getFirst().attemptId();as(operatorToken);
        plans.review(UUID.fromString(attempt),new CollectionPlanService.Review("FAILED","NETWORK_FAILURE","synthetic-review-first"));
        plans.review(UUID.fromString(attempt),new CollectionPlanService.Review("RECOLLECT_REQUIRED","QUALITY_FAILURE","synthetic-review-next"));
        var events=admin.auditLog();
        assertThat(events).anyMatch(e->e.get("action").equals("REVIEW_FAILED") && e.get("target_id").equals(attempt+":NETWORK_FAILURE"));
        assertThat(events).anyMatch(e->e.get("action").equals("REVIEW_RECOLLECT_REQUIRED") && e.get("target_id").equals(attempt+":QUALITY_FAILURE"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt WHERE attempt_id=?",Integer.class,attempt)).isEqualTo(1);
    }
    @Test void endedDoesNotMeanQualityCompleteAndQuarantineWins(){
        assigned(true);agree(aliceToken);var s=plans.start("PLAN-001","first");
        jdbc.update("UPDATE work_session SET status='ENDED',ended_at=? WHERE session_id=?",Timestamp.from(Instant.now()),s.sessionId().toString());
        assertThat(progress.mine().attempts().getFirst().status()).isEqualTo("RECOLLECT_REQUIRED");
        jdbc.update("UPDATE work_session SET privacy_status='QUARANTINED' WHERE session_id=?",s.sessionId().toString());
        assertThat(progress.mine().attempts().getFirst().status()).isEqualTo("QUARANTINED");
    }
    @Test void qualityRequiresTenVisitsEightConsecutiveWindowsAndCompletedCurrentStates(){
        List<CollectionProgressService.Visit> visits=new ArrayList<>();List<CollectionProgressService.Window> windows=new ArrayList<>();
        for(int i=1;i<=10;i++)visits.add(new CollectionProgressService.Visit("visit-"+i,i*2,true));
        for(int i=0;i<8;i++){var members=visits.subList(i,i+3).stream().map(CollectionProgressService.Visit::id).toList();windows.add(new CollectionProgressService.Window("window-"+i,i+1,3,false,members.getFirst(),members.getLast(),members,List.of(1,2,3),"COMPLETED",true));}
        var good=CollectionProgressService.quality(visits,windows);assertThat(good.reasons()).isEmpty();assertThat(good.validWindows()).isEqualTo(8);
        var changed=new ArrayList<>(windows);var w=windows.getFirst();changed.set(0,new CollectionProgressService.Window(w.id(),1,3,false,w.start(),w.end(),List.of("visit-1","foreign-visit","visit-3"),List.of(1,2,3),"COMPLETED",true));
        assertThat(CollectionProgressService.quality(visits,changed).reasons()).contains("VISIT_WINDOW_REFERENCE_INVALID");
        windows.removeLast();assertThat(CollectionProgressService.quality(visits,windows).reasons()).contains("WINDOW_COUNT_MISMATCH");
    }
}
