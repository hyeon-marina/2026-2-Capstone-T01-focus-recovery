package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.identity.*;
import com.focusrecovery.global.exception.*;
import com.focusrecovery.domain.session.dto.WorkSessionResponse;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/collection")
public class CollectionController {
    private final CollectionAdministration admin;
    private final CollectionPlanService plan;
    private final CollectionProgressService progress;
    private final JdbcTemplate jdbc;
    public CollectionController(CollectionAdministration admin,CollectionPlanService plan,CollectionProgressService progress,JdbcTemplate jdbc){this.admin=admin;this.plan=plan;this.progress=progress;this.jdbc=jdbc;}
    @GetMapping("/site-policy") public CollectionSitePolicy.Policy sitePolicy() { AuthenticatedParticipant.required();return sitePolicy.require(); }
    @org.springframework.beans.factory.annotation.Autowired private CollectionSitePolicy sitePolicy;
    @PostMapping("/admin/participants") public Map<String,Object> enroll(@RequestBody CollectionAdministration.Enrollment input){return admin.enroll(input);}
    @PostMapping("/admin/participants/{participant}/credentials") public CollectionAdministration.IssuedCredential issue(@PathVariable UUID participant,@RequestBody CollectionAdministration.Issue input){return admin.issue(participant,input);}
    public record Evidence(String evidenceRef) {}
    @PostMapping("/admin/credentials/{hash}/revoke") @ResponseStatus(HttpStatus.NO_CONTENT) public void revoke(@PathVariable String hash,@RequestBody Evidence input){admin.revoke(hash,input.evidenceRef());}
    @GetMapping("/admin/audit") public List<Map<String,Object>> audit(){return admin.auditLog();}
    @PostMapping("/admin/plan/initialize") public CollectionPlanService.Plan initialize(){return plan.initialize();}
    @GetMapping("/admin/plan") public CollectionPlanService.Plan plan(){return plan.read();}
    @PutMapping("/admin/plan") public CollectionPlanService.Plan save(@RequestBody CollectionPlanService.Plan input){return plan.save(input);}
    @PostMapping("/admin/attempts/{attempt}/review") @ResponseStatus(HttpStatus.NO_CONTENT) public void review(@PathVariable UUID attempt,@RequestBody CollectionPlanService.Review input){plan.review(attempt,input);}
    @GetMapping("/admin/progress") public CollectionProgressService.Progress progress(){return progress.operator();}
    @GetMapping("/assignments") public List<CollectionPlanService.Assigned> assignments(){return plan.mine();}
    @GetMapping("/progress") public CollectionProgressService.Progress mine(){return progress.mine();}
    @PostMapping("/assignments/{plannedId}/start") @ResponseStatus(HttpStatus.CREATED)
    public WorkSessionResponse start(@PathVariable String plannedId,@RequestHeader("Idempotency-Key") String key){return plan.start(plannedId,key);}
    @GetMapping("/attempts/current") public Map<String,String> currentAttempt(@RequestParam UUID workSession) {
        var ids=jdbc.queryForList("SELECT attempt_id FROM collection_attempt WHERE session_id=? AND participant_id=?",String.class,workSession.toString(),AuthenticatedParticipant.required().participantId().toString());
        if(ids.size()!=1)throw new AccessDenied(404);return Map.of("attemptId",ids.getFirst());
    }
    @PostMapping("/attempts/{attempt}/failures") @ResponseStatus(HttpStatus.NO_CONTENT) public void failure(@PathVariable UUID attempt,@RequestBody CollectionPlanService.Failure input){plan.failure(attempt,input);}
    public record Delivered(int visitCount,int lastSequence) {}
    @PostMapping("/attempts/{attempt}/delivered") @Transactional
    @ResponseStatus(HttpStatus.NO_CONTENT) public void delivered(@PathVariable UUID attempt,@RequestBody Delivered input){
        var owner=AuthenticatedParticipant.required().participantId();
        if(input.visitCount()<0 || input.lastSequence()<0)throw new InvalidRequestException("실제 전송 개수와 sequence가 필요합니다.");
        if(jdbc.update("UPDATE collection_attempt SET delivered_visit_count=?,delivered_through_sequence=? WHERE attempt_id=? AND participant_id=? AND session_id IN (SELECT session_id FROM work_session WHERE status='ENDED' AND privacy_status='CLEAR')",input.visitCount(),input.lastSequence(),attempt.toString(),owner.toString())!=1)throw new AccessDenied(404);
    }
}
