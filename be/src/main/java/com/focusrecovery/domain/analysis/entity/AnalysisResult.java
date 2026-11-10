package com.focusrecovery.domain.analysis.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

import com.focusrecovery.domain.analysis.client.AiAnalysisOutcome;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;

// 구간당 1건(uq_analysis_result_window). 정상 응답만 판정·확률을 채우고, 실패는 error_code만 남긴다
@Entity
@Table(name = "analysis_result")
public class AnalysisResult implements Persistable<UUID> {

	@Id
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "analysis_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID analysisId;

	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "window_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID windowId;

	@Enumerated(EnumType.STRING)
	@Column(name = "processing_status", length = 20, nullable = false)
	private AnalysisStatus processingStatus;

	@Column(name = "result", length = 20)
	private String result;

	@Column(name = "p_normal")
	private Double pNormal;

	@Column(name = "p_transition")
	private Double pTransition;

	@Column(name = "p_drift")
	private Double pDrift;

	@Column(name = "context_used")
	private Boolean contextUsed;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "context_result", columnDefinition = "JSON")
	private String contextResult;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "input_snapshot", columnDefinition = "JSON", updatable = false)
	private String inputSnapshot;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "feature_snapshot", columnDefinition = "JSON")
	private String featureSnapshot;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "model_versions", columnDefinition = "JSON")
	private String modelVersions;

	@Column(name = "requested_at", columnDefinition = "DATETIME(3)", nullable = false, updatable = false)
	private Instant requestedAt;

	@Column(name = "started_at", columnDefinition = "DATETIME(3)")
	private Instant startedAt;

	@Column(name = "analyzed_at", columnDefinition = "DATETIME(3)")
	private Instant analyzedAt;

	@Column(name = "completed_at", columnDefinition = "DATETIME(3)")
	private Instant completedAt;

	@Column(name = "error_code", length = 100)
	private String errorCode;

	@Column(name = "api_contract_version", nullable = false, updatable = false)
	private int apiContractVersion = 1;
	@Column(name = "input_fingerprint", columnDefinition = "CHAR(64)", updatable = false)
	private String inputFingerprint;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "page_results", columnDefinition = "JSON")
	private String pageResults;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "response_snapshot", columnDefinition = "JSON")
	private String responseSnapshot;
	public int getApiContractVersion() { return apiContractVersion; }
	public String getInputFingerprint() { return inputFingerprint; }
	public String getPageResults() { return pageResults; }
	public String getResponseSnapshot() { return responseSnapshot; }
	public static AnalysisResult requestV2(UUID id, UUID windowId, String snapshot, String fingerprint, Instant now) {
		AnalysisResult analysis = request(id, windowId, snapshot, now);
		analysis.apiContractVersion = 2; analysis.inputFingerprint = fingerprint; return analysis;
	}
	public void completeV2(String pages, String versions, String response, Instant analyzedAt, Instant now) {
		if (apiContractVersion != 2 || processingStatus != AnalysisStatus.RUNNING)
			throw new IllegalStateException("v2 analysis is not running");
		pageResults = pages; modelVersions = versions; responseSnapshot = response;
		this.analyzedAt = analyzedAt; completedAt = now; processingStatus = AnalysisStatus.COMPLETED;
	}
	public void invalidate(Instant now) {
		processingStatus = AnalysisStatus.INVALIDATED; errorCode = "PRIVACY_RETRACTED"; completedAt = now;
	}

	// 서버가 ID를 발급하므로 save()가 merge(조회 후 INSERT)하지 않도록 항상 INSERT 하게 한다
	@Transient
	private boolean isNew = true;

	protected AnalysisResult() {
	}

	// 입력 스냅샷은 요청 시점에 고정하며 이후 바꾸지 않는다(updatable = false)
	public static AnalysisResult request(UUID analysisId, UUID windowId, String inputSnapshot, Instant requestedAt) {
		AnalysisResult analysis = new AnalysisResult();
		analysis.analysisId = analysisId;
		analysis.windowId = windowId;
		analysis.processingStatus = AnalysisStatus.PENDING;
		analysis.inputSnapshot = inputSnapshot;
		analysis.requestedAt = requestedAt;
		return analysis;
	}

	public void start(Instant startedAt) {
		processingStatus = AnalysisStatus.RUNNING;
		this.startedAt = startedAt;
	}

	public void finish(AiAnalysisOutcome outcome, Instant completedAt) {
		this.completedAt = completedAt;
		if (outcome.errorCode() != null) {
			processingStatus = AnalysisStatus.FAILED;
			errorCode = outcome.errorCode();
			return;
		}
		processingStatus = AnalysisStatus.COMPLETED;
		result = outcome.result();
		pNormal = outcome.pNormal();
		pTransition = outcome.pTransition();
		pDrift = outcome.pDrift();
		contextUsed = outcome.contextUsed();
		contextResult = outcome.contextResult();
		featureSnapshot = outcome.featureSnapshot();
		modelVersions = outcome.modelVersions();
		analyzedAt = outcome.analyzedAt();
	}

	@PostLoad
	@PostPersist
	void markNotNew() {
		isNew = false;
	}

	@Override
	public UUID getId() {
		return analysisId;
	}

	@Override
	public boolean isNew() {
		return isNew;
	}

	public UUID getAnalysisId() {
		return analysisId;
	}

	public UUID getWindowId() {
		return windowId;
	}

	public AnalysisStatus getProcessingStatus() {
		return processingStatus;
	}

	public String getResult() {
		return result;
	}

	public Double getPNormal() {
		return pNormal;
	}

	public Double getPTransition() {
		return pTransition;
	}

	public Double getPDrift() {
		return pDrift;
	}

	public Boolean getContextUsed() {
		return contextUsed;
	}

	public String getContextResult() {
		return contextResult;
	}

	public String getInputSnapshot() {
		return inputSnapshot;
	}

	public String getFeatureSnapshot() {
		return featureSnapshot;
	}

	public String getModelVersions() {
		return modelVersions;
	}

	public Instant getRequestedAt() {
		return requestedAt;
	}

	public Instant getStartedAt() {
		return startedAt;
	}

	public Instant getAnalyzedAt() {
		return analyzedAt;
	}

	public Instant getCompletedAt() {
		return completedAt;
	}

	public String getErrorCode() {
		return errorCode;
	}
}
