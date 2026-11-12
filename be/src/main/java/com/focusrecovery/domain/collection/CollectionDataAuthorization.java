package com.focusrecovery.domain.collection;

/** Shared read authorization for raw progress, export and current privacy snapshots. */
final class CollectionDataAuthorization {
    private CollectionDataAuthorization() {}
    // Only the reviewed v5 -> v6 release pair grants continued use of historical raw text.
    static final String CONSENT = """
        EXISTS (
          SELECT 1 FROM consent_record past
          JOIN consent_record present ON present.participant_id=past.participant_id
          LEFT JOIN session_collection_scope scope ON scope.session_id=s.session_id
          LEFT JOIN collection_local_owner owner ON owner.participant_id=past.participant_id
          WHERE past.consent_id=s.consent_id AND past.participant_id=s.owner_participant_id
          AND past.withdrawn_at IS NULL
          AND present.consent_id=? AND present.withdrawn_at IS NULL
          AND (past.consent_id=present.consent_id OR (past.accepted_at<=s.started_at
          AND past.policy_id='focus-team-raw-v2' AND past.policy_version='5'
          AND present.policy_id=past.policy_id AND present.policy_version='6'
          AND scope.policy_digest='2d54a38acb72f8e39d84313f1ba5d807ff39971cf53eff4ba6d615a6da669d67'
          AND owner.policy_digest='31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982')))
        """;
    static final String CLEAR = "s.privacy_status='CLEAR' AND NOT EXISTS(SELECT 1 FROM visit_tombstone x WHERE x.session_id=s.session_id)";
}
