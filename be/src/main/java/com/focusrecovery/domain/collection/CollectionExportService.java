package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.consent.ConsentService;
import com.focusrecovery.domain.identity.AuthenticatedParticipant;
import com.focusrecovery.global.exception.ConflictException;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** Consistent, explicit allowlist projections. No credentials, identity mapping or AI snapshots. */
@Service
public class CollectionExportService {
    private final JdbcTemplate jdbc;
    private final ConsentService consent;
    private final CollectionAdministration admin;
    private final CollectionProgressService progress;
    private final Clock clock;
    @org.springframework.beans.factory.annotation.Autowired private com.focusrecovery.global.config.V2StorageGate gate;
    @org.springframework.beans.factory.annotation.Autowired private CollectionSitePolicy sites;
    @org.springframework.beans.factory.annotation.Autowired private org.springframework.beans.factory.ObjectProvider<org.springframework.boot.info.BuildProperties> build;
    public CollectionExportService(JdbcTemplate jdbc,ConsentService consent,CollectionAdministration admin,CollectionProgressService progress,Clock clock) {
        this.jdbc=jdbc;this.consent=consent;this.admin=admin;this.progress=progress;this.clock=clock;
    }
    private String source() {
        jdbc.queryForList("SELECT guard_id FROM collection_bootstrap_guard WHERE guard_id=1 FOR UPDATE");
        var ids=jdbc.queryForList("SELECT source_instance_id FROM collection_source_instance WHERE instance_key=1",String.class);
        if(!ids.isEmpty())return ids.getFirst();
        String id=UUID.randomUUID().toString();jdbc.update("INSERT INTO collection_source_instance VALUES(1,?)",id);return id;
    }
    private List<Map<String,Object>> rows(String sql,Object... params) {
        return jdbc.query(sql,(r,n)->{
            Map<String,Object> row=new LinkedHashMap<>();
            for(int i=1;i<=r.getMetaData().getColumnCount();i++) {
                String label=r.getMetaData().getColumnLabel(i).toLowerCase(Locale.ROOT);
                var key=new StringBuilder();boolean upper=false;
                for(char c:label.toCharArray()){if(c=='_')upper=true;else{key.append(upper?Character.toUpperCase(c):c);upper=false;}}
                Object value=r.getObject(i);
                if(value instanceof Timestamp t)value=t.toInstant().toString();
                else if(value instanceof LocalDateTime t)value=t.toInstant(ZoneOffset.UTC).toString();
                if(label.equals("is_search_result_page"))value=r.getBoolean(i);
                row.put(key.toString(),value);
            }
            return row;
        },params);
    }
    // Only the reviewed v5 -> v6 release pair grants continued use of historical raw text.
    private static final String EXPORT_CONSENT = """
        (s.consent_id=? OR EXISTS (
          SELECT 1 FROM consent_record past
          JOIN consent_record present ON present.participant_id=past.participant_id
          JOIN session_collection_scope scope ON scope.session_id=s.session_id
          JOIN collection_local_owner owner ON owner.participant_id=past.participant_id
          WHERE past.consent_id=s.consent_id AND past.participant_id=s.owner_participant_id
          AND past.accepted_at<=s.started_at AND past.withdrawn_at IS NULL
          AND present.consent_id=? AND present.withdrawn_at IS NULL
          AND past.policy_id='focus-team-raw-v2' AND past.policy_version='5'
          AND present.policy_id=past.policy_id AND present.policy_version='6'
          AND scope.policy_digest='2d54a38acb72f8e39d84313f1ba5d807ff39971cf53eff4ba6d615a6da669d67'
          AND owner.policy_digest='31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982'))
        """;
    @Transactional(isolation=Isolation.REPEATABLE_READ)
    public Map<String,Object> export(UUID participant,boolean operator) {
        if(operator)admin.requireOperator();
        else if(!participant.equals(AuthenticatedParticipant.required().participantId()))throw new com.focusrecovery.domain.identity.AccessDenied(404);
        gate.requireEnabled();
        if(sites.realProfile() && !consent.deploymentConfigured())throw new ConflictException("COLLECTION_POLICY_BLOCKED","현재 승인 배포가 필요합니다.");
        consent.lockParticipant(participant);
        UUID current=consent.requireConsent(participant);
        String source=source(),owner=participant.toString(),export=UUID.randomUUID().toString();
        var revisions=jdbc.queryForList("SELECT revision FROM collection_plan WHERE plan_id=1",Long.class);
        if(revisions.size()!=1)throw new ConflictException("PLAN_NOT_INITIALIZED","배정표를 먼저 준비하세요.");
        Map<String,List<?>> files=new LinkedHashMap<>();
        files.put("goals",rows("SELECT goal_id,description,status,evidence_ref FROM collection_goal ORDER BY goal_id"));
        files.put("assignments",rows("SELECT planned_session_id,goal_id,scenario_type,repetition,slot_id FROM collection_assignment ORDER BY planned_session_id"));
        files.put("participants",rows("SELECT s.slot_id,p.participant_id FROM participant p JOIN collection_slot s ON s.participant_id=p.participant_id WHERE p.participant_id=?",owner));
        files.put("sessions",rows("SELECT s.session_id,s.owner_participant_id AS participant_id,a.goal_id,a.scenario_type AS scenario,s.started_at,s.ended_at,s.status,s.collection_spec_version,s.consent_id AS consent_record_id,s.privacy_status,s.privacy_revision,t.source,t.planned_session_id FROM work_session s JOIN collection_attempt t ON t.session_id=s.session_id JOIN collection_assignment a ON a.planned_session_id=t.planned_session_id WHERE t.participant_id=? ORDER BY s.started_at,s.session_id",owner));
        String clear=" JOIN work_session s ON s.session_id=v.session_id JOIN collection_attempt t ON t.session_id=s.session_id WHERE t.participant_id=? AND s.privacy_status='CLEAR' AND "+EXPORT_CONSENT+" AND s.status='ENDED' AND NOT EXISTS(SELECT 1 FROM visit_tombstone x WHERE x.session_id=s.session_id)";
        files.put("visits",rows("SELECT v.visit_id,v.session_id,v.sequence,v.browser_tab_key,v.normalized_url,v.domain,v.title,v.content,v.search_query,v.is_search_result_page,v.visited_at,v.extraction_status,v.active_duration_ms,v.tab_switch_count,v.behavior_version FROM page_visit v"+clear+" ORDER BY v.session_id,v.sequence",owner,current.toString(),current.toString()));
        files.put("behaviors",rows("SELECT v.visit_id,v.session_id,v.active_duration_ms,v.tab_switch_count,v.behavior_version,v.updated_at FROM page_visit v"+clear+" ORDER BY v.session_id,v.sequence",owner,current.toString(),current.toString()));
        files.put("collection_attempts",rows("SELECT attempt_id,planned_session_id,participant_id,session_id,source,review_status,delivered_visit_count,delivered_through_sequence,reason_code,created_at FROM collection_attempt WHERE participant_id=? ORDER BY created_at,attempt_id",owner));
        files.put("collection_failures",rows("SELECT f.failure_id,f.attempt_id,f.reason_code,f.observed_at FROM collection_failure f JOIN collection_attempt t ON t.attempt_id=f.attempt_id WHERE t.participant_id=? ORDER BY f.observed_at,f.failure_id",owner));
        files.put("consent_references",rows("SELECT c.consent_id,c.participant_id,c.policy_id,c.policy_version,c.accepted_at,c.withdrawn_at,p.status AS policy_status,p.retention_policy_ref,p.approval_ref FROM consent_record c JOIN consent_policy p ON p.policy_id=c.policy_id AND p.policy_version=c.policy_version WHERE c.participant_id=? ORDER BY c.accepted_at,c.consent_id",owner));
        files.put("privacy_events",rows("SELECT r.retraction_id,r.session_id,r.visit_id,r.reason_code,r.requested_at,r.processing_status FROM privacy_retraction r JOIN work_session s ON s.session_id=r.session_id JOIN collection_attempt a ON a.session_id=s.session_id WHERE s.owner_participant_id=? ORDER BY r.requested_at,r.retraction_id",owner));
        files.put("raw_quality",progress.snapshot(owner).attempts());
        Instant now=clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        Map<String,Object> manifest=new LinkedHashMap<>();
        manifest.put("schemaVersion","focus-raw-export/1");manifest.put("collectionSpecVersion","2.0");manifest.put("apiContractVersion",2);
        manifest.put("exportId",export);manifest.put("sourceInstanceId",source);manifest.put("participantId",owner);
        manifest.put("planRevision",revisions.getFirst());manifest.put("exportedAt",now.toString());manifest.put("privacyAsOf",now.toString());
        manifest.put("sourceCommit",build.getIfAvailable()==null?"NOT_RECORDED":build.getIfAvailable().get("sourceCommit"));
        manifest.put("dataSource",consent.policy().status().equals("SYNTHETIC")?"SYNTHETIC":"PARTICIPANT");
        manifest.put("aiArtifacts","NOT_INCLUDED");manifest.put("privacy",privacy(participant,source,now));
        jdbc.update("INSERT INTO collection_export_audit VALUES(?,?,?,?,?,?,?)",export,source,owner,AuthenticatedParticipant.required().participantId().toString(),Timestamp.from(now),files.get("sessions").size(),files.get("visits").size());
        return Map.of("manifest",manifest,"files",files);
    }
    @Transactional(isolation=Isolation.REPEATABLE_READ)
    public Map<String,Object> privacy(UUID participant) { return privacy(participant,true); }
    @Transactional(isolation=Isolation.REPEATABLE_READ)
    public Map<String,Object> privacy(UUID participant,boolean operator) {
        if(operator)admin.requireOperator();
        if(!participant.equals(AuthenticatedParticipant.required().participantId()))admin.requireOperator();
        consent.lockParticipant(participant);
        String source=source();
        jdbc.update("INSERT INTO collection_audit VALUES(?,?,?,?,?,?)",UUID.randomUUID().toString(),AuthenticatedParticipant.required().participantId().toString(),"READ_EXPORT_PRIVACY",participant.toString(),"individual-local-103",Timestamp.from(clock.instant()));
        return privacy(participant,source,clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS));
    }
    private Map<String,Object> privacy(UUID participant,String source,Instant now) {
        var valid=consent.validConsent(participant);
        var sessions=rows("SELECT session_id,consent_id,privacy_status,privacy_revision FROM work_session WHERE owner_participant_id=? ORDER BY session_id",participant.toString());
        if(valid!=null) {
            var historical=jdbc.queryForList("SELECT s.session_id FROM work_session s WHERE s.owner_participant_id=? AND s.consent_id<>? AND "+EXPORT_CONSENT,String.class,participant.toString(),valid.toString(),valid.toString(),valid.toString());
            var eligible=Set.copyOf(historical);
            for(var session:sessions)if(eligible.contains(session.get("sessionId")))session.put("authorizedByConsentId",valid.toString());
        }
        return Map.of("sourceInstanceId",source,"participantId",participant.toString(),"observedAt",now.toString(),"withdrawn",consent.withdrawn(participant),"validConsentId",valid==null?"":valid.toString(),"sessions",sessions,"tombstones",rows("SELECT v.visit_id,v.session_id FROM visit_tombstone v JOIN work_session s ON s.session_id=v.session_id WHERE s.owner_participant_id=? ORDER BY v.visit_id",participant.toString()));
    }
}
