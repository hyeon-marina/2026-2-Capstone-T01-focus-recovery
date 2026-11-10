-- Only work metadata. No existing payload or V1-V12 migration is rewritten.
ALTER TABLE retraction_target ADD COLUMN owner_role VARCHAR(40) NOT NULL DEFAULT 'UNASSIGNED';
ALTER TABLE retraction_target ADD COLUMN evidence_code VARCHAR(100) NULL;
ALTER TABLE retraction_target ADD COLUMN verified_at DATETIME(3) NULL;
ALTER TABLE retraction_target ADD COLUMN claim_token CHAR(36) NULL;
ALTER TABLE retraction_target ADD COLUMN lease_until DATETIME(3) NULL;
ALTER TABLE retraction_target ADD COLUMN next_attempt_at DATETIME(3) NULL;
CREATE INDEX idx_retraction_target_due ON retraction_target (processing_status, next_attempt_at, lease_until);
