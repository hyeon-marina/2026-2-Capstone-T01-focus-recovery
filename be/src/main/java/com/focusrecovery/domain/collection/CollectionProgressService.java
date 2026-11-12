package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.identity.AuthenticatedParticipant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CollectionProgressService {
    private final JdbcTemplate jdbc;
    @org.springframework.beans.factory.annotation.Autowired private com.focusrecovery.domain.consent.ConsentService consent;
    private final CollectionAdministration admin;
    public CollectionProgressService(JdbcTemplate jdbc,CollectionAdministration admin){this.jdbc=jdbc;this.admin=admin;}
    public record Visit(String id,int sequence,boolean valid) {}
    public record Window(String id,int index,int size,boolean invalidated,String start,String end,List<String> members,List<Integer> positions,String analysisStatus,boolean currentState) {}
    public record Quality(int validVisits,int expectedWindows,int validWindows,int analysisSuccess,int analysisFailure,boolean referencesValid,List<String> reasons) {}
    static Quality quality(List<Visit> visits,List<Window> windows) {
        List<String> reasons=new ArrayList<>();
        var valid=visits.stream().filter(Visit::valid).toList();
        boolean references=valid.size()==visits.size() && valid.stream().map(Visit::id).distinct().count()==visits.size() && valid.stream().map(Visit::sequence).distinct().count()==visits.size();
        for(int i=1;i<valid.size();i++)references &= valid.get(i-1).sequence()<valid.get(i).sequence();
        int expected=Math.max(0,valid.size()-2),good=0,success=0,failed=0;
        for(int i=0;i<windows.size();i++) {
            var w=windows.get(i);boolean match=i<expected && w.index()==i+1 && w.size()==3 && !w.invalidated() && w.positions().equals(List.of(1,2,3));
            if(match) { var members=valid.subList(i,i+3).stream().map(Visit::id).toList();match=w.members().equals(members) && w.start().equals(members.getFirst()) && w.end().equals(members.getLast()); }
            references &= match;
            if(match && "COMPLETED".equals(w.analysisStatus()) && w.currentState())good++;
            if("COMPLETED".equals(w.analysisStatus()))success++;
            if("FAILED".equals(w.analysisStatus()))failed++;
        }
        if(valid.size()<10)reasons.add("VISITS_BELOW_10");
        if(!references)reasons.add("VISIT_WINDOW_REFERENCE_INVALID");
        if(windows.size()!=expected)reasons.add("WINDOW_COUNT_MISMATCH");
        if(good!=expected)reasons.add("ANALYSIS_OR_STATE_INCOMPLETE");
        return new Quality(valid.size(),expected,good,success,failed,references,List.copyOf(reasons));
    }
    public record RawQuality(int validVisits,int theoreticalWindows,boolean referencesValid,List<String> reasons) {}
    static RawQuality rawQuality(List<Visit> visits) {
        var reasons=new ArrayList<String>();
        int valid=(int)visits.stream().filter(Visit::valid).count();
        boolean refs=valid==visits.size() && visits.stream().map(Visit::id).distinct().count()==visits.size();
        int previous=0;
        for(var v:visits) { refs &= v.sequence()>previous;previous=v.sequence(); }
        if(valid<10)reasons.add("VISITS_BELOW_10");
        if(!refs)reasons.add("VISIT_REFERENCE_INVALID");
        return new RawQuality(valid,Math.max(0,valid-2),refs,List.copyOf(reasons));
    }
    static String analysisState(Quality quality,int generated) {
        if(generated==0)return "NOT_RUN";
        return quality.reasons().stream().allMatch(reason->reason.equals("VISITS_BELOW_10"))?"COMPLETED":"INCOMPLETE";
    }
    public record RawProgress(int completed,int syntheticCompleted,int validVisits,int theoreticalWindows,int generatedWindows,int analysisCompletedWindows,Map<String,Integer> participants,Map<String,Integer> goals,Map<String,Integer> scenarios) {}
    public record Attempt(String attemptId,String plannedSessionId,String participantId,String sessionId,String goalId,String scenarioType,String source,String sessionStatus,String privacyStatus,String reviewStatus,String reasonCode,String collectedAt,Quality quality,int extractionFailures,int collectionFailures,boolean deliveryConfirmed,String status,RawQuality rawQuality,String rawStatus,String analysisState,int analysisWindowCount) {}
    public record Group(int planned,int completed,int inProgress,int failed,int recollectRequired,int quarantined) {}
    public record Progress(int planned,int actualSessions,int endedSessions,int completed,int syntheticSessions,int syntheticQualityPassed,int inProgress,int failed,int recollectRequired,int quarantined,int validVisits,int validWindows,int extractionFailures,int analysisSuccess,int analysisFailure,List<Attempt> attempts,Map<String,Group> participants,Map<String,Group> goals,Map<String,Group> scenarios,boolean actualCollectionBlocked,RawProgress raw) {}
    @Transactional public Progress operator() {
        admin.requireOperator();admin.audit("READ_PROGRESS","160","operator-console");return progress(null);
    }
    @Transactional(readOnly=true) public Progress mine() { return progress(AuthenticatedParticipant.required().participantId().toString()); }
    Progress snapshot(String owner) { return progress(owner); }
    private Progress progress(String owner) {
        var assignments=jdbc.queryForList("SELECT a.planned_session_id,a.goal_id,a.scenario_type,a.slot_id,s.participant_id FROM collection_assignment a JOIN collection_slot s ON s.slot_id=a.slot_id"+(owner==null?"":" WHERE s.participant_id=?"),owner==null?new Object[]{}:new Object[]{owner});
        var rows=jdbc.queryForList("SELECT t.*,a.goal_id,a.scenario_type,s.status AS session_status,s.privacy_status,s.ended_at,s.consent_id FROM collection_attempt t JOIN collection_assignment a ON a.planned_session_id=t.planned_session_id JOIN work_session s ON s.session_id=t.session_id"+(owner==null?"":" WHERE t.participant_id=?")+" ORDER BY t.created_at,t.attempt_id",owner==null?new Object[]{}:new Object[]{owner});
        String filter=owner==null?"":" WHERE t.participant_id=?";
        Object[] params=owner==null?new Object[]{}:new Object[]{owner};
        Map<String,List<Visit>> visitMap=new HashMap<>();
        jdbc.query("SELECT v.session_id,v.visit_id,v.sequence,(v.active_duration_ms>=5000 AND v.extraction_status='SUCCESS' AND v.title IS NOT NULL AND CHAR_LENGTH(v.title)>0 AND v.content IS NOT NULL AND CHAR_LENGTH(v.content)>0 AND NOT EXISTS(SELECT 1 FROM visit_tombstone p WHERE p.session_id=v.session_id AND p.visit_id=v.visit_id)) AS valid FROM page_visit v JOIN collection_attempt t ON t.session_id=v.session_id"+filter+" ORDER BY v.session_id,v.sequence",(org.springframework.jdbc.core.RowCallbackHandler) r->visitMap.computeIfAbsent(r.getString(1),k->new ArrayList<>()).add(new Visit(r.getString(2),r.getInt(3),r.getBoolean(4))),params);
        Map<String,List<String>> memberMap=new HashMap<>();Map<String,List<Integer>> positionMap=new HashMap<>();
        jdbc.query("SELECT m.window_id,m.visit_id,m.position FROM window_visit m JOIN analysis_window w ON w.window_id=m.window_id JOIN collection_attempt t ON t.session_id=w.session_id"+filter+" ORDER BY m.window_id,m.position",(org.springframework.jdbc.core.RowCallbackHandler) r->{memberMap.computeIfAbsent(r.getString(1),k->new ArrayList<>()).add(r.getString(2));positionMap.computeIfAbsent(r.getString(1),k->new ArrayList<>()).add(r.getInt(3));},params);
        Map<String,List<Window>> windowMap=new HashMap<>();
        jdbc.query("SELECT w.*,a.processing_status,h.window_id AS current_state FROM analysis_window w JOIN collection_attempt t ON t.session_id=w.session_id LEFT JOIN analysis_result a ON a.window_id=w.window_id LEFT JOIN window_state_history h ON h.window_id=w.window_id AND h.state_version=w.last_state_version AND h.analysis_id=a.analysis_id"+filter+" ORDER BY w.session_id,w.window_index",(org.springframework.jdbc.core.RowCallbackHandler) r->{
            String id=r.getString("window_id");boolean state=!r.getBoolean("decision_dirty") && r.getString("decision_error_code")==null && r.getString("current_state")!=null;
            windowMap.computeIfAbsent(r.getString("session_id"),k->new ArrayList<>()).add(new Window(id,r.getInt("window_index"),r.getInt("window_size"),r.getBoolean("invalidated"),r.getString("start_visit_id"),r.getString("end_visit_id"),memberMap.getOrDefault(id,List.of()),positionMap.getOrDefault(id,List.of()),r.getString("processing_status"),state));
        },params);
        Map<String,int[]> failureMap=new HashMap<>();
        jdbc.query("SELECT f.attempt_id,COUNT(*) AS failures,SUM(CASE WHEN f.reason_code IN ('EXTRACTION_FAILED','EXTRACTION_NO_CONTENT','EXTRACTION_DOM_ERROR','EXTRACTION_RENDER_TIMEOUT','EXTRACTION_ACCESS_DENIED') THEN 1 ELSE 0 END) AS extraction FROM collection_failure f JOIN collection_attempt t ON t.attempt_id=f.attempt_id"+filter+" GROUP BY f.attempt_id",(org.springframework.jdbc.core.RowCallbackHandler) r->failureMap.put(r.getString(1),new int[]{r.getInt(2),r.getInt(3)}),params);
        List<Attempt> attempts=new ArrayList<>();
        Map<String,UUID> currentConsents=new HashMap<>();
        for(var r:rows) {
            String session=(String)r.get("session_id");
            var visits=visitMap.getOrDefault(session,List.of());
            Quality q=quality(visits,windowMap.getOrDefault(session,List.of()));
            var f=failureMap.getOrDefault((String)r.get("attempt_id"),new int[2]);int failures=f[0],extraction=f[1];
            boolean delivered=r.get("delivered_visit_count") instanceof Number c && c.intValue()==visits.size() && r.get("delivered_through_sequence") instanceof Number s && s.intValue()==(visits.isEmpty()?0:visits.getLast().sequence());
            String review=(String)r.get("review_status"),status;
            if(!r.get("privacy_status").equals("CLEAR"))status="QUARANTINED";
            else if(review.equals("FAILED"))status="FAILED";
            else if(review.equals("RECOLLECT_REQUIRED"))status="RECOLLECT_REQUIRED";
            else if(r.get("session_status").equals("ACTIVE"))status="IN_PROGRESS";
            else if(q.reasons().isEmpty() && delivered)status="QUALITY_PASSED";
            else status="RECOLLECT_REQUIRED";
            var raw=rawQuality(visits);
            String rawStatus;
            String participant=(String)r.get("participant_id");
            if(!currentConsents.containsKey(participant))currentConsents.put(participant,consent.validConsent(UUID.fromString(participant)));
            UUID validConsent=currentConsents.get(participant);
            boolean consentValid=validConsent!=null && validConsent.toString().equals(r.get("consent_id"));
            if(!r.get("privacy_status").equals("CLEAR") || !consentValid)rawStatus="QUARANTINED";
            else if(review.equals("FAILED") || review.equals("RECOLLECT_REQUIRED"))rawStatus=review;
            else if(r.get("session_status").equals("ACTIVE"))rawStatus="IN_PROGRESS";
            else rawStatus=raw.reasons().isEmpty() && delivered?"RAW_COLLECTED":"RECOLLECT_REQUIRED";
            var sessionWindows=windowMap.getOrDefault(session,List.of());
            String analysis=analysisState(q,sessionWindows.size());
            attempts.add(new Attempt((String)r.get("attempt_id"),(String)r.get("planned_session_id"),(String)r.get("participant_id"),session,(String)r.get("goal_id"),(String)r.get("scenario_type"),(String)r.get("source"),(String)r.get("session_status"),(String)r.get("privacy_status"),review,(String)r.get("reason_code"),utc(r.get("created_at")),q,extraction,failures,delivered,status,raw,rawStatus,analysis,sessionWindows.size()));
        }
        var actual=attempts.stream().filter(a->a.source().equals("PARTICIPANT")).toList();
        var latest=new LinkedHashMap<String,Attempt>();
        for(var a:actual)latest.put(a.plannedSessionId(),a);
        var current=List.copyOf(latest.values());
        Map<String,Group> participants=groups(assignments,current,"slot_id"),goals=groups(assignments,current,"goal_id"),scenarios=groups(assignments,current,"scenario_type");
        var included=current.stream().filter(a->a.privacyStatus().equals("CLEAR") && a.status().equals("QUALITY_PASSED")).toList();
        return new Progress(assignments.size(),actual.size(),(int)actual.stream().filter(a->a.sessionStatus().equals("ENDED")).count(),distinct(current,"QUALITY_PASSED"),(int)attempts.stream().filter(a->a.source().equals("SYNTHETIC")).count(),distinct(attempts.stream().filter(a->a.source().equals("SYNTHETIC")).toList(),"QUALITY_PASSED"),distinct(current,"IN_PROGRESS"),distinct(current,"FAILED"),distinct(current,"RECOLLECT_REQUIRED"),distinct(current,"QUARANTINED"),included.stream().mapToInt(a->a.quality().validVisits()).sum(),included.stream().mapToInt(a->a.quality().validWindows()).sum(),actual.stream().mapToInt(Attempt::extractionFailures).sum(),included.stream().mapToInt(a->a.quality().analysisSuccess()).sum(),actual.stream().mapToInt(a->a.quality().analysisFailure()).sum(),attempts,participants,goals,scenarios,!consent.deploymentConfigured(),rawProgress(assignments,current,attempts,windowMap));
    }
    private static RawProgress rawProgress(List<Map<String,Object>> assignments,List<Attempt> current,List<Attempt> all,Map<String,List<Window>> windows) {
        var included=current.stream().filter(a->a.rawStatus().equals("RAW_COLLECTED")).toList();
        var synthetic=new LinkedHashMap<String,Attempt>();
        for(var attempt:all)if(attempt.source().equals("SYNTHETIC"))synthetic.put(attempt.plannedSessionId(),attempt);
        return new RawProgress(included.size(),(int)synthetic.values().stream().filter(a->a.rawStatus().equals("RAW_COLLECTED")).count(),included.stream().mapToInt(a->a.rawQuality().validVisits()).sum(),included.stream().mapToInt(a->a.rawQuality().theoreticalWindows()).sum(),included.stream().mapToInt(a->windows.getOrDefault(a.sessionId(),List.of()).size()).sum(),included.stream().mapToInt(a->a.quality().analysisSuccess()).sum(),rawGroups(assignments,included,"slot_id"),rawGroups(assignments,included,"goal_id"),rawGroups(assignments,included,"scenario_type"));
    }
    private static Map<String,Integer> rawGroups(List<Map<String,Object>> assignments,List<Attempt> included,String field) {
        Map<String,Integer> groups=new TreeMap<>();
        for(var row:assignments) {
            String key=(String)row.get(field),id=(String)row.get("planned_session_id");
            groups.putIfAbsent(key,0);
            if(included.stream().anyMatch(a->a.plannedSessionId().equals(id)))groups.merge(key,1,Integer::sum);
        }
        return groups;
    }
    private static String utc(Object value) {
        if(value instanceof java.sql.Timestamp t)return t.toInstant().toString();
        if(value instanceof java.time.LocalDateTime t)return t.toInstant(java.time.ZoneOffset.UTC).toString();
        throw new com.focusrecovery.global.exception.StoredDataException("수집 시각을 읽을 수 없습니다.");
    }
    private static int distinct(List<Attempt> a,String status){return (int)a.stream().filter(x->x.status().equals(status)).map(Attempt::plannedSessionId).distinct().count();}
    private static Map<String,Group> groups(List<Map<String,Object>> assignments,List<Attempt> attempts,String field) {
        Map<String,Group> result=new TreeMap<>();
        for(var r:assignments) {
            String key=(String)r.get(field);if(result.containsKey(key))continue;
            var ids=assignments.stream().filter(x->x.get(field).equals(key)).map(x->(String)x.get("planned_session_id")).toList();
            var a=attempts.stream().filter(x->ids.contains(x.plannedSessionId())).toList();
            result.put(key,new Group(ids.size(),distinct(a,"QUALITY_PASSED"),distinct(a,"IN_PROGRESS"),distinct(a,"FAILED"),distinct(a,"RECOLLECT_REQUIRED"),distinct(a,"QUARANTINED")));
        }
        return result;
    }
}
