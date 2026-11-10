package com.focusrecovery.domain.consent;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.focusrecovery.domain.identity.*;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.global.exception.ConflictException;

@Service
public class ConsentService {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final Environment environment;
    public ConsentService(JdbcTemplate jdbc, Clock clock, Environment environment) { this.jdbc = jdbc; this.clock = clock; this.environment = environment; }
    public record Policy(String policyId, String policyVersion, String scope, String purpose, String collectionItems,
        String useScope, String retentionPolicyRef, String approvalRef, String status, Instant effectiveAt) {}
    public record State(UUID participantId, Policy policy, UUID consentId, boolean consentValid, boolean collectionEnabled, boolean withdrawn) {}
    public record Accept(UUID requestId, String policyId, String policyVersion, Boolean accepted) {}
    private boolean synthetic() { return Arrays.equals(environment.getActiveProfiles(), new String[]{"test"}); }
    public Policy policy() {
        var policies = jdbc.query("SELECT * FROM consent_policy WHERE scope='SESSION_COLLECTION' AND effective_at<=? ORDER BY effective_at DESC, policy_version DESC LIMIT 2",
            (rs,n) -> new Policy(rs.getString("policy_id"), rs.getString("policy_version"), rs.getString("scope"), rs.getString("purpose"), rs.getString("collection_items"),
                rs.getString("use_scope"), rs.getString("retention_policy_ref"), rs.getString("approval_ref"), rs.getString("status"), rs.getTimestamp("effective_at").toInstant()), Timestamp.from(clock.instant()));
        if (policies.isEmpty() || policies.size() > 1 && policies.get(0).effectiveAt().equals(policies.get(1).effectiveAt())) return null;
        return policies.getFirst();
    }
    private boolean usable(Policy policy) {
        return policy != null && (policy.status().equals("SYNTHETIC") && synthetic()
            || policy.status().equals("APPROVED") && policy.approvalRef() != null && !policy.approvalRef().isBlank()
                && policy.retentionPolicyRef() != null && !policy.retentionPolicyRef().isBlank());
    }
    public void lockParticipant(UUID owner) {
        if (jdbc.query("SELECT participant_id FROM participant WHERE participant_id=? FOR UPDATE", (rs,n) -> rs.getString(1), owner.toString()).size() != 1) throw new AccessDenied(401);
    }
    public boolean withdrawn(UUID owner) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM participant WHERE participant_id=? AND status='ACTIVE' AND withdrawn_at IS NULL", Integer.class, owner.toString()) != 1;
    }
    private boolean authenticatedAuthority(UUID owner) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM access_credential WHERE participant_id=? AND revoked_at IS NULL AND expires_at>?", Integer.class, owner.toString(), Timestamp.from(clock.instant())) > 0;
    }
    public UUID validConsent(UUID owner) {
        Policy policy = policy();
        if (!usable(policy) || withdrawn(owner) || !authenticatedAuthority(owner)) return null;
        return jdbc.query("SELECT consent_id FROM consent_record WHERE participant_id=? AND policy_id=? AND policy_version=? AND withdrawn_at IS NULL",
            (rs,n) -> UUID.fromString(rs.getString(1)), owner.toString(), policy.policyId(), policy.policyVersion()).stream().findFirst().orElse(null);
    }
    public UUID requireConsent(UUID owner) {
        UUID id = validConsent(owner);
        if (id == null) throw new ConflictException("CONSENT_REQUIRED", "현재 정책의 유효한 동의가 필요합니다.");
        return id;
    }
    public void requireOwnership(WorkSession session) {
        var principal = AuthenticatedParticipant.current();
        if (principal != null && (!principal.participantId().equals(session.getOwnerParticipantId())
            || jdbc.queryForObject("SELECT COUNT(*) FROM access_credential WHERE token_hash=? AND participant_id=? AND revoked_at IS NULL AND expires_at>?", Integer.class,
                principal.tokenHash(), principal.participantId().toString(), Timestamp.from(clock.instant())) != 1))
            throw new com.focusrecovery.domain.session.exception.SessionNotFoundException();
    }
    public void requireSession(WorkSession session) {
        requireOwnership(session);
        if (session.getOwnerParticipantId() == null || session.getConsentId() == null
            || !session.getConsentId().equals(validConsent(session.getOwnerParticipantId())))
            throw new ConflictException("CONSENT_REQUIRED", "현재 정책의 유효한 동의가 필요합니다.");
    }
    @Transactional(readOnly=true) public State state() {
        UUID owner = AuthenticatedParticipant.required().participantId();
        UUID id = validConsent(owner);
        // Even an approved policy cannot activate production: exact test profile remains necessary.
        return new State(owner, policy(), id, id != null, id != null && synthetic() && environment.getProperty("focus-recovery.v2.storage.enabled", Boolean.class, false), withdrawn(owner));
    }
    @Transactional public State accept(Accept input) {
        UUID owner = AuthenticatedParticipant.required().participantId(); lockParticipant(owner);
        if (input == null || input.requestId() == null || input.requestId().version() != 4 || input.requestId().variant() != 2
            || !Boolean.TRUE.equals(input.accepted()) || input.policyId() == null || input.policyVersion() == null)
            throw new com.focusrecovery.global.exception.InvalidRequestException("명시적인 동의와 정책 버전이 필요합니다.");
        Policy current = policy();
        if (!usable(current) || !current.policyId().equals(input.policyId()) || !current.policyVersion().equals(input.policyVersion()) || withdrawn(owner))
            throw new ConflictException("CONSENT_POLICY_UNAVAILABLE", "동의할 수 없는 정책입니다.");
        var replay = jdbc.query("SELECT c.policy_id, c.policy_version FROM consent_event e JOIN consent_record c ON c.consent_id=e.consent_id WHERE e.participant_id=? AND e.request_id=?", (rs,n) -> List.of(rs.getString(1), rs.getString(2)), owner.toString(), input.requestId().toString());
        if (!replay.isEmpty()) {
            if (!replay.getFirst().equals(List.of(input.policyId(), input.policyVersion()))) throw new ConflictException("CONSENT_REQUEST_CONFLICT", "같은 동의 요청 ID가 사용되었습니다.");
            return state();
        }
        UUID consent = validConsent(owner);
        Timestamp now = Timestamp.from(clock.instant());
        if (consent == null) {
            consent = UUID.randomUUID();
            jdbc.update("INSERT INTO consent_record(consent_id, participant_id, policy_id, policy_version, request_id, accepted_at) VALUES(?,?,?,?,?,?)",
                consent.toString(), owner.toString(), current.policyId(), current.policyVersion(), input.requestId().toString(), now);
        }
        jdbc.update("INSERT INTO consent_event(event_id,participant_id,request_id,consent_id,event_type,occurred_at) VALUES(?,?,?,?,'ACCEPTED',?)",
            UUID.randomUUID().toString(), owner.toString(), input.requestId().toString(), consent.toString(), now);
        return state();
    }
}
