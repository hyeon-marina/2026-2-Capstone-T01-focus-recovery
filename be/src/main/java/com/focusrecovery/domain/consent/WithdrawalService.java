package com.focusrecovery.domain.consent;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.focusrecovery.domain.identity.*;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.privacy.service.PrivacyRetractionService;
import com.focusrecovery.domain.privacy.dto.Retraction;
import com.focusrecovery.global.exception.*;

@Service
public class WithdrawalService {
    private final JdbcTemplate jdbc;
    private final ConsentService consent;
    private final WorkSessionRepository sessions;
    private final PrivacyRetractionService retractions;
    private final Clock clock;
    public WithdrawalService(JdbcTemplate jdbc, ConsentService consent, WorkSessionRepository sessions, PrivacyRetractionService retractions, Clock clock) {
        this.jdbc = jdbc; this.consent = consent; this.sessions = sessions; this.retractions = retractions; this.clock = clock;
    }
    public record SessionStatus(UUID sessionId, String status, int attempts, String errorCode) {}
    public record TargetStatus(UUID retractionId, String targetType, String targetId, String processingStatus, String evidenceCode, String errorCode, int attempts, Instant verifiedAt) {}
    public record Receipt(UUID requestId, UUID withdrawalId, String status, List<SessionStatus> sessions, List<TargetStatus> targets, List<String> unmet) {}
    @Transactional public Receipt accept(UUID requestId) {
        if (requestId == null || requestId.version() != 4 || requestId.variant() != 2) throw new InvalidRequestException("철회 요청 ID가 필요합니다.");
        UUID owner = AuthenticatedParticipant.required().participantId(); consent.lockParticipant(owner);
        var previous = jdbc.query("SELECT withdrawal_id FROM consent_withdrawal WHERE participant_id=?", (rs,n) -> UUID.fromString(rs.getString(1)), owner.toString());
        if (!previous.isEmpty()) {
            var receipt = status(previous.getFirst());
            return new Receipt(requestId, receipt.withdrawalId(), receipt.status(), receipt.sessions(), receipt.targets(), receipt.unmet());
        }
        if (jdbc.queryForObject("SELECT COUNT(*) FROM consent_withdrawal WHERE withdrawal_id=?", Integer.class, requestId.toString()) != 0
            || jdbc.queryForObject("SELECT COUNT(*) FROM consent_event WHERE participant_id=? AND request_id=?", Integer.class, owner.toString(), requestId.toString()) != 0)
            throw new ConflictException("WITHDRAWAL_REQUEST_CONFLICT", "철회 요청을 적용할 수 없습니다.");
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        jdbc.update("INSERT INTO consent_withdrawal VALUES(?,?,?,'QUARANTINED')", requestId.toString(), owner.toString(), Timestamp.from(now));
        jdbc.update("UPDATE participant SET withdrawn_at=? WHERE participant_id=?", Timestamp.from(now), owner.toString());
        jdbc.update("UPDATE consent_record SET withdrawn_at=? WHERE participant_id=? AND withdrawn_at IS NULL", Timestamp.from(now), owner.toString());
        jdbc.update("INSERT INTO consent_event(event_id,participant_id,request_id,event_type,occurred_at) VALUES(?,?,?,'WITHDRAWN',?)",
            UUID.randomUUID().toString(), owner.toString(), requestId.toString(), Timestamp.from(now));
        // Participant lock serializes create/consent/withdrawal; session locks serialize POST, ACK and AI commit.
        for (var id : jdbc.query("SELECT session_id FROM work_session WHERE owner_participant_id=? ORDER BY session_id", (rs,n) -> UUID.fromString(rs.getString(1)), owner.toString())) {
            retractions.quarantineOwnedSession(id);
            jdbc.update("INSERT INTO withdrawal_session(withdrawal_id,session_id,processing_status) VALUES(?,?,'PENDING')", requestId.toString(), id.toString());
        }
        return status(requestId);
    }
    @Transactional(readOnly=true) public Receipt status(UUID id) {
        UUID owner = AuthenticatedParticipant.required().participantId();
        if (jdbc.queryForObject("SELECT COUNT(*) FROM consent_withdrawal WHERE withdrawal_id=? AND participant_id=?", Integer.class, id.toString(), owner.toString()) != 1) throw new AccessDenied(404);
        var rows = jdbc.query("SELECT session_id,processing_status,attempts,error_code FROM withdrawal_session WHERE withdrawal_id=? ORDER BY session_id",
            (rs,n) -> new SessionStatus(UUID.fromString(rs.getString(1)), rs.getString(2), rs.getInt(3), rs.getString(4)), id.toString());
        var targets = jdbc.query("SELECT t.retraction_id,t.target_type,t.target_id,t.processing_status,t.evidence_code,t.error_code,t.attempts,t.verified_at FROM retraction_target t JOIN withdrawal_retraction w ON w.retraction_id=t.retraction_id WHERE w.withdrawal_id=? ORDER BY t.retraction_id,t.target_type,t.target_id",
            (rs,n) -> new TargetStatus(UUID.fromString(rs.getString(1)),rs.getString(2),rs.getString(3),rs.getString(4),rs.getString(5),rs.getString(6),rs.getInt(7),rs.getTimestamp(8)==null ? null : rs.getTimestamp(8).toInstant()), id.toString());
        return new Receipt(id, id, "QUARANTINED", rows, targets, List.of("APPROVED_RETENTION_POLICY", "CLIENT_LOCAL_COPIES", "EXPORT_TRAINING_LOG_BACKUP_EVIDENCE", "ALL_AI_WORKERS_AND_MODEL_IMPACT"));
    }
    // Each session is one restartable transaction; retry never releases quarantine.
    @Transactional public void inventory(UUID withdrawalId, UUID sessionId) {
        var session = sessions.findForUpdateBySessionId(sessionId).orElseThrow();
        var found = jdbc.queryForList("SELECT processing_status FROM withdrawal_session WHERE withdrawal_id=? AND session_id=? FOR UPDATE", withdrawalId.toString(), sessionId.toString());
        if (found.isEmpty() || !session.isQuarantined() || jdbc.queryForObject("SELECT COUNT(*) FROM consent_withdrawal WHERE withdrawal_id=? AND participant_id=?", Integer.class, withdrawalId.toString(), session.getOwnerParticipantId().toString()) != 1) throw new IllegalStateException();
        if ("INVENTORIED".equals(found.getFirst().get("processing_status"))) return;
        if (!session.isV2()) {
            jdbc.update("UPDATE withdrawal_session SET processing_status='BLOCKED',error_code='V1_PAYLOAD_REVIEW_REQUIRED',attempts=attempts+1 WHERE withdrawal_id=? AND session_id=?", withdrawalId.toString(), sessionId.toString()); return;
        }
        Instant at = jdbc.queryForObject("SELECT requested_at FROM consent_withdrawal WHERE withdrawal_id=?", Timestamp.class, withdrawalId.toString()).toInstant();
        for (UUID visit : jdbc.query("SELECT visit_id FROM page_visit WHERE session_id=? ORDER BY sequence", (rs,n) -> UUID.fromString(rs.getString(1)), sessionId.toString())) {
            UUID child = childId(withdrawalId, visit);
            retractions.quarantine(sessionId, new Retraction.Request(child, visit, "CONSENT_WITHDRAWN", at));
            if (jdbc.queryForObject("SELECT COUNT(*) FROM withdrawal_retraction WHERE withdrawal_id=? AND retraction_id=?", Integer.class, withdrawalId.toString(), child.toString()) == 0)
                jdbc.update("INSERT INTO withdrawal_retraction VALUES(?,?)", withdrawalId.toString(), child.toString());
        }
        jdbc.update("UPDATE withdrawal_session SET processing_status='INVENTORIED',error_code=NULL,attempts=attempts+1 WHERE withdrawal_id=? AND session_id=?", withdrawalId.toString(), sessionId.toString());
    }
    private static UUID childId(UUID parent, UUID visit) {
        byte[] b = java.util.HexFormat.of().parseHex(AuthenticationService.digest(parent + ":" + visit).substring(0,32));
        b[6] = (byte)((b[6] & 15) | 64); b[8] = (byte)((b[8] & 63) | 128);
        var bytes = java.nio.ByteBuffer.wrap(b); return new UUID(bytes.getLong(), bytes.getLong());
    }
    @Transactional public void failed(UUID withdrawalId, UUID sessionId) {
        jdbc.update("UPDATE withdrawal_session SET attempts=attempts+1,error_code='INVENTORY_FAILED' WHERE withdrawal_id=? AND session_id=? AND processing_status='PENDING'", withdrawalId.toString(), sessionId.toString());
    }
}
