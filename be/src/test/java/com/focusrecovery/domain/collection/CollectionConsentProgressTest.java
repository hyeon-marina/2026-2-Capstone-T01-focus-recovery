package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class CollectionConsentProgressTest extends CollectionOperationsTest {
    static final String V5="2d54a38acb72f8e39d84313f1ba5d807ff39971cf53eff4ba6d615a6da669d67";
    static final String V6="31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982";
    @Autowired CollectionExportService exports;
    String past,present,session;
    Timestamp time(long seconds) { return Timestamp.from(Instant.now().minusSeconds(seconds)); }
    String complete(String plan) {
        String sid=plans.start(plan,UUID.randomUUID().toString()).sessionId().toString();
        jdbc.update("UPDATE work_session SET status='ENDED',ended_at=?,started_at=? WHERE session_id=?",time(10),time(60),sid);
        for(int i=1;i<=10;i++)jdbc.update("INSERT INTO page_visit(visit_id,session_id,sequence,browser_tab_key,normalized_url,domain,title,content,visited_at,active_duration_ms,extraction_status) VALUES(?,?,?,'test','https://example.org/public','example.org','Safe title','Public documentation text',?,5000,'SUCCESS')",UUID.randomUUID().toString(),sid,i,time(30));
        jdbc.update("UPDATE collection_attempt SET source='PARTICIPANT',delivered_visit_count=10,delivered_through_sequence=10 WHERE session_id=?",sid);
        return sid;
    }
    void policy(String version,long seconds) {
        jdbc.update("INSERT INTO consent_policy VALUES('focus-team-raw-v2',?,'SESSION_COLLECTION','Test only','Public text','Test only','test-retention','test-approval','APPROVED',?)",version,time(seconds));
    }
    String record(String version) {
        String id=UUID.randomUUID().toString();
        jdbc.update("INSERT INTO consent_record(consent_id,participant_id,policy_id,policy_version,request_id,accepted_at) VALUES(?,?,'focus-team-raw-v2',?,?,?)",id,alice.toString(),version,UUID.randomUUID().toString(),time(120));
        return id;
    }
    void fixture(boolean upgrade,boolean reconsent) {
        assigned(true);agree(aliceToken);session=complete("PLAN-001");
        policy("5",300);past=record("5");
        jdbc.update("UPDATE work_session SET consent_id=? WHERE session_id=?",past,session);
        jdbc.update("INSERT INTO collection_release VALUES(?,'test-v5','test-approval',?,NULL)",V5,time(300));
        jdbc.update("INSERT INTO session_collection_scope VALUES(?,?,'test-v5')",session,V5);
        jdbc.update("INSERT INTO collection_local_owner VALUES(1,?,'A',?,?,NULL)",alice.toString(),"0".repeat(64),upgrade?V6:V5);
        if(upgrade) { policy("6",200);if(reconsent)present=record("6"); }
    }
    void assertEligible(boolean allowed) {
        var p=progress.mine();var a=p.attempts().stream().filter(x->x.sessionId().equals(session)).findFirst().orElseThrow();
        assertThat(a.rawStatus()).isEqualTo(allowed?"RAW_COLLECTED":"QUARANTINED");
        assertThat(p.raw().completed()).isEqualTo(allowed?1:0);
        if(consent.validConsent(alice)==null)assertThatThrownBy(()->exports.export(alice,false)).hasFieldOrPropertyWithValue("code","CONSENT_REQUIRED");
        else {
            var files=(Map<?,?>)exports.export(alice,false).get("files");
            assertThat((List<?>)files.get("visits")).hasSize(allowed?10:0);
            var privacy=exports.privacy(alice,false);
            var row=((List<Map<String,Object>>)privacy.get("sessions")).stream().filter(x->x.get("sessionId").equals(session)).findFirst().orElseThrow();
            if(present!=null && allowed && !present.equals(jdbc.queryForObject("SELECT consent_id FROM work_session WHERE session_id=?",String.class,session)))assertThat(row).containsEntry("authorizedByConsentId",present);
            assertThat(row.get("privacyRevision")).isEqualTo(0L);
        }
    }
    @Test void v5CurrentConsentIsEligible() { fixture(false,false);assertEligible(true); }
    @Test void officialV6ReconsentPreservesV5ProgressAndExport() { fixture(true,true);assertEligible(true); }
    @Test void noReconsentBlocksV5AfterUpgrade() { fixture(true,false);assertEligible(false); }
    @Test void unofficialCurrentDigestIsBlocked() { fixture(true,true);jdbc.update("UPDATE collection_local_owner SET policy_digest=?","f".repeat(64));assertEligible(false); }
    @Test void unofficialHistoricalDigestIsBlocked() {
        fixture(true,true);String digest="f".repeat(64);
        jdbc.update("INSERT INTO collection_release VALUES(?,'test','test',?,NULL)",digest,time(300));
        jdbc.update("UPDATE session_collection_scope SET policy_digest=? WHERE session_id=?",digest,session);assertEligible(false);
    }
    @Test void differentHistoricalPolicyVersionIsBlocked() {
        fixture(true,true);policy("4",400);jdbc.update("UPDATE consent_record SET policy_version='4' WHERE consent_id=?",past);assertEligible(false);
    }
    @Test void withdrawnParticipantCannotUseHistoricalConsent() { fixture(true,true);jdbc.update("UPDATE participant SET withdrawn_at=? WHERE participant_id=?",time(0),alice.toString());assertEligible(false); }
    @Test void withdrawnOriginalConsentIsBlocked() { fixture(true,true);jdbc.update("UPDATE consent_record SET withdrawn_at=? WHERE consent_id=?",time(0),past);assertEligible(false); }
    @Test void consentAcceptedAfterCollectionIsBlocked() { fixture(true,true);jdbc.update("UPDATE consent_record SET accepted_at=? WHERE consent_id=?",time(0),past);assertEligible(false); }
    @Test void actualQuarantineStaysBlocked() { fixture(true,true);jdbc.update("UPDATE work_session SET privacy_status='QUARANTINED' WHERE session_id=?",session);assertEligible(false); }
    @Test void tombstoneForUnstoredVisitAlsoBlocksEntireSession() {
        fixture(true,true);String retraction=UUID.randomUUID().toString(),visit=UUID.randomUUID().toString();
        jdbc.update("INSERT INTO privacy_retraction(retraction_id,session_id,visit_id,reason_code,observed_at,requested_at,input_fingerprint,processing_status,prerequisites) VALUES(?,?,?,'SENSITIVE_CONTENT',?,?,?,'PENDING','NONE')",retraction,session,visit,time(0),time(0),"0".repeat(64));
        jdbc.update("INSERT INTO visit_tombstone VALUES(?,?,?,?)",visit,session,retraction,time(0));assertEligible(false);
    }
    @Test void v6CurrentConsentIsEligible() { fixture(true,true);jdbc.update("UPDATE work_session SET consent_id=? WHERE session_id=?",present,session);assertEligible(true); }
    @Test void mixedPoliciesCountVisitsAndWindowsAndOnlyLatestAttempt() {
        assigned(true);agree(aliceToken);session=complete("PLAN-001");String newer=complete("PLAN-004");
        policy("5",300);past=record("5");policy("6",200);present=record("6");
        jdbc.update("UPDATE work_session SET consent_id=? WHERE session_id=?",past,session);
        jdbc.update("UPDATE work_session SET consent_id=? WHERE session_id=?",present,newer);
        jdbc.update("INSERT INTO collection_release VALUES(?,'v5','test',?,NULL)",V5,time(300));
        jdbc.update("INSERT INTO session_collection_scope VALUES(?,?,'v5')",session,V5);
        jdbc.update("INSERT INTO collection_local_owner VALUES(1,?,'A',?,?,NULL)",alice.toString(),"0".repeat(64),V6);
        var raw=progress.mine().raw();assertThat(raw.completed()).isEqualTo(2);assertThat(raw.validVisits()).isEqualTo(20);assertThat(raw.theoreticalWindows()).isEqualTo(16);assertThat(raw.participants()).containsEntry("A",2);
        assertThat((List<?>)((Map<?,?>)exports.export(alice,false).get("files")).get("visits")).hasSize(20);
        jdbc.update("UPDATE collection_attempt SET created_at=? WHERE session_id=?",time(20),session);
        jdbc.update("UPDATE collection_attempt SET planned_session_id='PLAN-001',created_at=?,review_status='RECOLLECT_REQUIRED' WHERE session_id=?",time(0),newer);
        assertThat(progress.mine().raw().completed()).isZero();assertThat(progress.mine().raw().theoreticalWindows()).isZero();
        assertThat(progress.mine().attempts()).hasSize(2);
    }
}
