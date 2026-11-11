-- Additive only. Stable database provenance, no participant/credential/consent/release seed.
CREATE TABLE collection_source_instance (
 instance_key INT PRIMARY KEY,
 source_instance_id CHAR(36) NOT NULL UNIQUE,
 CONSTRAINT ck_source_singleton CHECK (instance_key=1)
);
CREATE TABLE collection_export_audit (
 export_id CHAR(36) PRIMARY KEY,
 source_instance_id CHAR(36) NOT NULL,
 participant_id CHAR(36) NOT NULL,
 actor_id CHAR(36) NOT NULL,
 snapshot_at DATETIME(3) NOT NULL,
 session_count INT NOT NULL,
 visit_count INT NOT NULL,
 CONSTRAINT fk_export_participant FOREIGN KEY (participant_id) REFERENCES participant(participant_id),
 CONSTRAINT fk_export_actor FOREIGN KEY (actor_id) REFERENCES participant(participant_id)
);
