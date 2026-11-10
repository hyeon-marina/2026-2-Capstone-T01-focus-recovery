package com.focusrecovery.domain.analysis.entity;

import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;
import jakarta.persistence.*;

@Entity
@Table(name = "analysis_outbox")
public class AnalysisOutbox implements Persistable<UUID> {
	@Id
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "analysis_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID analysisId;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "session_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID sessionId;
	@Column(name = "privacy_revision", columnDefinition = "BIGINT", nullable = false, updatable = false)
	private long privacyRevision;
	@Column(name = "processing_status", columnDefinition = "VARCHAR(20)", nullable = false, updatable = true)
	private String processingStatus;
	@Column(name = "requested_at", columnDefinition = "DATETIME(3)", nullable = false, updatable = false)
	private Instant requestedAt;
	@Column(name = "started_at", columnDefinition = "DATETIME(3)", nullable = true, updatable = true)
	private Instant startedAt;
	@Column(name = "completed_at", columnDefinition = "DATETIME(3)", nullable = true, updatable = true)
	private Instant completedAt;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "claim_token", columnDefinition = "CHAR(36)", nullable = true, updatable = true)
	private UUID claimToken;
	@Column(name = "lease_until", columnDefinition = "DATETIME(3)", nullable = true, updatable = true)
	private Instant leaseUntil;
	@Column(name = "error_code", columnDefinition = "VARCHAR(100)", nullable = true, updatable = true)
	private String errorCode;
	@Transient private boolean isNew = true;
	protected AnalysisOutbox() {}
	@PostLoad @PostPersist void markNotNew() { isNew = false; }
	@Override public UUID getId() { return analysisId; }
	@Override public boolean isNew() { return isNew; }
	public UUID getAnalysisId() { return analysisId; }
	public UUID getSessionId() { return sessionId; }
	public long getPrivacyRevision() { return privacyRevision; }
	public String getProcessingStatus() { return processingStatus; }
	public Instant getRequestedAt() { return requestedAt; }
	public Instant getStartedAt() { return startedAt; }
	public Instant getCompletedAt() { return completedAt; }
	public UUID getClaimToken() { return claimToken; }
	public Instant getLeaseUntil() { return leaseUntil; }
	public String getErrorCode() { return errorCode; }

	public static AnalysisOutbox pending(UUID analysisId, UUID sessionId, long revision, Instant now) {
		AnalysisOutbox task = new AnalysisOutbox(); task.analysisId = analysisId; task.sessionId = sessionId;
		task.privacyRevision = revision; task.processingStatus = "PENDING"; task.requestedAt = now; return task;
	}
	public UUID claim(Instant now) {
		processingStatus = "RUNNING"; startedAt = now; leaseUntil = now.plusSeconds(60);
		claimToken = UUID.randomUUID(); return claimToken;
	}
	public void terminal(String status, String error, Instant now) {
		processingStatus = status; errorCode = error; completedAt = now; claimToken = null; leaseUntil = null;
	}

}
