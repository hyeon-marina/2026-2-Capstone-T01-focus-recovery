package com.focusrecovery.domain.composition.entity;

import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;
import jakarta.persistence.*;

@Entity
@Table(name = "compose_request")
public class ComposeRequest implements Persistable<UUID> {
	@Id
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "compose_request_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID composeRequestId;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "session_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID sessionId;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "active_session_id", columnDefinition = "CHAR(36)", nullable = true, updatable = true)
	private UUID activeSessionId;
	@Column(name = "after_sequence", columnDefinition = "INT", nullable = false, updatable = false)
	private int afterSequence;
	@Column(name = "composed_through_sequence", columnDefinition = "INT", nullable = false, updatable = false)
	private int composedThroughSequence;
	@Column(name = "privacy_revision", columnDefinition = "BIGINT", nullable = false, updatable = false)
	private long privacyRevision;
	@Column(name = "input_fingerprint", columnDefinition = "CHAR(64)", nullable = false, updatable = false)
	private String inputFingerprint;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "input_snapshot", columnDefinition = "JSON", nullable = false, updatable = false)
	private String inputSnapshot;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "response_snapshot", columnDefinition = "JSON", nullable = true, updatable = true)
	private String responseSnapshot;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "receipt", columnDefinition = "JSON", nullable = true, updatable = true)
	private String receipt;
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
	@Column(name = "attempts", columnDefinition = "INT", nullable = false, updatable = true)
	private int attempts;
	@Column(name = "error_code", columnDefinition = "VARCHAR(100)", nullable = true, updatable = true)
	private String errorCode;
	@Transient private boolean isNew = true;
	protected ComposeRequest() {}
	@PostLoad @PostPersist void markNotNew() { isNew = false; }
	@Override public UUID getId() { return composeRequestId; }
	@Override public boolean isNew() { return isNew; }
	public UUID getComposeRequestId() { return composeRequestId; }
	public UUID getSessionId() { return sessionId; }
	public UUID getActiveSessionId() { return activeSessionId; }
	public int getAfterSequence() { return afterSequence; }
	public int getComposedThroughSequence() { return composedThroughSequence; }
	public long getPrivacyRevision() { return privacyRevision; }
	public String getInputFingerprint() { return inputFingerprint; }
	public String getInputSnapshot() { return inputSnapshot; }
	public String getResponseSnapshot() { return responseSnapshot; }
	public String getReceipt() { return receipt; }
	public String getProcessingStatus() { return processingStatus; }
	public Instant getRequestedAt() { return requestedAt; }
	public Instant getStartedAt() { return startedAt; }
	public Instant getCompletedAt() { return completedAt; }
	public UUID getClaimToken() { return claimToken; }
	public Instant getLeaseUntil() { return leaseUntil; }
	public int getAttempts() { return attempts; }
	public String getErrorCode() { return errorCode; }

	public static ComposeRequest pending(UUID id, UUID sessionId, int after, int through, long revision,
		String fingerprint, String snapshot, Instant now) {
		ComposeRequest job = new ComposeRequest();
		job.composeRequestId = id; job.sessionId = sessionId; job.activeSessionId = sessionId;
		job.afterSequence = after; job.composedThroughSequence = through; job.privacyRevision = revision;
		job.inputFingerprint = fingerprint; job.inputSnapshot = snapshot;
		job.processingStatus = "PENDING"; job.requestedAt = now;
		return job;
	}
	public UUID claim(Instant now) {
		processingStatus = "RUNNING"; startedAt = now; leaseUntil = now.plusSeconds(60);
		claimToken = UUID.randomUUID(); attempts++; return claimToken;
	}
	public void complete(String response, String receipt, Instant now) {
		responseSnapshot = response; this.receipt = receipt; terminal("COMPLETED", null, now);
	}
	public void terminal(String status, String error, Instant now) {
		processingStatus = status; errorCode = error; completedAt = now;
		activeSessionId = null; claimToken = null; leaseUntil = null;
	}
	public void recover(Instant now) { retry(now, "COMPOSE_INTERRUPTED"); }
	public void retry(Instant now, String error) {
		claimToken = null; leaseUntil = null;
		if (attempts >= 3) terminal("FAILED", error, now);
		else { processingStatus = "PENDING"; errorCode = error; }
	}
}
