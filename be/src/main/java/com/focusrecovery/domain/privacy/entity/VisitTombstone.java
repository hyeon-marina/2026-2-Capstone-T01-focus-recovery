package com.focusrecovery.domain.privacy.entity;

import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;
import jakarta.persistence.*;

@Entity
@Table(name = "visit_tombstone")
public class VisitTombstone implements Persistable<UUID> {
	@Id
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "visit_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID visitId;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "session_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID sessionId;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "retraction_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID retractionId;
	@Column(name = "created_at", columnDefinition = "DATETIME(3)", nullable = false, updatable = false)
	private Instant createdAt;
	@Transient private boolean isNew = true;
	protected VisitTombstone() {}
	@PostLoad @PostPersist void markNotNew() { isNew = false; }
	@Override public UUID getId() { return visitId; }
	@Override public boolean isNew() { return isNew; }
	public UUID getVisitId() { return visitId; }
	public UUID getSessionId() { return sessionId; }
	public UUID getRetractionId() { return retractionId; }
	public Instant getCreatedAt() { return createdAt; }

	public VisitTombstone(UUID visitId, UUID sessionId, UUID retractionId, Instant now) {
		this.visitId = visitId; this.sessionId = sessionId; this.retractionId = retractionId; this.createdAt = now;
	}

}
