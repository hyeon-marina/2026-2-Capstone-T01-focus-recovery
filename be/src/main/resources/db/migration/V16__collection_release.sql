-- Approval evidence is supplied by an authorized operator, never seeded by migration.
CREATE TABLE collection_release (
 policy_digest CHAR(64) PRIMARY KEY,
 build_id VARCHAR(100) NOT NULL,
 approval_ref VARCHAR(255) NOT NULL,
 authorized_at DATETIME(3) NOT NULL,
 revoked_at DATETIME(3) NULL
);
CREATE TABLE session_collection_scope (
 session_id CHAR(36) PRIMARY KEY,
 policy_digest CHAR(64) NOT NULL,
 build_id VARCHAR(100) NOT NULL,
 CONSTRAINT fk_scope_session FOREIGN KEY (session_id) REFERENCES work_session(session_id),
 CONSTRAINT fk_scope_release FOREIGN KEY (policy_digest) REFERENCES collection_release(policy_digest)
);
