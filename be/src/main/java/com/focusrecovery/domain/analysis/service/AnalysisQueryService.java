package com.focusrecovery.domain.analysis.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.focusrecovery.domain.alert.service.AlertService;
import com.focusrecovery.domain.analysis.dto.AnalysisDetailResponse;
import com.focusrecovery.domain.analysis.dto.AnalysisPageResponse;
import com.focusrecovery.domain.analysis.dto.AnalysisStatusResponse;
import com.focusrecovery.domain.analysis.dto.AnalysisSummaryResponse;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.exception.AnalysisNotFoundException;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.exception.StoredDataException;



// 조회 전용: 분석·알림을 만들거나 AI를 호출하거나 상태를 바꾸지 않는다
@Service
@Transactional(readOnly = true)
public class AnalysisQueryService {

	private static final PageRequest FIRST = PageRequest.of(0, 1);

	private final WorkSessionRepository workSessionRepository;
	private final AnalysisResultRepository analysisResultRepository;
	private final AnalysisWindowRepository analysisWindowRepository;
	private final PageVisitRepository pageVisitRepository;
	private final StoredJsonReader storedJsonReader;
	private final AlertService alertService;
	private final V2StorageGate v2Gate;

	public AnalysisQueryService(WorkSessionRepository workSessionRepository,
		AnalysisResultRepository analysisResultRepository, AnalysisWindowRepository analysisWindowRepository,
		PageVisitRepository pageVisitRepository, StoredJsonReader storedJsonReader, AlertService alertService, V2StorageGate v2Gate) {
		this.workSessionRepository = workSessionRepository;
		this.analysisResultRepository = analysisResultRepository;
		this.analysisWindowRepository = analysisWindowRepository;
		this.pageVisitRepository = pageVisitRepository;
		this.storedJsonReader = storedJsonReader;
		this.alertService = alertService; this.v2Gate = v2Gate;
	}

	// 최신 여부는 windowIndex로만 판단한다(완료 시각·응답 도착 순서 무관). alert는 읽기만 하며 후보를 만들지 않는다
	public AnalysisStatusResponse status(UUID sessionId) {
		WorkSession session = workSessionRepository.findById(sessionId).orElseThrow(SessionNotFoundException::new);
		legacyAccess(session);
		AnalysisSummaryResponse latest = first(analysisResultRepository.findSummariesBySessionId(sessionId, FIRST).getContent());
		AnalysisSummaryResponse latestCompleted = first(
			analysisResultRepository.findSummariesBySessionIdAndStatus(sessionId, AnalysisStatus.COMPLETED, FIRST));
		return new AnalysisStatusResponse(sessionId, session.getStatus(), latest, latestCompleted,
			alertService.currentCandidate(session));
	}

	public AnalysisPageResponse list(UUID sessionId, int page, int size) {
		legacyAccess(workSessionRepository.findById(sessionId).orElseThrow(SessionNotFoundException::new));
		return AnalysisPageResponse.from(
			analysisResultRepository.findSummariesBySessionId(sessionId, PageRequest.of(page, size)));
	}

	// 다른 세션의 분석은 이 세션에서 찾을 수 없는 리소스(404)로 처리한다
	public AnalysisDetailResponse detail(UUID sessionId, UUID analysisId) {
		legacyAccess(workSessionRepository.findById(sessionId).orElseThrow(SessionNotFoundException::new));
		AnalysisResult analysis = analysisResultRepository.findById(analysisId).orElseThrow(AnalysisNotFoundException::new);
		AnalysisWindow window = analysisWindowRepository.findById(analysis.getWindowId())
			.filter(found -> found.getSessionId().equals(sessionId))
			.orElseThrow(AnalysisNotFoundException::new);
		return AnalysisDetailResponse.of(analysis, window, windowVisits(analysisId, window), storedJsonReader);
	}

	// window_visit → page_visit 외래키가 방문 존재를 보장하지만, 조회 결과가 구간 구성과 다르면 누락을 건너뛰거나
	// sequence를 채우지 않고 저장 데이터 오류(500)로 처리한다. 응답 순서는 구간의 position 순서다
	private List<AnalysisDetailResponse.Visit> windowVisits(UUID analysisId, AnalysisWindow window) {
		List<UUID> visitIds = window.getVisitIds();
		List<PageVisitRepository.VisitSequence> found = pageVisitRepository.findByVisitIdIn(visitIds);
		Map<UUID, Integer> sequences = new HashMap<>();
		found.forEach(visit -> sequences.put(visit.getVisitId(), visit.getSequence()));
		if (found.size() != visitIds.size() || !sequences.keySet().equals(new HashSet<>(visitIds))) {
			throw new StoredDataException("구간 구성 방문과 조회된 방문이 일치하지 않습니다. analysisId=" + analysisId
				+ " windowId=" + window.getWindowId() + " expected=" + visitIds.size() + " found=" + found.size());
		}
		List<AnalysisDetailResponse.Visit> visits = new ArrayList<>();
		for (int i = 0; i < visitIds.size(); i++) {
			Integer sequence = sequences.get(visitIds.get(i));
			if (sequence == null) {
				throw new StoredDataException("구간 구성 방문의 sequence가 없습니다. analysisId=" + analysisId
					+ " visitId=" + visitIds.get(i));
			}
			visits.add(new AnalysisDetailResponse.Visit(i + 1, visitIds.get(i), sequence));
		}
		return visits;
	}

	private void legacyAccess(WorkSession session) {
		v2Gate.checkAccess(session);
		if (session.isV2()) throw new ConflictException("V2_QUERY_NOT_IMPLEMENTED", "v2 분석 조회는 후속 구현 대상입니다.");
	}

	private static AnalysisSummaryResponse first(List<AnalysisSummaryResponse> summaries) {
		return summaries.isEmpty() ? null : summaries.getFirst();
	}
}
