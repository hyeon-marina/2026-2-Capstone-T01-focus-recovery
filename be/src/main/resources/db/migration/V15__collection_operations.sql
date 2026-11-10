-- No administrator, participant, credential or approval is seeded.
CREATE TABLE collection_bootstrap_guard (guard_id INT PRIMARY KEY);
INSERT INTO collection_bootstrap_guard VALUES(1);
CREATE TABLE collection_operator (
 participant_id CHAR(36) PRIMARY KEY,
 authority_ref VARCHAR(255) NOT NULL,
 granted_at DATETIME(3) NOT NULL,
 revoked_at DATETIME(3) NULL,
 CONSTRAINT fk_operator_owner FOREIGN KEY (participant_id) REFERENCES participant(participant_id)
);
CREATE TABLE collection_audit (
 event_id CHAR(36) PRIMARY KEY,
 actor_id CHAR(36) NOT NULL,
 action VARCHAR(40) NOT NULL,
 target_id VARCHAR(100) NOT NULL,
 evidence_ref VARCHAR(255) NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 CONSTRAINT fk_collection_audit_actor FOREIGN KEY (actor_id) REFERENCES participant(participant_id)
);
CREATE TABLE collection_plan (
 plan_id INT PRIMARY KEY,
 revision BIGINT NOT NULL DEFAULT 0,
 CONSTRAINT ck_collection_single_plan CHECK (plan_id=1)
);
CREATE TABLE collection_slot (
 slot_id CHAR(1) PRIMARY KEY,
 participant_id CHAR(36) NULL UNIQUE,
 CONSTRAINT fk_slot_participant FOREIGN KEY (participant_id) REFERENCES participant(participant_id),
 CONSTRAINT ck_slot_name CHECK (slot_id IN ('A','B','C'))
);
CREATE TABLE collection_goal (
 goal_id VARCHAR(20) PRIMARY KEY,
 description VARCHAR(150) NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
 evidence_ref VARCHAR(255) NULL,
 CONSTRAINT ck_goal_status CHECK (status IN ('DRAFT','CONFIRMED'))
);
CREATE TABLE collection_assignment (
 planned_session_id VARCHAR(40) PRIMARY KEY,
 goal_id VARCHAR(20) NOT NULL,
 scenario_type VARCHAR(30) NOT NULL,
 repetition INT NOT NULL,
 slot_id CHAR(1) NOT NULL,
 CONSTRAINT fk_assignment_goal FOREIGN KEY (goal_id) REFERENCES collection_goal(goal_id),
 CONSTRAINT fk_assignment_slot FOREIGN KEY (slot_id) REFERENCES collection_slot(slot_id),
 CONSTRAINT uq_assignment_distribution UNIQUE (goal_id, scenario_type, repetition),
 CONSTRAINT ck_assignment_scenario CHECK (scenario_type IN ('GOAL_MAINTENANCE','JUSTIFIED_DETOUR','GRADUAL_DRIFT','CLEAR_DRIFT')),
 CONSTRAINT ck_assignment_repeat CHECK (repetition IN (1,2))
);
-- Preserve every retry. A completed attempt can never be reassigned to another participant.
ALTER TABLE work_session ADD CONSTRAINT uq_collection_session_owner UNIQUE (session_id, owner_participant_id);
CREATE TABLE collection_attempt (
 attempt_id CHAR(36) PRIMARY KEY,
 planned_session_id VARCHAR(40) NOT NULL,
 participant_id CHAR(36) NOT NULL,
 session_id CHAR(36) NOT NULL UNIQUE,
 source VARCHAR(20) NOT NULL,
 request_key VARCHAR(255) NOT NULL,
 review_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
 delivered_visit_count INT NULL,
 delivered_through_sequence INT NULL,
 reason_code VARCHAR(60) NULL,
 created_at DATETIME(3) NOT NULL,
 CONSTRAINT fk_attempt_assignment FOREIGN KEY (planned_session_id) REFERENCES collection_assignment(planned_session_id),
 CONSTRAINT fk_attempt_session_owner FOREIGN KEY (session_id, participant_id) REFERENCES work_session(session_id, owner_participant_id),
 CONSTRAINT uq_attempt_request UNIQUE (participant_id, request_key),
 CONSTRAINT ck_attempt_source CHECK (source IN ('SYNTHETIC','PARTICIPANT')),
 CONSTRAINT ck_attempt_review CHECK (review_status IN ('PENDING','FAILED','RECOLLECT_REQUIRED'))
);
CREATE TABLE collection_failure (
 failure_id CHAR(36) PRIMARY KEY,
 attempt_id CHAR(36) NOT NULL,
 reason_code VARCHAR(60) NOT NULL,
 observed_at DATETIME(3) NOT NULL,
 CONSTRAINT fk_collection_failure_attempt FOREIGN KEY (attempt_id) REFERENCES collection_attempt(attempt_id)
);
CREATE INDEX idx_collection_attempt_plan ON collection_attempt(planned_session_id, created_at);
