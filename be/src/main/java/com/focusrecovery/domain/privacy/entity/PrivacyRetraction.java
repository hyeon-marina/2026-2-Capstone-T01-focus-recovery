package com.focusrecovery.domain.privacy.entity;

import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;
import jakarta.persistence.*;

@Entity
@Table(name = "privacy_retraction")
public class PrivacyRetraction implements Persistable<UUID> {
	@Id
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "retraction_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID retractionId;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "session_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID sessionId;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "visit_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID visitId;
	@Column(name = "reason_code", columnDefinition = "VARCHAR(30)", nullable = false, updatable = false)
	private String reasonCode;
	@Column(name = "observed_at", columnDefinition = "DATETIME(3)", nullable = false, updatable = false)
	private Instant observedAt;
	@Column(name = "requested_at", columnDefinition = "DATETIME(3)", nullable = false, updatable = false)
	private Instant requestedAt;
	@Column(name = "input_fingerprint", columnDefinition = "CHAR(64)", nullable = false, updatable = false)
	private String inputFingerprint;
	@Column(name = "processing_status", columnDefinition = "VARCHAR(20)", nullable = false, updatable = true)
	private String processingStatus;
	@Column(name = "prerequisites", columnDefinition = "VARCHAR(255)", nullable = false, updatable = true)
	private String prerequisites;
	@Column(name = "error_code", columnDefinition = "VARCHAR(100)", nullable = true, updatable = true)
	private String errorCode;
	@Column(name = "attempts", columnDefinition = "INT", nullable = false, updatable = true)
	private int attempts;
	@Transient private boolean isNew = true;
	protected PrivacyRetraction() {}
	@PostLoad @PostPersist void markNotNew() { isNew = false; }
	@Override public UUID getId() { return retractionId; }
	@Override public boolean isNew() { return isNew; }
	public UUID getRetractionId() { return retractionId; }
	public UUID getSessionId() { return sessionId; }
	public UUID getVisitId() { return visitId; }
	public String getReasonCode() { return reasonCode; }
	public Instant getObservedAt() { return observedAt; }
	public Instant getRequestedAt() { return requestedAt; }
	public String getInputFingerprint() { return inputFingerprint; }
	public String getProcessingStatus() { return processingStatus; }
	public String getPrerequisites() { return prerequisites; }
	public String getErrorCode() { return errorCode; }
	public int getAttempts() { return attempts; }

	public static PrivacyRetraction quarantined(UUID id, UUID sessionId, UUID visitId, String reason,
		Instant observedAt, String fingerprint, Instant now) {
		PrivacyRetraction job = new PrivacyRetraction(); job.retractionId = id; job.sessionId = sessionId;
		job.visitId = visitId; job.reasonCode = reason; job.observedAt = observedAt; job.inputFingerprint = fingerprint;
		job.requestedAt = now; job.processingStatus = "QUARANTINED";
		job.prerequisites = "OWNERSHIP_CONTRACT,CONSENT_POLICY,END_PENDING_PROTOCOL,DELETE_INVENTORY,EXTERNAL_EVIDENCE";
		return job;
	}
	public void recordFailure(String code) { errorCode = code; attempts++; }

}
