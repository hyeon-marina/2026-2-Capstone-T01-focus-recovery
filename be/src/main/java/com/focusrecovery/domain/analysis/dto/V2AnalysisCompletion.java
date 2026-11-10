package com.focusrecovery.domain.analysis.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonFormat;

// AI 원본 결과 저장 경계. BE 최종 판단은 별도 상태 이력으로 보존한다.
public record V2AnalysisCompletion(int apiContractVersion, UUID analysisId, UUID sessionId, UUID windowId,
	String inputFingerprint, List<Page> pageResults, Map<String, String> modelVersions,
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant analyzedAt) {
	public record Page(int position, UUID visitId, String label, double semanticRelevance, String rationale) {}
}
