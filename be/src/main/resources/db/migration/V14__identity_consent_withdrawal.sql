-- Additive only. No identity assignment or consent backfill for existing sessions.
CREATE TABLE participant (
 participant_id CHAR(36) PRIMARY KEY,
 identity_reference_hash CHAR(64) NOT NULL UNIQUE,
 status VARCHAR(20) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 withdrawn_at DATETIME(3) NULL
);
-- Identity provider/enrollment mapping stays outside analysis payloads. No raw identity or token.
CREATE TABLE access_credential (
 token_hash CHAR(64) PRIMARY KEY,
 participant_id CHAR(36) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 revoked_at DATETIME(3) NULL,
 CONSTRAINT fk_credential_participant FOREIGN KEY (participant_id) REFERENCES participant(participant_id)
);
CREATE INDEX idx_credential_owner ON access_credential(participant_id, expires_at);
CREATE TABLE consent_policy (
 policy_id VARCHAR(100) NOT NULL,
 policy_version VARCHAR(100) NOT NULL,
 scope VARCHAR(100) NOT NULL,
 purpose TEXT NOT NULL,
 collection_items TEXT NOT NULL,
 use_scope TEXT NOT NULL,
 retention_policy_ref VARCHAR(255) NULL,
 approval_ref VARCHAR(255) NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
 effective_at DATETIME(3) NOT NULL,
 PRIMARY KEY (policy_id, policy_version),
 CONSTRAINT ck_consent_policy_status CHECK (status='DRAFT' OR status='SYNTHETIC' OR status='APPROVED' OR status='RETIRED')
);
CREATE TABLE consent_record (
 consent_id CHAR(36) PRIMARY KEY,
 participant_id CHAR(36) NOT NULL,
 policy_id VARCHAR(100) NOT NULL,
 policy_version VARCHAR(100) NOT NULL,
 request_id CHAR(36) NOT NULL,
 accepted_at DATETIME(3) NOT NULL,
 withdrawn_at DATETIME(3) NULL,
 CONSTRAINT uq_consent_owner_id UNIQUE (participant_id, consent_id),
 CONSTRAINT uq_consent_request UNIQUE (participant_id, request_id),
 CONSTRAINT uq_consent_policy_owner UNIQUE (participant_id, policy_id, policy_version),
 CONSTRAINT fk_consent_owner FOREIGN KEY (participant_id) REFERENCES participant(participant_id),
 CONSTRAINT fk_consent_policy FOREIGN KEY (policy_id, policy_version) REFERENCES consent_policy(policy_id, policy_version)
);
CREATE TABLE consent_event (
 event_id CHAR(36) PRIMARY KEY,
 participant_id CHAR(36) NOT NULL,
 request_id CHAR(36) NOT NULL,
 consent_id CHAR(36) NULL,
 event_type VARCHAR(20) NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 CONSTRAINT uq_consent_event_request UNIQUE (participant_id, request_id),
 CONSTRAINT fk_event_owner FOREIGN KEY (participant_id) REFERENCES participant(participant_id),
 CONSTRAINT fk_event_consent FOREIGN KEY (consent_id) REFERENCES consent_record(consent_id)
);
ALTER TABLE work_session ADD COLUMN owner_participant_id CHAR(36) NULL;
ALTER TABLE work_session ADD COLUMN consent_id CHAR(36) NULL;
ALTER TABLE work_session ADD CONSTRAINT fk_session_owner FOREIGN KEY (owner_participant_id) REFERENCES participant(participant_id);
ALTER TABLE work_session ADD CONSTRAINT fk_session_consent FOREIGN KEY (consent_id) REFERENCES consent_record(consent_id);
ALTER TABLE work_session ADD CONSTRAINT fk_session_consent_owner FOREIGN KEY (owner_participant_id, consent_id) REFERENCES consent_record(participant_id, consent_id);
ALTER TABLE work_session ADD CONSTRAINT ck_session_owner_consent CHECK ((owner_participant_id IS NULL AND consent_id IS NULL) OR (owner_participant_id IS NOT NULL AND consent_id IS NOT NULL));
CREATE INDEX idx_session_owner ON work_session(owner_participant_id, session_id);
CREATE TABLE consent_withdrawal (
 withdrawal_id CHAR(36) PRIMARY KEY,
 participant_id CHAR(36) NOT NULL UNIQUE,
 requested_at DATETIME(3) NOT NULL,
 processing_status VARCHAR(20) NOT NULL,
 CONSTRAINT fk_withdrawal_owner FOREIGN KEY (participant_id) REFERENCES participant(participant_id),
 CONSTRAINT ck_withdrawal_quarantine CHECK (processing_status = 'QUARANTINED')
);
CREATE TABLE withdrawal_session (
 withdrawal_id CHAR(36) NOT NULL,
 session_id CHAR(36) NOT NULL,
 processing_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
 attempts INT NOT NULL DEFAULT 0,
 error_code VARCHAR(100) NULL,
 PRIMARY KEY(withdrawal_id, session_id),
 CONSTRAINT fk_withdrawal_session_parent FOREIGN KEY (withdrawal_id) REFERENCES consent_withdrawal(withdrawal_id),
 CONSTRAINT fk_withdrawal_session FOREIGN KEY (session_id) REFERENCES work_session(session_id)
);
CREATE TABLE withdrawal_retraction (
 withdrawal_id CHAR(36) NOT NULL,
 retraction_id CHAR(36) NOT NULL,
 PRIMARY KEY(withdrawal_id, retraction_id),
 CONSTRAINT fk_withdrawal_child_parent FOREIGN KEY (withdrawal_id) REFERENCES consent_withdrawal(withdrawal_id),
 CONSTRAINT fk_withdrawal_child FOREIGN KEY (retraction_id) REFERENCES privacy_retraction(retraction_id)
);
CREATE INDEX idx_withdrawal_session_work ON withdrawal_session(processing_status, session_id);
