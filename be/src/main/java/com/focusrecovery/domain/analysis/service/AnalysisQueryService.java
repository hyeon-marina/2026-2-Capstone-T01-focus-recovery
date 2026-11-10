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
	private final V2AnalysisQueryService v2;
	private final tools.jackson.databind.json.JsonMapper mapper;

	public AnalysisQueryService(WorkSessionRepository workSessionRepository,
		AnalysisResultRepository analysisResultRepository, AnalysisWindowRepository analysisWindowRepository,
		PageVisitRepository pageVisitRepository, StoredJsonReader storedJsonReader, AlertService alertService, V2StorageGate v2Gate, V2AnalysisQueryService v2, tools.jackson.databind.json.JsonMapper mapper) {
		this.v2 = v2; this.mapper = mapper; this.workSessionRepository = workSessionRepository;
		this.analysisResultRepository = analysisResultRepository;
		this.analysisWindowRepository = analysisWindowRepository;
		this.pageVisitRepository = pageVisitRepository;
		this.storedJsonReader = storedJsonReader;
		this.alertService = alertService; this.v2Gate = v2Gate;
	}

	// 최신 여부는 windowIndex로만 판단한다(완료 시각·응답 도착 순서 무관). alert는 읽기만 하며 후보를 만들지 않는다
	public Object status(UUID sessionId) {
		WorkSession session = workSessionRepository.findForShareBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		if (session.isV2()) {
			v2Gate.requireEnabled(); v2Gate.checkConsent(session);
			var latest = session.isQuarantined() ? null : first(analysisResultRepository.findSummariesBySessionId(sessionId, FIRST).getContent());
			var completed = session.isQuarantined() ? null : first(analysisResultRepository.findSummariesBySessionIdAndStatus(sessionId, AnalysisStatus.COMPLETED, FIRST));
			return new com.focusrecovery.domain.analysis.dto.V2AnalysisStatusResponse(2, sessionId, session.getStatus(),
				v2.current(session), v2.lastSuccess(session), com.focusrecovery.domain.alert.dto.V2AlertResponse.of(alertService.currentCandidate(session)), latest, completed);
		}
		legacyAccess(session);
		AnalysisSummaryResponse latest = first(analysisResultRepository.findSummariesBySessionId(sessionId, FIRST).getContent());
		AnalysisSummaryResponse latestCompleted = first(
			analysisResultRepository.findSummariesBySessionIdAndStatus(sessionId, AnalysisStatus.COMPLETED, FIRST));
		return new AnalysisStatusResponse(sessionId, session.getStatus(), latest, latestCompleted,
			alertService.currentCandidate(session));
	}

	public Object list(UUID sessionId, int page, int size) {
		var session = workSessionRepository.findForShareBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		var result = AnalysisPageResponse.from(analysisResultRepository.findSummariesBySessionId(sessionId, PageRequest.of(page, size)));
		if (!session.isV2()) return result;
		var body = (tools.jackson.databind.node.ObjectNode) mapper.valueToTree(result);
		for (var item : body.get("items")) {
			var row = (tools.jackson.databind.node.ObjectNode) item;
			var window = analysisWindowRepository.findById(UUID.fromString(row.get("windowId").stringValue())).orElseThrow();
			row.put("apiContractVersion", 2); row.set("currentDecision", mapper.valueToTree(v2.decision(session, window)));
		}
		return body;
	}

	// 다른 세션의 분석은 이 세션에서 찾을 수 없는 리소스(404)로 처리한다
	public Object detail(UUID sessionId, UUID analysisId) {
		var session = workSessionRepository.findForShareBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		AnalysisResult analysis = analysisResultRepository.findById(analysisId).orElseThrow(AnalysisNotFoundException::new);
		AnalysisWindow window = analysisWindowRepository.findById(analysis.getWindowId())
			.filter(found -> found.getSessionId().equals(sessionId))
			.orElseThrow(AnalysisNotFoundException::new);
		var result = AnalysisDetailResponse.of(analysis, window, windowVisits(analysisId, window), storedJsonReader);
		if (!session.isV2()) return result;
		var body = (tools.jackson.databind.node.ObjectNode) mapper.valueToTree(result);
		body.put("apiContractVersion", 2); body.set("currentDecision", mapper.valueToTree(v2.decision(session, window)));
		body.set("pageResults", analysis.getPageResults() == null ? mapper.nullNode() : mapper.readTree(analysis.getPageResults()));
		return body;
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
