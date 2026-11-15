package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:collection124race;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","focus-recovery.collection.administration-enabled=true","focus-recovery.v2.storage.enabled=true","focus-recovery.v2.storage.recovery-interval=1h","focus-recovery.v2.withdrawal.interval=1h"})
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class LocalRecollectConcurrencyTest extends CollectionOperationsTest {
    @Autowired PlatformTransactionManager transactions;
    String ended(String plan,int visits) {
        String sid=plans.start(plan,UUID.randomUUID().toString()).sessionId().toString();
        jdbc.update("UPDATE work_session SET status='ENDED',ended_at=? WHERE session_id=?",Timestamp.from(Instant.now()),sid);
        for(int i=1;i<=visits;i++)jdbc.update("INSERT INTO page_visit(visit_id,session_id,sequence,browser_tab_key,normalized_url,domain,title,content,visited_at,active_duration_ms,extraction_status) VALUES(?,?,?,'test','https://public.org/article','public.org','Public','Public documentation text',?,5000,'SUCCESS')",UUID.randomUUID().toString(),sid,i,Timestamp.from(Instant.now()));
        jdbc.update("UPDATE collection_attempt SET delivered_visit_count=?,delivered_through_sequence=? WHERE session_id=?",visits,visits,sid);
        return sid;
    }
    @Test void concurrentPlan006RequestsChangeOnlyThatAttemptAndProduceOneAudit() throws Exception {
        var p=assigned(true);
        plans.save(new CollectionPlanService.Plan(p.revision(),p.goals(),p.assignments(),List.of(new CollectionPlanService.Slot("A",null),new CollectionPlanService.Slot("B",bob),new CollectionPlanService.Slot("C",alice))));
        agree(aliceToken);
        String good=ended("PLAN-003",10),shortSession=ended("PLAN-006",2),digest="c".repeat(64);
        jdbc.update("INSERT INTO collection_local_owner VALUES(1,?,'C',?,?,NULL)",alice.toString(),digest,digest);
        jdbc.update("INSERT INTO collection_release VALUES(?,'test-race','test',?,NULL)",digest,Timestamp.from(Instant.now()));
        for(var sid:List.of(good,shortSession))jdbc.update("INSERT INTO session_collection_scope VALUES(?,?,'test-race')",sid,digest);
        var oldAttempt=jdbc.queryForList("SELECT * FROM collection_attempt WHERE session_id=?",good);
        var oldVisits=jdbc.queryForList("SELECT * FROM page_visit WHERE session_id=? ORDER BY sequence",good);
        var shortVisits=jdbc.queryForList("SELECT * FROM page_visit WHERE session_id=? ORDER BY sequence",shortSession);
        var oldAudit=jdbc.queryForList("SELECT * FROM collection_audit WHERE actor_id=? ORDER BY event_id",alice.toString());
        String oldRaw=progress.mine().attempts().stream().filter(a->a.sessionId().equals(good)).findFirst().orElseThrow().rawStatus();
        UUID target=UUID.fromString(jdbc.queryForObject("SELECT attempt_id FROM collection_attempt WHERE session_id=?",String.class,shortSession));
        var env=new MockEnvironment();env.setActiveProfiles("individual-local");
        var controller=new LocalCollectionStatus(jdbc,null,consent,env,JsonMapper.builder().build());ReflectionTestUtils.setField(controller,"progress",progress);
        var ready=new CountDownLatch(2);var go=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try {
            var calls=new ArrayList<Future<?>>();
            for(int i=0;i<2;i++)calls.add(pool.submit(()->{
                as(aliceToken);ready.countDown();
                try {if(!go.await(10,TimeUnit.SECONDS))throw new AssertionError("barrier timed out");
                    new TransactionTemplate(transactions).executeWithoutResult(status->controller.recollect(target,new LocalCollectionStatus.Recollect("INSUFFICIENT_VISITS","PLAN-006",UUID.fromString(shortSession),false)));
                } catch(InterruptedException e){throw new AssertionError(e);} finally {com.focusrecovery.domain.identity.AuthenticatedParticipant.clear();}
            }));
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue();go.countDown();for(var call:calls)call.get(15,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collection_audit WHERE action='LOCAL_RECOLLECT' AND target_id=?",Integer.class,target.toString())).isEqualTo(1);
            assertThat(jdbc.queryForList("SELECT * FROM collection_attempt WHERE session_id=?",good)).isEqualTo(oldAttempt);
            assertThat(jdbc.queryForList("SELECT * FROM page_visit WHERE session_id=? ORDER BY sequence",good)).isEqualTo(oldVisits);
            assertThat(jdbc.queryForList("SELECT * FROM page_visit WHERE session_id=? ORDER BY sequence",shortSession)).isEqualTo(shortVisits);
            assertThat(progress.mine().attempts().stream().filter(a->a.sessionId().equals(good)).findFirst().orElseThrow().rawStatus()).isEqualTo(oldRaw).isEqualTo("RAW_COLLECTED");
            var after=jdbc.queryForList("SELECT * FROM collection_audit WHERE actor_id=? ORDER BY event_id",alice.toString());
            assertThat(after).containsAll(oldAudit);assertThat(after).hasSize(oldAudit.size()+1);
        } finally {
            go.countDown();pool.shutdownNow();
            jdbc.update("DELETE FROM collection_local_owner WHERE participant_id=?",alice.toString());
        }
    }
}
