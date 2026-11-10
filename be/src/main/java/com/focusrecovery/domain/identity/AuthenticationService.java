package com.focusrecovery.domain.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Validates opaque credentials provisioned by a trusted enrollment process, never by a user ID. */
@Service
public class AuthenticationService {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    public AuthenticationService(JdbcTemplate jdbc, Clock clock) { this.jdbc = jdbc; this.clock = clock; }
    public static String digest(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(); }
    }
    public AuthenticatedParticipant authenticate(String header) {
        if (header == null || !header.matches("Bearer [A-Za-z0-9_-]{43,128}")) throw new AccessDenied(401);
        String hash = digest(header.substring(7));
        var found = jdbc.query("SELECT c.participant_id, c.expires_at FROM access_credential c JOIN participant p ON p.participant_id=c.participant_id WHERE c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>? AND p.status='ACTIVE'",
            (rs, n) -> new AuthenticatedParticipant(UUID.fromString(rs.getString(1)), hash, rs.getTimestamp(2).toInstant()), hash, java.sql.Timestamp.from(clock.instant()));
        if (found.size() != 1) throw new AccessDenied(401);
        return found.getFirst();
    }
    public void logout() {
        jdbc.update("UPDATE access_credential SET revoked_at=? WHERE token_hash=?", java.sql.Timestamp.from(clock.instant()), AuthenticatedParticipant.required().tokenHash());
    }
    public void requireOwner(UUID sessionId) {
        if (jdbc.queryForObject("SELECT COUNT(*) FROM work_session WHERE session_id=? AND owner_participant_id=?", Integer.class,
            sessionId.toString(), AuthenticatedParticipant.required().participantId().toString()) != 1) throw new com.focusrecovery.domain.session.exception.SessionNotFoundException();
    }
}
