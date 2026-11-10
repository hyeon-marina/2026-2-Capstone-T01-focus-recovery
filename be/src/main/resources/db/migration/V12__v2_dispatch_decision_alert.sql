-- Additive; v1 analysis_id UNIQUE and all displayed events/responses stay intact.
ALTER TABLE compose_request ADD COLUMN next_attempt_at DATETIME(3) NULL;
UPDATE compose_request SET next_attempt_at = requested_at;
CREATE INDEX idx_compose_due ON compose_request (processing_status, next_attempt_at, requested_at);
CREATE INDEX idx_session_composition_dirty ON work_session (collection_spec_version, privacy_status, composition_dirty, started_at);

-- A decision is a short DB-only transaction. Row + session locks replace a network lease.
ALTER TABLE analysis_window ADD COLUMN decision_dirty BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE analysis_window ADD COLUMN decision_error_code VARCHAR(100) NULL;
UPDATE analysis_window SET decision_dirty = TRUE WHERE api_contract_version = 2 AND invalidated = FALSE;
CREATE INDEX idx_window_decision_dirty ON analysis_window (api_contract_version, invalidated, decision_dirty, created_at);

ALTER TABLE window_state_history ADD CONSTRAINT uq_state_analysis_ref UNIQUE (window_id, state_version, analysis_id);
ALTER TABLE notification ADD COLUMN window_id CHAR(36) NULL;
ALTER TABLE notification ADD COLUMN state_version BIGINT NULL;
-- v2's analysis evidence is separate from legacy analysis_id so its UNIQUE need not be removed.
ALTER TABLE notification ADD COLUMN state_analysis_id CHAR(36) NULL;
ALTER TABLE notification ADD COLUMN invalidated_at DATETIME(3) NULL;
ALTER TABLE notification ADD CONSTRAINT uq_notification_state UNIQUE (window_id, state_version);
ALTER TABLE notification ADD CONSTRAINT fk_notification_state FOREIGN KEY (window_id, state_version, state_analysis_id)
    REFERENCES window_state_history (window_id, state_version, analysis_id);
ALTER TABLE notification ADD CONSTRAINT ck_notification_v2_refs CHECK (
    (window_id IS NULL AND state_version IS NULL AND state_analysis_id IS NULL)
    OR (window_id IS NOT NULL AND state_version IS NOT NULL AND state_analysis_id IS NOT NULL AND analysis_id IS NULL AND alert_type = 'AI')
);
CREATE INDEX idx_notification_window_pending ON notification (window_id, shown_at, invalidated_at);
