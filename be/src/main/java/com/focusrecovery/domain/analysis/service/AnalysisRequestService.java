package com.focusrecovery.domain.analysis.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.focusrecovery.domain.analysis.client.AiAnalysisRequest;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.entity.PageVisit;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;

import tools.jackson.databind.json.JsonMapper;

// 수집 명세 8항: 구간 생성과 분석을 분리하고, 마지막 방문의 행동 정보가 준비된 구간만 분석을 요청한다.
// 지금 API로 판별 가능한 준비 시점은 마지막 방문의 누적 활성 체류 10초 도달과 세션 종료뿐이다.
// 10초 전 이탈은 알 수 있는 필드가 없어 세션 종료 때 함께 요청한다(FE·BE 계약 확정 전)
@Service
public class AnalysisRequestService {

	static final long READY_ACTIVE_DURATION_MS = 10_000;

	private final AnalysisWindowRepository analysisWindowRepository;
	private final AnalysisResultRepository analysisResultRepository;
	private final PageVisitRepository pageVisitRepository;
	private final WorkSessionRepository workSessionRepository;
	private final JsonMapper jsonMapper;
	private final ApplicationEventPublisher eventPublisher;

	public AnalysisRequestService(AnalysisWindowRepository analysisWindowRepository,
		AnalysisResultRepository analysisResultRepository, PageVisitRepository pageVisitRepository,
		WorkSessionRepository workSessionRepository, JsonMapper jsonMapper, ApplicationEventPublisher eventPublisher) {
		this.analysisWindowRepository = analysisWindowRepository;
		this.analysisResultRepository = analysisResultRepository;
		this.pageVisitRepository = pageVisitRepository;
		this.workSessionRepository = workSessionRepository;
		this.jsonMapper = jsonMapper;
		this.eventPublisher = eventPublisher;
	}

	// 방문 저장: 세션 쓰기 잠금 안에서 호출되므로 세션의 모든 미요청 구간을 볼 수 있다
	@Transactional(propagation = Propagation.MANDATORY)
	public void requestReadyWindows(UUID sessionId, Instant now) {
		request(analysisWindowRepository.findUnrequestedBySessionId(sessionId).stream()
			.filter(this::lastVisitReady).toList(), now);
	}

	// 행동 갱신: 세션 공유 잠금 + 해당 방문 쓰기 잠금만 있으므로 그 방문으로 끝나는 구간만 본다(다른 방문과의 중복 요청 방지)
	@Transactional(propagation = Propagation.MANDATORY)
	public void requestWindowsEndingAt(UUID sessionId, UUID visitId, Instant now) {
		request(analysisWindowRepository.findUnrequestedBySessionId(sessionId).stream()
			.filter(window -> window.getEndVisitId().equals(visitId))
			.filter(this::lastVisitReady).toList(), now);
	}

	// 세션 종료: 모든 방문의 행동 정보가 확정되므로 아직 요청하지 않은 구간을 모두 요청한다
	@Transactional(propagation = Propagation.MANDATORY)
	public void requestAllWindows(UUID sessionId, Instant now) {
		request(analysisWindowRepository.findUnrequestedBySessionId(sessionId), now);
	}

	private boolean lastVisitReady(AnalysisWindow window) {
		return pageVisitRepository.findById(window.getEndVisitId())
			.map(visit -> visit.getActiveDurationMs() >= READY_ACTIVE_DURATION_MS)
			.orElse(false);
	}

	// 입력 스냅샷은 이 트랜잭션에서 고정하고, AI 호출은 커밋 후 AnalysisExecutor가 한다(롤백되면 호출되지 않음)
	private void request(List<AnalysisWindow> windows, Instant now) {
		windows = windows.stream().filter(window -> window.getApiContractVersion() == 1).toList();
		if (windows.isEmpty()) {
			return;
		}
		List<UUID> analysisIds = windows.stream().sorted(Comparator.comparingInt(AnalysisWindow::getWindowIndex))
			.map(window -> {
				UUID analysisId = UUID.randomUUID();
				analysisResultRepository.save(AnalysisResult.request(analysisId, window.getWindowId(),
					jsonMapper.writeValueAsString(snapshot(analysisId, window)), now));
				return analysisId;
			}).toList();
		analysisResultRepository.flush();
		eventPublisher.publishEvent(new AnalysisRequestedEvent(analysisIds));
	}

	private AiAnalysisRequest snapshot(UUID analysisId, AnalysisWindow window) {
		String goalText = workSessionRepository.findById(window.getSessionId()).orElseThrow().getGoalText();
		List<UUID> visitIds = window.getVisitIds();
		Map<UUID, PageVisit> visits = pageVisitRepository.findAllById(visitIds).stream()
			.collect(Collectors.toMap(PageVisit::getVisitId, Function.identity()));
		List<AiAnalysisRequest.Visit> items = new ArrayList<>();
		for (int i = 0; i < visitIds.size(); i++) {
			PageVisit visit = visits.get(visitIds.get(i));
			items.add(new AiAnalysisRequest.Visit(i + 1, visit.getVisitId(), visit.getSequence(), visit.getBrowserTabKey(),
				visit.getNormalizedUrl(), visit.getDomain(), visit.getTitle(), visit.getContent(), visit.getSearchQuery(),
				visit.isSearchResultPage(), visit.getVisitedAt(), visit.getActiveDurationMs(), visit.getTabSwitchCount(),
				visit.getBehaviorVersion()));
		}
		return new AiAnalysisRequest(analysisId, window.getSessionId(), window.getWindowId(), window.getWindowIndex(),
			goalText, items);
	}
}
