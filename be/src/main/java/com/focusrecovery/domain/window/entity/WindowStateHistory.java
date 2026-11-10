package com.focusrecovery.domain.window.entity;

import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

@Entity
@Table(name = "window_state_history")
public class WindowStateHistory implements Persistable<WindowStateId> {
	@EmbeddedId private WindowStateId id;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "analysis_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID analysisId;
	@Column(name = "rule_version", length = 100, nullable = false, updatable = false)
	private String ruleVersion;
	@Column(name = "judged_at", columnDefinition = "DATETIME(3)", nullable = false, updatable = false)
	private Instant judgedAt;
	@Column(name = "final_state", length = 20, nullable = false, updatable = false)
	private String finalState;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "behavior_snapshot", columnDefinition = "JSON", nullable = false, updatable = false)
	private String behaviorSnapshot;
	@Column(name = "input_fingerprint", columnDefinition = "CHAR(64)", nullable = false, updatable = false)
	private String inputFingerprint;
	@Transient private boolean isNew = true;
	protected WindowStateHistory() {}
	public WindowStateHistory(WindowStateId id, UUID analysisId, String ruleVersion, Instant judgedAt,
		String finalState, String behaviorSnapshot, String fingerprint) {
		this.id = id; this.analysisId = analysisId; this.ruleVersion = ruleVersion; this.judgedAt = judgedAt;
		this.finalState = finalState; this.behaviorSnapshot = behaviorSnapshot; this.inputFingerprint = fingerprint;
	}
	@PostLoad @PostPersist void markNotNew() { isNew = false; }
	@Override public WindowStateId getId() { return id; }
	@Override public boolean isNew() { return isNew; }
	public UUID getAnalysisId() { return analysisId; }
	public String getRuleVersion() { return ruleVersion; }
	public Instant getJudgedAt() { return judgedAt; }
	public String getFinalState() { return finalState; }
	public String getBehaviorSnapshot() { return behaviorSnapshot; }
	public String getInputFingerprint() { return inputFingerprint; }
}
