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
	@Transient private boolean isNew = true;
	protected RetractionTarget() {}
	public RetractionTarget(RetractionTargetId id) { this.id = id; }
	@PostLoad @PostPersist void markNotNew() { isNew = false; }
	@Override public RetractionTargetId getId() { return id; }
	@Override public boolean isNew() { return isNew; }
	public String getProcessingStatus() { return processingStatus; }
	public String getErrorCode() { return errorCode; }
	public int getAttempts() { return attempts; }
	public void recordFailure(String code) { processingStatus = "FAILED"; errorCode = code; attempts++; }
}
