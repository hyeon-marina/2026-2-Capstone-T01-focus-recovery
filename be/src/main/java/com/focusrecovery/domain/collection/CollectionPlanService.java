package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.identity.*;
import com.focusrecovery.domain.consent.*;
import com.focusrecovery.domain.session.dto.WorkSessionResponse;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.global.exception.*;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CollectionPlanService {
    static final List<String> SCENARIOS=List.of("GOAL_MAINTENANCE","JUSTIFIED_DETOUR","GRADUAL_DRIFT","CLEAR_DRIFT");
    private final JdbcTemplate jdbc;
    @org.springframework.beans.factory.annotation.Autowired private CollectionSitePolicy sites;
    private final CollectionAdministration admin;
    private final ConsentService consent;
    private final WorkSessionService sessions;
    private final Clock clock;
    public CollectionPlanService(JdbcTemplate jdbc,CollectionAdministration admin,ConsentService consent,WorkSessionService sessions,Clock clock) {
        this.jdbc=jdbc;this.admin=admin;this.consent=consent;this.sessions=sessions;this.clock=clock;
    }
    public record Goal(String goalId,String description,String status,String evidenceRef) {}
    public record Assignment(String plannedSessionId,String goalId,String scenarioType,int repetition,String slotId) {}
    public record Slot(String slotId,UUID participantId) {}
    public record Plan(long revision,List<Goal> goals,List<Assignment> assignments,List<Slot> slots) {}
    public static Plan draft() {
        List<Goal> goals=new ArrayList<>();List<Assignment> assignments=new ArrayList<>();
        for(int g=1;g<=20;g++) {
            String goal="GOAL-%03d".formatted(g);goals.add(new Goal(goal,null,"DRAFT",null));
            for(int s=0;s<4;s++)for(int r=1;r<=2;r++) {
                int index=(g-1)*8+s*2+r-1;
                assignments.add(new Assignment("PLAN-%03d".formatted(index+1),goal,SCENARIOS.get(s),r,List.of("A","B","C").get(index%3)));
            }
        }
        return new Plan(0,goals,assignments,List.of(new Slot("A",null),new Slot("B",null),new Slot("C",null)));
    }
    static void validate(Plan p) {
        if(p==null || p.goals()==null || p.assignments()==null || p.slots()==null || p.goals().size()!=20 || p.assignments().size()!=160 || p.slots().size()!=3) invalid();
        Set<String> goals=new HashSet<>(),ids=new HashSet<>(),distribution=new HashSet<>(),slots=new HashSet<>();Set<UUID> owners=new HashSet<>();
        for(var g:p.goals()) {
            if(g.goalId()==null || !g.goalId().matches("GOAL-[0-9]{3}") || !goals.add(g.goalId()) || (g.status()==null || !Set.of("DRAFT","CONFIRMED").contains(g.status()))) invalid();
            if(g.description()!=null && (g.description().length()<5 || g.description().length()>150 || !g.description().equals(g.description().strip()))) invalid();
            if(g.status().equals("CONFIRMED")) { if(g.description()==null)invalid();CollectionAdministration.reference(g.evidenceRef()); }
        }
        for(var slot:p.slots()) if(slot.slotId()==null || !Set.of("A","B","C").contains(slot.slotId()) || !slots.add(slot.slotId()) || slot.participantId()!=null && !owners.add(slot.participantId())) invalid();
        for(var a:p.assignments()) if(a.plannedSessionId()==null || !a.plannedSessionId().matches("PLAN-[0-9]{3}") || !ids.add(a.plannedSessionId()) || !goals.contains(a.goalId()) || !slots.contains(a.slotId()) || (a.scenarioType()==null || !SCENARIOS.contains(a.scenarioType())) || a.repetition()<1 || a.repetition()>2 || !distribution.add(a.goalId()+":"+a.scenarioType()+":"+a.repetition())) invalid();
        // 160 unique combinations in 20 x 4 x 2 prove eight sessions per goal and two per type.
    }
    private static void invalid() { throw new InvalidRequestException("20목표·160배정·3참여자·시나리오별2회 및 식별자/목표를 확인하세요."); }
    @Transactional public Plan initialize() {
        admin.requireOperator();
        if(jdbc.queryForObject("SELECT COUNT(*) FROM collection_plan",Integer.class)==0) {
            jdbc.update("INSERT INTO collection_plan VALUES(1,0)");var p=draft();
            for(var s:p.slots())jdbc.update("INSERT INTO collection_slot VALUES(?,NULL)",s.slotId());
            for(var g:p.goals())jdbc.update("INSERT INTO collection_goal(goal_id,status) VALUES(?,'DRAFT')",g.goalId());
            for(var a:p.assignments())jdbc.update("INSERT INTO collection_assignment VALUES(?,?,?,?,?)",a.plannedSessionId(),a.goalId(),a.scenarioType(),a.repetition(),a.slotId());
            admin.audit("INITIALIZE_PLAN","160","issue-97");
        }
        return read();
    }
    @Transactional(readOnly=true) public Plan read() {
        admin.requireOperator();
        var revisions=jdbc.queryForList("SELECT revision FROM collection_plan WHERE plan_id=1",Long.class);
        if(revisions.isEmpty())return draft();
        return new Plan(revisions.getFirst(),jdbc.query("SELECT * FROM collection_goal ORDER BY goal_id",(r,n)->new Goal(r.getString("goal_id"),r.getString("description"),r.getString("status"),r.getString("evidence_ref"))),
            jdbc.query("SELECT * FROM collection_assignment ORDER BY planned_session_id",(r,n)->new Assignment(r.getString("planned_session_id"),r.getString("goal_id"),r.getString("scenario_type"),r.getInt("repetition"),r.getString("slot_id"))),
            jdbc.query("SELECT * FROM collection_slot ORDER BY slot_id",(r,n)->new Slot(r.getString("slot_id"),r.getString("participant_id")==null?null:UUID.fromString(r.getString("participant_id")))));
    }
    @Transactional public Plan save(Plan p) {
        admin.requireOperator();validate(p);
        var revision=jdbc.queryForList("SELECT revision FROM collection_plan WHERE plan_id=1 FOR UPDATE",Long.class);
        if(revision.isEmpty() || revision.getFirst()!=p.revision())throw new ConflictException("PLAN_REVISION_CONFLICT","배정표를 새로 조회하세요.");
        var old=read();
        if(!old.goals().stream().map(Goal::goalId).collect(java.util.stream.Collectors.toSet()).equals(p.goals().stream().map(Goal::goalId).collect(java.util.stream.Collectors.toSet())) || !old.assignments().stream().map(Assignment::plannedSessionId).collect(java.util.stream.Collectors.toSet()).equals(p.assignments().stream().map(Assignment::plannedSessionId).collect(java.util.stream.Collectors.toSet())))invalid();
        for(var s:p.slots()) {
            var previous=old.slots().stream().filter(x->x.slotId().equals(s.slotId())).findFirst().orElseThrow();
            if(!Objects.equals(previous.participantId(),s.participantId()) && jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt t JOIN collection_assignment a ON a.planned_session_id=t.planned_session_id WHERE a.slot_id=?",Integer.class,s.slotId())>0)locked();
            if(s.participantId()!=null && jdbc.queryForObject("SELECT COUNT(*) FROM participant WHERE participant_id=? AND status='ACTIVE' AND withdrawn_at IS NULL",Integer.class,s.participantId().toString())!=1)invalid();
        }
        // Clear first so that an authorized swap of unused slots does not hit the unique constraint.
        jdbc.update("UPDATE collection_slot SET participant_id=NULL");
        for(var s:p.slots())jdbc.update("UPDATE collection_slot SET participant_id=? WHERE slot_id=?",s.participantId()==null?null:s.participantId().toString(),s.slotId());
        for(var a:p.assignments()) {
            var previous=old.assignments().stream().filter(x->x.plannedSessionId().equals(a.plannedSessionId())).findFirst().orElseThrow();
            // Stable IDs encode goal/type/repetition. Only unstarted slot assignment is editable.
            if(!previous.goalId().equals(a.goalId()) || !previous.scenarioType().equals(a.scenarioType()) || previous.repetition()!=a.repetition())invalid();
            if(!previous.equals(a) && jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt WHERE planned_session_id=?",Integer.class,a.plannedSessionId())>0)locked();
            jdbc.update("UPDATE collection_assignment SET slot_id=? WHERE planned_session_id=?",a.slotId(),a.plannedSessionId());
        }
        for(String slot:List.of("A","B","C"))if(p.assignments().stream().filter(a->a.slotId().equals(slot)).count()!=(slot.equals("A")?54:53))invalid();
        for(var g:p.goals()) {
            var previous=old.goals().stream().filter(x->x.goalId().equals(g.goalId())).findFirst().orElseThrow();
            if(!previous.equals(g) && jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt t JOIN collection_assignment a ON a.planned_session_id=t.planned_session_id WHERE a.goal_id=?",Integer.class,g.goalId())>0)locked();
            jdbc.update("UPDATE collection_goal SET description=?,status=?,evidence_ref=? WHERE goal_id=?",g.description(),g.status(),g.evidenceRef(),g.goalId());
        }
        jdbc.update("UPDATE collection_plan SET revision=revision+1 WHERE plan_id=1");admin.audit("UPDATE_PLAN","160","revision-"+p.revision());return read();
    }
    private static void locked(){throw new ConflictException("PLAN_HAS_ACTUALS","실행 이력이 있는 목표·배정·참여자는 변경할 수 없습니다.");}
    public record Assigned(String plannedSessionId,String goalId,String goalText,String goalStatus,String scenarioType) {}
    @Transactional(readOnly=true) public List<Assigned> mine() {
        return jdbc.query("SELECT a.planned_session_id,a.goal_id,g.description,g.status,a.scenario_type FROM collection_assignment a JOIN collection_goal g ON g.goal_id=a.goal_id JOIN collection_slot s ON s.slot_id=a.slot_id WHERE s.participant_id=? ORDER BY a.planned_session_id",(r,n)->new Assigned(r.getString(1),r.getString(2),r.getString(3),r.getString(4),r.getString(5)),AuthenticatedParticipant.required().participantId().toString());
    }
    @Transactional public WorkSessionResponse start(String plannedId,String key) {
        UUID owner=AuthenticatedParticipant.required().participantId();consent.lockParticipant(owner);
        // Serialize plan edits and starts in one order after the participant lock.
        jdbc.queryForList("SELECT revision FROM collection_plan WHERE plan_id=1 FOR UPDATE",Long.class);
        if(key==null || key.length()>255 || !key.matches("[A-Za-z0-9_-]{1,255}"))invalid();
        var rows=jdbc.queryForList("SELECT g.description,g.status FROM collection_assignment a JOIN collection_slot s ON s.slot_id=a.slot_id JOIN collection_goal g ON g.goal_id=a.goal_id WHERE a.planned_session_id=? AND s.participant_id=?",plannedId,owner.toString());
        if(rows.size()!=1)throw new AccessDenied(404);
        var replay=jdbc.queryForList("SELECT planned_session_id,session_id FROM collection_attempt WHERE participant_id=? AND request_key=?",owner.toString(),key);
        if(!replay.isEmpty()) {
            if(!replay.getFirst().get("planned_session_id").equals(plannedId))throw new ConflictException("ASSIGNMENT_KEY_CONFLICT","다른 배정에 사용된 요청 키입니다.");
            return sessions.get(UUID.fromString((String)replay.getFirst().get("session_id")));
        }
        if(!rows.getFirst().get("status").equals("CONFIRMED"))throw new ConflictException("GOAL_UNCONFIRMED","작업 목표가 미확정입니다.");
        if(jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt t JOIN work_session s ON s.session_id=t.session_id WHERE t.planned_session_id=? AND (t.review_status='PENDING' OR s.status='ACTIVE')",Integer.class,plannedId)>0)throw new ConflictException("ASSIGNMENT_ALREADY_STARTED","기존 세션을 확인하고 재수집 사유를 등록하세요.");
        if(jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt t JOIN work_session s ON s.session_id=t.session_id WHERE t.participant_id=? AND s.status='ACTIVE'",Integer.class,owner.toString())>0)
            throw new ConflictException("SESSION_ACTIVE","진행 중인 세션을 먼저 마감하세요.");
        var access=consent.state();
        // Synthetic policies cannot become participant actuals; real releases must pass all server gates.
        if(!access.collectionEnabled() || access.policy()==null || !(access.policy().status().equals("SYNTHETIC") || sites.realProfile() && access.policy().status().equals("APPROVED")))throw new ConflictException("PARTICIPANT_COLLECTION_BLOCKED","승인 전 실제 참여자 수집은 차단됩니다.");
        var result=sessions.createAssigned((String)rows.getFirst().get("description"),"assignment:"+plannedId+":"+key,"2.0");
        jdbc.update("INSERT INTO collection_attempt(attempt_id,planned_session_id,participant_id,session_id,source,request_key,created_at) VALUES(?,?,?,?,?,?,?)",UUID.randomUUID().toString(),plannedId,owner.toString(),result.sessionId().toString(),access.policy().status().equals("SYNTHETIC")?"SYNTHETIC":"PARTICIPANT",key,Timestamp.from(clock.instant()));
        return result;
    }
    public record Review(String status,String reasonCode,String evidenceRef) {}
    @Transactional public void review(UUID attempt,Review review) {
        admin.requireOperator();
        if(review==null || (review.status()==null || !Set.of("FAILED","RECOLLECT_REQUIRED").contains(review.status())) || review.reasonCode()==null || !review.reasonCode().matches("[A-Z_]{1,60}"))invalid();
        CollectionAdministration.reference(review.evidenceRef());
        if(jdbc.update("UPDATE collection_attempt SET review_status=?,reason_code=? WHERE attempt_id=?",review.status(),review.reasonCode(),attempt.toString())!=1)throw new AccessDenied(404);
        admin.audit("REVIEW_"+review.status(),attempt+":"+review.reasonCode(),review.evidenceRef());
    }
    public record Failure(UUID failureId,String reasonCode,java.time.Instant observedAt) {}
    @Transactional public void failure(UUID attempt,Failure failure) {
        var owner=AuthenticatedParticipant.required().participantId();
        if(failure==null || failure.failureId()==null || failure.failureId().version()!=4 || failure.failureId().variant()!=2 || failure.observedAt()==null || !failure.observedAt().equals(failure.observedAt().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)) || failure.observedAt().isAfter(clock.instant().plusSeconds(5)) || (failure.reasonCode()==null || !Set.of("EXTRACTION_FAILED","EXTRACTION_NO_CONTENT","EXTRACTION_DOM_ERROR","EXTRACTION_RENDER_TIMEOUT","EXTRACTION_ACCESS_DENIED","SHORT_DURATION","POLICY").contains(failure.reasonCode())))invalid();
        if(jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt t JOIN work_session s ON s.session_id=t.session_id WHERE t.attempt_id=? AND t.participant_id=? AND s.privacy_status='CLEAR'",Integer.class,attempt.toString(),owner.toString())!=1)throw new AccessDenied(404);
        consent.requireConsent(owner);
        record Existing(String attempt,String reason,java.time.Instant observed) {}
        var replay=jdbc.query("SELECT attempt_id,reason_code,observed_at FROM collection_failure WHERE failure_id=?",(r,n)->new Existing(r.getString(1),r.getString(2),r.getTimestamp(3).toInstant()),failure.failureId().toString());
        if(!replay.isEmpty()) {
            var r=replay.getFirst();
            if(!r.attempt().equals(attempt.toString()) || !r.reason().equals(failure.reasonCode()) || !r.observed().equals(failure.observedAt()))throw new ConflictException("FAILURE_ID_CONFLICT","실패 식별자가 충돌합니다.");
            return;
        }
        jdbc.update("INSERT INTO collection_failure VALUES(?,?,?,?)",failure.failureId().toString(),attempt.toString(),failure.reasonCode(),Timestamp.from(failure.observedAt()));
    }
}
