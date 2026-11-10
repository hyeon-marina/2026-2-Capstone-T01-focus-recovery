-- Additive only: v1 rows retain their original payload, FK and UNIQUE constraints.
ALTER TABLE work_session ADD COLUMN collection_spec_version VARCHAR(10) NOT NULL DEFAULT '1.0';
ALTER TABLE work_session ADD COLUMN last_accepted_sequence INT NOT NULL DEFAULT 0;
ALTER TABLE work_session ADD COLUMN composed_through_sequence INT NOT NULL DEFAULT 0;
ALTER TABLE work_session ADD COLUMN privacy_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE work_session ADD COLUMN privacy_status VARCHAR(20) NOT NULL DEFAULT 'CLEAR';
ALTER TABLE work_session ADD COLUMN composition_dirty BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE page_visit ADD COLUMN extraction_status VARCHAR(30) NULL;
ALTER TABLE analysis_window ADD COLUMN api_contract_version INT NOT NULL DEFAULT 1;
ALTER TABLE analysis_window ADD COLUMN last_state_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE analysis_window ADD COLUMN invalidated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE analysis_result ADD COLUMN api_contract_version INT NOT NULL DEFAULT 1;
ALTER TABLE analysis_result ADD COLUMN input_fingerprint CHAR(64) NULL;
ALTER TABLE analysis_result ADD COLUMN page_results JSON NULL;
ALTER TABLE analysis_result ADD COLUMN response_snapshot JSON NULL;
-- A composite FK prevents histories from pointing at another window's analysis.
ALTER TABLE analysis_result ADD CONSTRAINT uq_analysis_result_window_analysis UNIQUE (window_id, analysis_id);

CREATE TABLE compose_request (
    compose_request_id CHAR(36) NOT NULL,
    session_id CHAR(36) NOT NULL,
    active_session_id CHAR(36) NULL,
    after_sequence INT NOT NULL,
    composed_through_sequence INT NOT NULL,
    privacy_revision BIGINT NOT NULL,
    input_fingerprint CHAR(64) NOT NULL,
    input_snapshot JSON NOT NULL,
    response_snapshot JSON NULL,
    receipt JSON NULL,
    processing_status VARCHAR(20) NOT NULL,
    requested_at DATETIME(3) NOT NULL,
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    claim_token CHAR(36) NULL,
    lease_until DATETIME(3) NULL,
    attempts INT NOT NULL DEFAULT 0,
    error_code VARCHAR(100) NULL,
    PRIMARY KEY (compose_request_id),
    CONSTRAINT uq_compose_active_session UNIQUE (active_session_id),
    CONSTRAINT fk_compose_session FOREIGN KEY (session_id) REFERENCES work_session (session_id),
    CONSTRAINT fk_compose_active_session FOREIGN KEY (active_session_id) REFERENCES work_session (session_id)
);
CREATE INDEX idx_compose_recovery ON compose_request (processing_status, lease_until);

CREATE TABLE analysis_outbox (
    analysis_id CHAR(36) NOT NULL,
    session_id CHAR(36) NOT NULL,
    privacy_revision BIGINT NOT NULL,
    processing_status VARCHAR(20) NOT NULL,
    requested_at DATETIME(3) NOT NULL,
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    claim_token CHAR(36) NULL,
    lease_until DATETIME(3) NULL,
    error_code VARCHAR(100) NULL,
    PRIMARY KEY (analysis_id),
    CONSTRAINT fk_outbox_analysis FOREIGN KEY (analysis_id) REFERENCES analysis_result (analysis_id),
    CONSTRAINT fk_outbox_session FOREIGN KEY (session_id) REFERENCES work_session (session_id)
);
CREATE INDEX idx_analysis_outbox_pending ON analysis_outbox (processing_status, requested_at);
CREATE INDEX idx_analysis_outbox_recovery ON analysis_outbox (processing_status, lease_until);

CREATE TABLE window_state_history (
    window_id CHAR(36) NOT NULL,
    state_version BIGINT NOT NULL,
    analysis_id CHAR(36) NOT NULL,
    rule_version VARCHAR(100) NOT NULL,
    judged_at DATETIME(3) NOT NULL,
    final_state VARCHAR(20) NOT NULL,
    behavior_snapshot JSON NOT NULL,
    input_fingerprint CHAR(64) NOT NULL,
    PRIMARY KEY (window_id, state_version),
    CONSTRAINT uq_window_state_input UNIQUE (window_id, input_fingerprint),
    CONSTRAINT fk_state_window FOREIGN KEY (window_id) REFERENCES analysis_window (window_id),
    CONSTRAINT fk_state_analysis_window FOREIGN KEY (window_id, analysis_id)
        REFERENCES analysis_result (window_id, analysis_id)
);

CREATE TABLE privacy_retraction (
    retraction_id CHAR(36) NOT NULL,
    session_id CHAR(36) NOT NULL,
    visit_id CHAR(36) NOT NULL,
    reason_code VARCHAR(30) NOT NULL,
    observed_at DATETIME(3) NOT NULL,
    requested_at DATETIME(3) NOT NULL,
    input_fingerprint CHAR(64) NOT NULL,
    processing_status VARCHAR(20) NOT NULL,
    prerequisites VARCHAR(255) NOT NULL,
    error_code VARCHAR(100) NULL,
    attempts INT NOT NULL DEFAULT 0,
    PRIMARY KEY (retraction_id),
    CONSTRAINT fk_retraction_session FOREIGN KEY (session_id) REFERENCES work_session (session_id)
);
-- No visit FK: retract-before-POST must remain durable.
CREATE TABLE visit_tombstone (
    visit_id CHAR(36) NOT NULL,
    session_id CHAR(36) NOT NULL,
    retraction_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (visit_id),
    CONSTRAINT fk_tombstone_session FOREIGN KEY (session_id) REFERENCES work_session (session_id),
    CONSTRAINT fk_tombstone_retraction FOREIGN KEY (retraction_id) REFERENCES privacy_retraction (retraction_id)
);
CREATE TABLE retraction_target (
    retraction_id CHAR(36) NOT NULL,
    target_type VARCHAR(40) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    processing_status VARCHAR(20) NOT NULL,
    error_code VARCHAR(100) NULL,
    attempts INT NOT NULL DEFAULT 0,
    PRIMARY KEY (retraction_id, target_type, target_id),
    CONSTRAINT fk_target_retraction FOREIGN KEY (retraction_id) REFERENCES privacy_retraction (retraction_id)
);
