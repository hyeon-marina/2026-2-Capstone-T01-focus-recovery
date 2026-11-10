package com.focusrecovery.domain.analysis.service;

import java.time.Clock;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import com.focusrecovery.domain.analysis.client.*;
import com.focusrecovery.domain.analysis.dto.V2AnalysisInput;
import com.focusrecovery.domain.analysis.repository.AnalysisOutboxRepository;
import com.focusrecovery.domain.composition.repository.ComposeRequestRepository;
import com.focusrecovery.domain.composition.service.CompositionService;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.domain.window.service.WindowDecisionService;
import com.focusrecovery.global.config.V2StorageGate;
import tools.jackson.databind.json.JsonMapper;

@Service
public class V2Dispatcher {
	private static final Logger log = LoggerFactory.getLogger(V2Dispatcher.class);
	private static final PageRequest BATCH = PageRequest.of(0, 100);
	private final V2StorageGate gate;
	private final V2DispatchProperties properties;
	private final WorkSessionRepository sessions;
	private final ComposeRequestRepository composeJobs;
	private final AnalysisOutboxRepository analysisJobs;
	private final AnalysisWindowRepository windows;
	private final CompositionService compositions;
	private final V2AnalysisOutboxService analyses;
	private final WindowDecisionService decisions;
	private final V2AiClient ai;
	private final TaskExecutor executor;
	private final JsonMapper mapper;
	private final Clock clock;
	private boolean analysisFirst;
	public V2Dispatcher(V2StorageGate gate, V2DispatchProperties properties, WorkSessionRepository sessions,
		ComposeRequestRepository composeJobs, AnalysisOutboxRepository analysisJobs, AnalysisWindowRepository windows,
		CompositionService compositions, V2AnalysisOutboxService analyses, WindowDecisionService decisions, V2AiClient ai,
		@Qualifier("v2TaskExecutor") TaskExecutor executor, JsonMapper mapper, Clock clock) {
		this.gate = gate; this.properties = properties; this.sessions = sessions; this.composeJobs = composeJobs;
		this.analysisJobs = analysisJobs; this.windows = windows; this.compositions = compositions; this.analyses = analyses;
		this.decisions = decisions; this.ai = ai; this.executor = executor; this.mapper = mapper; this.clock = clock;
	}
	@Scheduled(fixedDelayString = "${focus-recovery.v2.dispatch.interval:1s}", initialDelayString = "${focus-recovery.v2.dispatch.interval:1s}")
	public void dispatch() {
		if (!gate.enabled() || !properties.enabled()) return;
		for (var session : sessions.findDirtyCompositionCandidates(BATCH))
			isolate(() -> compositions.prepareDirty(session.getSessionId()));
		// Alternate admission order so sustained composition traffic cannot starve analyses.
		if (analysisFirst) { submitAnalyses(); submitCompositions(); }
		else { submitCompositions(); submitAnalyses(); }
		analysisFirst = !analysisFirst;
		for (var window : windows.findReadyDecisions(BATCH))
			isolate(() -> decisions.process(window.getSessionId(), window.getWindowId()));
	}
	// Claim and complete are separate proxied transactions; this method never holds a DB transaction across HTTP.
	public void runComposition(UUID sessionId, UUID requestId) {
		isolate(() -> {
			var claim = compositions.claim(sessionId, requestId);
			if (claim == null) return;
			try {
				var output = ai.compose(claim.input());
				compositions.complete(sessionId, requestId, claim.token(), output);
			} catch (V2AiException e) {
				if (e.retryable()) compositions.retryWithBackoff(sessionId, requestId, claim.token(), e.code());
				else compositions.fail(sessionId, requestId, claim.token(), e.code());
			}
		});
	}
	public void runAnalysis(UUID sessionId, UUID analysisId) {
		isolate(() -> {
			var claim = analyses.claim(sessionId, analysisId);
			if (claim == null) return;
			try {
				var input = mapper.readValue(claim.inputSnapshot(), V2AnalysisInput.class);
				analyses.complete(sessionId, analysisId, claim.token(), ai.analyze(input));
			} catch (V2AiException e) {
				// Analysis failures are terminal; even a timeout must not start another model inference.
				analyses.fail(sessionId, analysisId, claim.token(), e.code());
			}
		});
	}
	private void submitCompositions() {
		for (var job : composeJobs.findByProcessingStatusAndNextAttemptAtLessThanEqualOrderByRequestedAt("PENDING", clock.instant(), BATCH))
			submit(() -> runComposition(job.getSessionId(), job.getComposeRequestId()));
	}
	private void submitAnalyses() {
		for (var task : analysisJobs.findByProcessingStatusOrderByRequestedAt("PENDING", BATCH))
			submit(() -> runAnalysis(task.getSessionId(), task.getAnalysisId()));
	}
	private void submit(Runnable work) {
		try { executor.execute(work); } catch (TaskRejectedException e) { /* durable PENDING remains unclaimed */ }
	}
	private static void isolate(Runnable work) {
		try { work.run(); } catch (RuntimeException e) {
			// Includes lost ownership/privacy races. Lease recovery handles DB/commit failures.
			log.warn("v2 작업 미적용 type={}", e.getClass().getSimpleName());
		}
	}
}
