package com.focusrecovery.domain.analysis.dto;

import java.time.Instant;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.focusrecovery.domain.alert.dto.V2AlertResponse;
import com.focusrecovery.domain.session.entity.WorkSessionStatus;

@JsonInclude(JsonInclude.Include.ALWAYS)
public record V2AnalysisStatusResponse(int apiContractVersion, UUID sessionId, WorkSessionStatus sessionStatus,
	Decision currentDecision, Decision lastSuccessfulState, V2AlertResponse alert,
	AnalysisSummaryResponse latestAnalysis, AnalysisSummaryResponse latestCompletedAnalysis) {
	@JsonInclude(JsonInclude.Include.ALWAYS)
	public record Decision(UUID windowId, int windowIndex, Long stateVersion, UUID analysisId,
		String decisionStatus, String finalState,
		@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant judgedAt, String errorCode) {}
}
