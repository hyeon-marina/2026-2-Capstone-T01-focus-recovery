package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Transactional
class LocalRecollectTest extends CollectionOperationsTest {
    String ended(String plan,int visits) {
        String sid=plans.start(plan,UUID.randomUUID().toString()).sessionId().toString();
        jdbc.update("UPDATE work_session SET status='ENDED',ended_at=? WHERE session_id=?",Timestamp.from(Instant.now()),sid);
        for(int i=1;i<=visits;i++)jdbc.update("INSERT INTO page_visit(visit_id,session_id,sequence,browser_tab_key,normalized_url,domain,title,content,visited_at,active_duration_ms,extraction_status) VALUES(?,?,?,'test','https://public.org/article','public.org','Public','Public documentation text',?,5000,'SUCCESS')",UUID.randomUUID().toString(),sid,i,Timestamp.from(Instant.now()));
        jdbc.update("UPDATE collection_attempt SET delivered_visit_count=?,delivered_through_sequence=? WHERE session_id=?",visits,visits,sid);
        return sid;
    }
    @Test void onlyExactTupleChangesAndCompletedAttemptRequiresExplicitConfirmation() {
        assigned(true);agree(aliceToken);
        String complete=ended("PLAN-001",10),shortSession=ended("PLAN-004",2);
        jdbc.update("INSERT INTO collection_local_owner VALUES(1,?,'A',?,?,NULL)",alice.toString(),"0".repeat(64),"0".repeat(64));
        jdbc.update("INSERT INTO collection_release VALUES(?,'test-local','test',?,NULL)","0".repeat(64),Timestamp.from(Instant.now()));
        for(var sid:List.of(complete,shortSession))jdbc.update("INSERT INTO session_collection_scope VALUES(?,?,'test-local')",sid,"0".repeat(64));
        var env=new MockEnvironment();env.setActiveProfiles("individual-local");
        var controller=new LocalCollectionStatus(jdbc,null,consent,env,JsonMapper.builder().build());
        ReflectionTestUtils.setField(controller,"progress",progress);
        UUID good=UUID.fromString(jdbc.queryForObject("SELECT attempt_id FROM collection_attempt WHERE session_id=?",String.class,complete));
        UUID shortId=UUID.fromString(jdbc.queryForObject("SELECT attempt_id FROM collection_attempt WHERE session_id=?",String.class,shortSession));
        var wrong=new LocalCollectionStatus.Recollect("INSUFFICIENT_VISITS","PLAN-004",UUID.fromString(shortSession),false);
        assertThatThrownBy(()->controller.recollect(good,wrong)).hasFieldOrPropertyWithValue("code","RECOLLECT_TARGET_MISMATCH");
        controller.recollect(shortId,wrong);controller.recollect(shortId,wrong);
        assertThat(jdbc.queryForObject("SELECT review_status FROM collection_attempt WHERE attempt_id=?",String.class,good.toString())).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collection_audit WHERE action='LOCAL_RECOLLECT' AND target_id=?",Integer.class,shortId.toString())).isEqualTo(1);
        assertThatThrownBy(()->controller.recollect(good,new LocalCollectionStatus.Recollect("USER_REQUEST","PLAN-001",UUID.fromString(complete),false))).hasFieldOrPropertyWithValue("code","COMPLETED_ATTEMPT_CONFIRMATION_REQUIRED");
        controller.recollect(good,new LocalCollectionStatus.Recollect("USER_REQUEST","PLAN-001",UUID.fromString(complete),true));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM page_visit WHERE session_id=?",Integer.class,complete)).isEqualTo(10);
    }
}
