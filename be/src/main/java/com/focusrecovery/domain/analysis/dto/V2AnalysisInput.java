package com.focusrecovery.domain.analysis.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.focusrecovery.domain.visit.entity.PageVisit;

public record V2AnalysisInput(int apiContractVersion, UUID analysisId, UUID sessionId, UUID windowId,
	int windowIndex, String goalText, String inputFingerprint, List<Visit> visits) {
	public record Visit(int position, UUID visitId, int sequence, String title, String content, String searchQuery,
		@JsonProperty("isSearchResultPage") boolean isSearchResultPage,
		@JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", timezone = "UTC") Instant visitedAt) {
		public static Visit of(int position, PageVisit visit) {
			return new Visit(position, visit.getVisitId(), visit.getSequence(), visit.getTitle(), visit.getContent(),
				visit.getSearchQuery(), visit.isSearchResultPage(), visit.getVisitedAt());
		}
	}
}
