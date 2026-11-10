package com.focusrecovery.domain.analysis.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonFormat;

// 이미 계산된 결과의 내부 저장 경계. HTTP 변환 및 최종 판단은 후속 Issue다.
public record V2AnalysisCompletion(int apiContractVersion, UUID analysisId, UUID sessionId, UUID windowId,
	String inputFingerprint, List<Page> pageResults, Map<String, String> modelVersions,
	@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant analyzedAt) {
	public record Page(int position, UUID visitId, String label, double semanticRelevance, String rationale) {}
}
