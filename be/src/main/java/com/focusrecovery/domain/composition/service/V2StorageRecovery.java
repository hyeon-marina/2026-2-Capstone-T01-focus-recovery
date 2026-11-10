package com.focusrecovery.domain.composition.service;

import java.time.Clock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import com.focusrecovery.domain.composition.repository.ComposeRequestRepository;
import com.focusrecovery.domain.analysis.repository.AnalysisOutboxRepository;
import com.focusrecovery.domain.analysis.service.V2AnalysisOutboxService;
import com.focusrecovery.global.config.V2StorageGate;

@Service
public class V2StorageRecovery {
	private final V2StorageGate gate;
	private final ComposeRequestRepository compose;
	private final AnalysisOutboxRepository outbox;
	private final CompositionService compositions;
	private final V2AnalysisOutboxService analyses;
	private final Clock clock;
	public V2StorageRecovery(V2StorageGate gate, ComposeRequestRepository compose, AnalysisOutboxRepository outbox,
		CompositionService compositions, V2AnalysisOutboxService analyses, Clock clock) {
		this.gate = gate; this.compose = compose; this.outbox = outbox;
		this.compositions = compositions; this.analyses = analyses; this.clock = clock;
	}
	@Scheduled(fixedDelayString = "${focus-recovery.v2.storage.recovery-interval:30s}",
		initialDelayString = "${focus-recovery.v2.storage.recovery-interval:30s}")
	public void recover() {
		if (!gate.enabled()) return;
		for (var job : compose.findByProcessingStatusAndLeaseUntilLessThanEqual("RUNNING", clock.instant()))
			compositions.recover(job.getSessionId(), job.getComposeRequestId());
		for (var task : outbox.findByProcessingStatusAndLeaseUntilLessThanEqual("RUNNING", clock.instant()))
			analyses.recover(task.getSessionId(), task.getAnalysisId());
	}
}
