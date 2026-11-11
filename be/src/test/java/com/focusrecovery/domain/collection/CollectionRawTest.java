package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.json.JsonMapper;

@TestPropertySource(properties={"focus-recovery.v2.dispatch.enabled=false","focus-recovery.ai.base-url=http://127.0.0.1:1","focus-recovery.v2.retraction.interval=1h"})
class CollectionRawTest extends CollectionOperationsTest {
    @Autowired CollectionExportService exports;
    @Autowired JsonMapper mapper;
    @Test void rawCompletesWithoutAiWhileLegacyQualityStillRequiresAnalysis() throws Exception {
        assigned(true);agree(aliceToken);var session=plans.start("PLAN-001","raw-no-ai");
        String sid=session.sessionId().toString();
        for(int i=1;i<=10;i++) {
            String visit=UUID.randomUUID().toString();
            String body="""
                {"visitId":"%s","sequence":%d,"browserTabKey":"synthetic-tab","normalizedUrl":"https://example.org/public",
                "domain":"example.org","title":"Synthetic TypeScript","content":"Controlled public synthetic transaction text about durable page observations and local storage",
                "searchQuery":null,"isSearchResultPage":false,"visitedAt":"2026-11-11T00:00:00.000Z",
                "activeDurationMs":5000,"tabSwitchCount":0,"behaviorVersion":0,"extractionStatus":"SUCCESS"}
                """.formatted(visit,i*2);
            mvc.perform(post("/api/sessions/"+sid+"/visits").secure(true).header("Authorization","Bearer "+aliceToken).contentType("application/json").content(body)).andExpect(status().isCreated());
            mvc.perform(post("/api/sessions/"+sid+"/visits").secure(true).header("Authorization","Bearer "+aliceToken).contentType("application/json").content(body)).andExpect(status().isOk());
            if(i==1)mvc.perform(patch("/api/sessions/"+sid+"/visits/"+visit+"/behavior").secure(true).header("Authorization","Bearer "+aliceToken).contentType("application/json").content("{\"activeDurationMs\":300000,\"tabSwitchCount\":1,\"behaviorVersion\":1}")).andExpect(status().isOk());
        }
        mvc.perform(post("/api/sessions/"+sid+"/end").secure(true).header("Authorization","Bearer "+aliceToken).contentType("application/json").content("{\"finalBehaviors\":[]}")).andExpect(status().isOk());
        var a=progress.mine().attempts().getFirst();
        assertThat(a.rawStatus()).isEqualTo("RECOLLECT_REQUIRED");
        mvc.perform(post("/api/collection/attempts/"+a.attemptId()+"/delivered").secure(true).header("Authorization","Bearer "+aliceToken).contentType("application/json").content("{\"visitCount\":10,\"lastSequence\":20}")).andExpect(status().isNoContent());
        a=progress.mine().attempts().getFirst();
        assertThat(a.rawStatus()).isEqualTo("RAW_COLLECTED");assertThat(a.analysisState()).isEqualTo("NOT_RUN");
        assertThat(a.status()).isEqualTo("RECOLLECT_REQUIRED");assertThat(a.rawQuality().theoreticalWindows()).isEqualTo(8);
        assertThat(progress.mine().raw().syntheticCompleted()).isEqualTo(1);assertThat(progress.mine().completed()).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM analysis_window WHERE session_id=?",Integer.class,sid)).isZero();
        var snapshot=exports.export(alice,false);String raw=mapper.writeValueAsString(snapshot);
        assertThat(raw).doesNotContain(aliceToken,"identityReferenceHash","requestKey","tokenHash");
        assertThat(((Map<?,?>)snapshot.get("files")).get("visits")).asList().hasSize(10);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collection_export_audit WHERE participant_id=?",Integer.class,alice.toString())).isEqualTo(1);
        mvc.perform(get("/api/collection/admin/export-privacy/"+alice).secure(true).header("Authorization","Bearer "+bobToken)).andExpect(status().isForbidden());
        mvc.perform(post("/api/consent/withdrawals").secure(true).header("Authorization","Bearer "+aliceToken).contentType("application/json").content("{\"requestId\":\""+UUID.randomUUID()+"\"}")).andExpect(status().isAccepted());
        assertThat(progress.mine().attempts().getFirst().rawStatus()).isEqualTo("QUARANTINED");
        assertThatThrownBy(()->exports.export(alice,false)).hasFieldOrPropertyWithValue("code","CONSENT_REQUIRED");
        as(operatorToken);assertThat(exports.privacy(alice)).containsEntry("withdrawn",true);
    }
    @Test void unstartedAssignmentCannotBreakTheThreeParticipantDistribution() {
        var before=plans.read();var changed=new ArrayList<>(before.assignments());var first=changed.getFirst();
        changed.set(0,new CollectionPlanService.Assignment(first.plannedSessionId(),first.goalId(),first.scenarioType(),first.repetition(),"B"));
        assertThatThrownBy(()->plans.save(new CollectionPlanService.Plan(before.revision(),before.goals(),changed,before.slots()))).isInstanceOf(com.focusrecovery.global.exception.InvalidRequestException.class);
        assertThat(plans.read()).isEqualTo(before);
    }
    @Test void analysisCompletionDoesNotDependOnTheTenVisitRawThreshold() {
        var q=new CollectionProgressService.Quality(9,7,7,7,0,true,List.of("VISITS_BELOW_10"));
        assertThat(CollectionProgressService.analysisState(q,7)).isEqualTo("COMPLETED");
        assertThat(CollectionProgressService.analysisState(q,0)).isEqualTo("NOT_RUN");
        assertThat(CollectionProgressService.analysisState(new CollectionProgressService.Quality(10,8,0,0,0,true,List.of("ANALYSIS_OR_STATE_INCOMPLETE")),8)).isEqualTo("INCOMPLETE");
    }
    @Test void rawQualityAcceptsSequenceGapsButRejectsDuplicateAndInvalidVisits() {
        var visits=new ArrayList<CollectionProgressService.Visit>();for(int i=1;i<=10;i++)visits.add(new CollectionProgressService.Visit(UUID.randomUUID().toString(),i*2,true));
        assertThat(CollectionProgressService.rawQuality(visits).reasons()).isEmpty();
        visits.add(visits.getFirst());assertThat(CollectionProgressService.rawQuality(visits).reasons()).contains("VISIT_REFERENCE_INVALID");
    }
}
