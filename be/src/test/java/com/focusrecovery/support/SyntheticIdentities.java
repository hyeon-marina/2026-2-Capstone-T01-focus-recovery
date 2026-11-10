package com.focusrecovery.support;

import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import com.focusrecovery.domain.identity.*;
import com.focusrecovery.domain.session.entity.WorkSession;

/** Explicit synthetic enrollment. Uses the production token verifier, consent and ownership tables. */
public final class SyntheticIdentities {
    public static final UUID ALICE = UUID.fromString("95000000-0000-4000-8000-000000000001");
    public static final UUID BOB = UUID.fromString("95000000-0000-4000-8000-000000000002");
    public static final String TOKEN = "synthetic-only-alice-credential-95-01234567890123456789";
    public static final String BOB_TOKEN = "synthetic-only-bob-credential-95-012345678901234567890";
    public static final UUID CONSENT = UUID.fromString("95000000-0000-4000-8000-000000000003");
    private SyntheticIdentities() {}
    public static void seed(JdbcTemplate jdbc) {
        if (jdbc.queryForObject("SELECT COUNT(*) FROM consent_policy WHERE policy_id='SYNTHETIC-NO-CONSENT-CLAIM'", Integer.class) == 0)
            jdbc.update("INSERT INTO consent_policy VALUES('SYNTHETIC-NO-CONSENT-CLAIM','1','SESSION_COLLECTION','Synthetic tests only','Closed catalog page and behavior fixtures','No research or participant data',NULL,NULL,'SYNTHETIC',?)", Timestamp.from(Instant.EPOCH));
        for (UUID owner : List.of(ALICE,BOB)) {
            String token = owner.equals(ALICE) ? TOKEN : BOB_TOKEN;
            if (jdbc.queryForObject("SELECT COUNT(*) FROM participant WHERE participant_id=?", Integer.class, owner.toString()) == 0)
                jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)", owner.toString(), AuthenticationService.digest("synthetic-enrollment:"+owner), Timestamp.from(Instant.EPOCH));
            if (jdbc.queryForObject("SELECT COUNT(*) FROM access_credential WHERE token_hash=?", Integer.class, AuthenticationService.digest(token)) == 0)
                jdbc.update("INSERT INTO access_credential(token_hash,participant_id,expires_at) VALUES(?,?,?)", AuthenticationService.digest(token), owner.toString(), Timestamp.from(Instant.parse("2099-01-01T00:00:00Z")));
            UUID id = owner.equals(ALICE) ? CONSENT : UUID.fromString("95000000-0000-4000-8000-000000000004");
            if (jdbc.queryForObject("SELECT COUNT(*) FROM consent_record WHERE consent_id=?", Integer.class, id.toString()) == 0)
                jdbc.update("INSERT INTO consent_record(consent_id,participant_id,policy_id,policy_version,request_id,accepted_at) VALUES(?,?,'SYNTHETIC-NO-CONSENT-CLAIM','1',?,?)", id.toString(), owner.toString(), UUID.randomUUID().toString(), Timestamp.from(Instant.EPOCH));
        }
    }
    public static void bind() { AuthenticatedParticipant.bind(new AuthenticatedParticipant(ALICE, AuthenticationService.digest(TOKEN), Instant.parse("2099-01-01T00:00:00Z"))); }
    public static WorkSession start(String goal, String key) {
        var s = WorkSession.start(goal,key); s.assignOwner(ALICE,CONSENT); return s;
    }
}
