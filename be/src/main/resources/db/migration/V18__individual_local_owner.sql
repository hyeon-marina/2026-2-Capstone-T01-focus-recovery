-- Only offline individual-local setup populates this row. No default owner or policy.
CREATE TABLE collection_local_owner (
 owner_key INT PRIMARY KEY,
 participant_id CHAR(36) NOT NULL UNIQUE,
 slot_id CHAR(1) NOT NULL,
 owner_secret_hash CHAR(64) NOT NULL,
 policy_digest CHAR(64) NULL,
 plan_checksum CHAR(64) NULL,
 CONSTRAINT ck_local_single CHECK (owner_key=1),
 CONSTRAINT ck_local_slot CHECK (slot_id IN ('A','B','C')),
 CONSTRAINT fk_local_participant FOREIGN KEY (participant_id) REFERENCES participant(participant_id)
);
