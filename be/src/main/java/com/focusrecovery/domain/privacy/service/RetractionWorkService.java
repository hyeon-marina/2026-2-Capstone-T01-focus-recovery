package com.focusrecovery.domain.privacy.service;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import com.focusrecovery.domain.privacy.entity.*;
import com.focusrecovery.domain.privacy.repository.*;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.global.config.V2StorageGate;

@Service
public class RetractionWorkService {
    private final WorkSessionRepository sessions;
    private final PrivacyRetractionRepository jobs;
    private final RetractionTargetRepository targets;
    private final RetractionExecutionPolicy policy;
    private final V2StorageGate gate;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    public RetractionWorkService(WorkSessionRepository sessions, PrivacyRetractionRepository jobs,
        RetractionTargetRepository targets, RetractionExecutionPolicy policy, V2StorageGate gate, JdbcTemplate jdbc, Clock clock) {
        this.sessions = sessions; this.jobs = jobs; this.targets = targets; this.policy = policy; this.gate = gate; this.jdbc = jdbc; this.clock = clock;
    }
    public record Claim(RetractionTargetId id, UUID sessionId, UUID visitId, UUID token) {}
    @Transactional
    public Claim claim(RetractionTargetId id) {
        gate.requireEnabled();
        var job = jobs.findById(id.retractionId()).orElseThrow();
        var session = sessions.findForUpdateBySessionId(job.getSessionId()).orElseThrow();
        gate.requireV2(session);
        if (!session.isQuarantined()) throw new IllegalStateException("PRIVACY_GUARD_REQUIRED");
        var target = targets.findById(id).orElseThrow();
        if (!target.due(now())) return null;
        if (!Set.of("BE_PAYLOADS", "AI_CACHE_AND_MEMORY").contains(id.targetType())) { target.blocked(); return null; }
        if (!policy.permitsSyntheticExecution(session.getSessionId())) { target.blocked(); return null; }
        return new Claim(id, job.getSessionId(), job.getVisitId(), target.claim(now()));
    }
    @Transactional
    public void scrub(Claim claim) {
        var target = owned(claim);
        if (target == null) return;
        if (!policy.permitsSyntheticExecution(claim.sessionId())) { target.blocked(); return; }
        String session = claim.sessionId().toString(), visit = claim.visitId().toString();
        // Keep FK/UNIQUE skeletons and actual shown/response facts. Synthetic policy only; never a production retention decision.
        jdbc.update("UPDATE page_visit SET title=NULL, content=NULL, search_query=NULL, normalized_url='', domain='', browser_tab_key='' WHERE visit_id=? AND session_id=?", visit, session);
        jdbc.update("UPDATE compose_request SET input_snapshot='{}', response_snapshot=NULL, receipt=NULL WHERE session_id=?", session);
        String analysisScope = "window_id IN (SELECT window_id FROM analysis_window WHERE session_id=?)";
        jdbc.update("UPDATE analysis_result SET input_snapshot=NULL, feature_snapshot=NULL, context_result=NULL, page_results=NULL, response_snapshot=NULL, model_versions=NULL, result=NULL, p_normal=NULL, p_transition=NULL, p_drift=NULL, context_used=NULL WHERE " + analysisScope, session);
        jdbc.update("UPDATE window_state_history SET behavior_snapshot='[]' WHERE " + analysisScope, session);
        jdbc.update("UPDATE notification SET message='' WHERE session_id=?", session);
        jdbc.update("UPDATE work_session SET goal_text='' WHERE session_id=?", session);
        int remaining = jdbc.queryForObject("SELECT COUNT(*) FROM page_visit WHERE visit_id=? AND session_id=? AND (title IS NOT NULL OR content IS NOT NULL OR search_query IS NOT NULL OR normalized_url<>'' OR domain<>'' OR browser_tab_key<>'')", Integer.class, visit, session)
            + jdbc.queryForObject("SELECT COUNT(*) FROM analysis_result WHERE " + analysisScope + " AND (input_snapshot IS NOT NULL OR feature_snapshot IS NOT NULL OR context_result IS NOT NULL OR page_results IS NOT NULL OR response_snapshot IS NOT NULL OR model_versions IS NOT NULL)", Integer.class, session)
            + jdbc.queryForObject("SELECT COUNT(*) FROM compose_request WHERE session_id=? AND (response_snapshot IS NOT NULL OR receipt IS NOT NULL)", Integer.class, session)
            + jdbc.queryForObject("SELECT COUNT(*) FROM notification WHERE session_id=? AND message<>''", Integer.class, session)
            + jdbc.queryForObject("SELECT COUNT(*) FROM work_session WHERE session_id=? AND goal_text<>''", Integer.class, session);
        // Compare JSON via Java for identical H2/MySQL semantics (H2's native JSON literal representation differs).
        for (String value : jdbc.queryForList("SELECT input_snapshot FROM compose_request WHERE session_id=?", String.class, session))
            if (!emptyJson(value, "{}")) remaining++;
        for (String value : jdbc.queryForList("SELECT behavior_snapshot FROM window_state_history WHERE " + analysisScope, String.class, session))
            if (!emptyJson(value, "[]")) remaining++;
        if (remaining != 0) throw new IllegalStateException("PAYLOAD_VERIFICATION_FAILED");
        for (var item : targets.findByIdRetractionId(claim.id().retractionId())) {
            switch (item.getId().targetType()) {
                case "BE_PAYLOADS", "PAGE_VISIT", "ANALYSIS_PAYLOAD", "COMPOSE_SNAPSHOT_RECEIPT", "WINDOW_STATE_HISTORY", "SESSION_PAYLOAD", "NOTIFICATION_AND_RESPONSE" -> item.verified("SYNTHETIC_DB_PAYLOAD_ABSENCE_VERIFIED", now());
                case "WINDOW", "ANALYSIS_OUTBOX", "ALERT_TASK" -> item.verified("INVALIDATED_METADATA_RETAINED", now());
                default -> { }
            }
        }
        // No PURGED transition: local copies, logs, exports, models, backups and policy approvals remain unverified.
    }
    private boolean emptyJson(String value, String expected) { return expected.equals(value) || ("\"" + expected + "\"").equals(value); }
    public enum AiOutcome {
        CONFIRMED, PROPAGATION_UNCONFIRMED,
        AI_RETRACTION_AUTH_NOT_CONFIGURED, AI_RETRACTION_DESTINATION_BLOCKED,
        AI_RETRACTION_UNREACHABLE, AI_RETRACTION_TIMEOUT, AI_RETRACTION_AUTH_REJECTED,
        AI_RETRACTION_HTTP_REJECTED, AI_RETRACTION_INVALID_ACK, AI_RETRACTION_INTERRUPTED
    }
    @Transactional
    public void finishAi(Claim claim, boolean confirmed) {
        finishAi(claim, confirmed ? AiOutcome.CONFIRMED : AiOutcome.PROPAGATION_UNCONFIRMED);
    }
    @Transactional
    public void finishAi(Claim claim, AiOutcome outcome) {
        var target = owned(claim); if (target == null) return;
        if (outcome == AiOutcome.CONFIRMED) target.verified("AI_DURABLE_QUARANTINE_ACK_ONLY", now());
        else {
            target.retry(now(), outcome.name());
            jobs.findById(claim.id().retractionId()).orElseThrow().recordFailure(outcome.name());
        }
        // Parent attempts/error retain the last failure history; only target status proves recovery.
    }
    @Transactional
    public void failPayload(Claim claim) {
        var target = owned(claim); if (target == null) return;
        target.retry(now(), "PAYLOAD_DELETE_FAILED");
        jobs.findById(claim.id().retractionId()).orElseThrow().recordFailure("PAYLOAD_DELETE_FAILED");
    }
    private RetractionTarget owned(Claim claim) {
        gate.requireEnabled();
        var session = sessions.findForUpdateBySessionId(claim.sessionId()).orElseThrow();
        gate.requireV2(session);
        if (!session.isQuarantined()) throw new IllegalStateException("PRIVACY_GUARD_REQUIRED");
        var target = targets.findById(claim.id()).orElseThrow();
        return target.owns(claim.token(), now()) ? target : null;
    }
    public record Completion(String status, List<String> missing) {}
    @Transactional(readOnly = true)
    public Completion completion(UUID retractionId) {
        var job = jobs.findById(retractionId).orElseThrow();
        var missing = new ArrayList<String>();
        missing.add("APPROVED_SCOPE_AND_RETENTION_POLICY");
        missing.add("RESPONSIBLE_REVIEWER_AND_FULL_DELETION_EVIDENCE");
        missing.add("AI_GPU_MEMORY_AND_MODEL_IMPACT_UNVERIFIED");
        for (var target : targets.findByIdRetractionId(retractionId))
            if (!"VERIFIED".equals(target.getProcessingStatus())) missing.add(target.getId().targetType());
        return new Completion("QUARANTINED", List.copyOf(missing));
    }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MILLIS); }
}
