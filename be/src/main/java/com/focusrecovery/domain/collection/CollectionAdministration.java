package com.focusrecovery.domain.collection;

import com.focusrecovery.domain.identity.*;
import com.focusrecovery.global.exception.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CollectionAdministration {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final boolean enabled;
    public CollectionAdministration(JdbcTemplate jdbc, Clock clock,
        @Value("${focus-recovery.collection.administration-enabled:false}") boolean enabled) {
        this.jdbc=jdbc; this.clock=clock; this.enabled=enabled;
    }
    public UUID requireOperator() {
        var actor=AuthenticatedParticipant.required();
        if (!enabled || jdbc.queryForObject("SELECT COUNT(*) FROM collection_operator o JOIN participant p ON p.participant_id=o.participant_id JOIN access_credential c ON c.participant_id=p.participant_id WHERE o.participant_id=? AND o.revoked_at IS NULL AND p.status='ACTIVE' AND p.withdrawn_at IS NULL AND c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>?", Integer.class,
            actor.participantId().toString(),actor.tokenHash(),Timestamp.from(clock.instant()))!=1) throw new AccessDenied(403);
        return actor.participantId();
    }
    public void audit(String action,String target,String evidence) {
        jdbc.update("INSERT INTO collection_audit VALUES(?,?,?,?,?,?)",UUID.randomUUID().toString(),requireOperator().toString(),action,target,reference(evidence),Timestamp.from(clock.instant()));
    }
    static String reference(String value) {
        if(value==null || !value.matches("[A-Za-z0-9][A-Za-z0-9:/._#-]{0,254}")) throw new InvalidRequestException("민감 원문 없는 증거 식별자가 필요합니다.");
        return value;
    }
    public record Enrollment(String identityReferenceHash,String evidenceRef) {}
    @Transactional public Map<String,Object> enroll(Enrollment input) {
        requireOperator();
        if(input==null || input.identityReferenceHash()==null || !input.identityReferenceHash().matches("[a-f0-9]{64}")) throw new InvalidRequestException("신뢰된 등록 연결표의 해시가 필요합니다.");
        reference(input.evidenceRef());
        jdbc.queryForList("SELECT guard_id FROM collection_bootstrap_guard WHERE guard_id=1 FOR UPDATE");
        var existing=jdbc.queryForList("SELECT participant_id FROM participant WHERE identity_reference_hash=?",String.class,input.identityReferenceHash());
        String id=existing.isEmpty()?UUID.randomUUID().toString():existing.getFirst();
        if(existing.isEmpty()) jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",id,input.identityReferenceHash(),Timestamp.from(clock.instant()));
        audit("ENROLL",id,input.evidenceRef());
        return Map.of("participantId",id);
    }
    public record Issue(Instant expiresAt,String evidenceRef) {}
    public record IssuedCredential(String credentialId,String participantId,String credential,Instant expiresAt) {
        @Override public String toString() { return "IssuedCredential[redacted]"; }
    }
    @Transactional public IssuedCredential issue(UUID participant,Issue input) {
        requireOperator();
        if(input==null || input.expiresAt()==null || !input.expiresAt().isAfter(clock.instant()) || input.expiresAt().isAfter(clock.instant().plus(Duration.ofDays(1)))) throw new InvalidRequestException("기술적 발급 한도는 현재부터 24시간 이내입니다.");
        reference(input.evidenceRef());
        var owner=jdbc.queryForList("SELECT status FROM participant WHERE participant_id=? AND withdrawn_at IS NULL FOR UPDATE",String.class,participant.toString());
        if(!owner.equals(List.of("ACTIVE"))) throw new AccessDenied(404);
        byte[] random=new byte[32];new java.security.SecureRandom().nextBytes(random);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(random), hash=AuthenticationService.digest(token);
        audit("ISSUE_CREDENTIAL",hash,input.evidenceRef());
        // Rotation is atomic; a lost response is resolved by issuing a fresh credential, never recovering plaintext.
        jdbc.update("UPDATE access_credential SET revoked_at=? WHERE participant_id=? AND revoked_at IS NULL",Timestamp.from(clock.instant()),participant.toString());
        jdbc.update("INSERT INTO access_credential(token_hash,participant_id,expires_at) VALUES(?,?,?)",hash,participant.toString(),Timestamp.from(input.expiresAt()));
        return new IssuedCredential(hash,participant.toString(),token,input.expiresAt());
    }
    @Transactional public void revoke(String hash,String evidence) {
        requireOperator();if(hash==null || !hash.matches("[a-f0-9]{64}")) throw new InvalidRequestException("인증정보 식별자가 필요합니다.");
        reference(evidence);
        audit("REVOKE_CREDENTIAL",hash,evidence);
        jdbc.update("UPDATE access_credential SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",Timestamp.from(clock.instant()),hash);
    }
    @Transactional public List<Map<String,Object>> auditLog() {
        requireOperator();audit("READ_AUDIT","collection","operator-console");
        return jdbc.queryForList("SELECT event_id,actor_id,action,target_id,evidence_ref,occurred_at FROM collection_audit ORDER BY occurred_at DESC,event_id LIMIT 500");
    }
}
