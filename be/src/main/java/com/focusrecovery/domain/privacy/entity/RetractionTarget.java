package com.focusrecovery.domain.privacy.entity;
import jakarta.persistence.*;
import org.springframework.data.domain.Persistable;
@Entity
@Table(name = "retraction_target")
public class RetractionTarget implements Persistable<RetractionTargetId> {
	@EmbeddedId private RetractionTargetId id;
	@Column(name = "processing_status", length = 20, nullable = false)
	private String processingStatus = "BLOCKED";
	@Column(name = "error_code", length = 100) private String errorCode;
	@Column(name = "attempts", nullable = false) private int attempts;
	@Column(name = "owner_role", length = 40, nullable = false) private String ownerRole = "UNASSIGNED";
	@Column(name = "evidence_code", length = 100) private String evidenceCode;
	@Column(name = "verified_at", columnDefinition = "DATETIME(3)") private java.time.Instant verifiedAt;
	@org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.CHAR)
	@Column(name = "claim_token", columnDefinition = "CHAR(36)") private java.util.UUID claimToken;
	@Column(name = "lease_until", columnDefinition = "DATETIME(3)") private java.time.Instant leaseUntil;
	@Column(name = "next_attempt_at", columnDefinition = "DATETIME(3)") private java.time.Instant nextAttemptAt;
	@Transient private boolean isNew = true;
	protected RetractionTarget() {}
	public RetractionTarget(RetractionTargetId id) {
        this.id = id;
        ownerRole = switch (id.targetType()) {
            case "CLIENT_LOCAL_COPIES" -> "FE";
            case "AI_CACHE_AND_MEMORY", "TRAINED_ARTIFACTS" -> "AI";
            case "EXPORT_COPIES", "BACKUPS", "LOG_COPIES" -> "DATA_STEWARD";
            default -> "BE";
        };
        evidenceCode = "POLICY_OR_EXTERNAL_EVIDENCE_MISSING";
    }
    public void queue() { processingStatus = "PENDING"; }
    public String getEvidenceCode() { return evidenceCode; }
    public String getOwnerRole() { return ownerRole; }
    public java.time.Instant getVerifiedAt() { return verifiedAt; }
    public java.util.UUID getClaimToken() { return claimToken; }
    public boolean due(java.time.Instant now) {
        return (("PENDING".equals(processingStatus) || "FAILED".equals(processingStatus)) && (nextAttemptAt == null || !nextAttemptAt.isAfter(now)))
            || ("RUNNING".equals(processingStatus) && leaseUntil != null && !leaseUntil.isAfter(now));
    }
    public java.util.UUID claim(java.time.Instant now) {
        processingStatus = "RUNNING"; attempts = Math.incrementExact(attempts); claimToken = java.util.UUID.randomUUID();
        leaseUntil = now.plusSeconds(30); return claimToken;
    }
    public boolean owns(java.util.UUID token, java.time.Instant now) {
        return "RUNNING".equals(processingStatus) && token.equals(claimToken) && leaseUntil.isAfter(now);
    }
    public void verified(String evidence, java.time.Instant now) {
        processingStatus = "VERIFIED"; evidenceCode = evidence; verifiedAt = now; errorCode = null; claimToken = null; leaseUntil = null;
    }
    public void blocked() { processingStatus = "BLOCKED"; errorCode = "POLICY_OR_EXTERNAL_EVIDENCE_MISSING"; claimToken = null; leaseUntil = null; }
    public void retry(java.time.Instant now, String code) {
        processingStatus = "FAILED"; errorCode = code; claimToken = null; leaseUntil = null;
        nextAttemptAt = now.plusSeconds(Math.min(300, 1L << Math.min(attempts, 8)));
    }
	@PostLoad @PostPersist void markNotNew() { isNew = false; }
	@Override public RetractionTargetId getId() { return id; }
	@Override public boolean isNew() { return isNew; }
	public String getProcessingStatus() { return processingStatus; }
	public String getErrorCode() { return errorCode; }
	public int getAttempts() { return attempts; }
	public void recordFailure(String code) { processingStatus = "FAILED"; errorCode = code; attempts++; }
}
