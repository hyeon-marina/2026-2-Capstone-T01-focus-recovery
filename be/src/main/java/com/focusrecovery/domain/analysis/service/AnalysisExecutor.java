package com.focusrecovery.domain.analysis.service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import com.focusrecovery.domain.alert.service.AlertTaskProcessor;
import com.focusrecovery.domain.analysis.client.AiAnalysisClient;
import com.focusrecovery.domain.analysis.client.AiAnalysisOutcome;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;

// 요청을 만든 트랜잭션이 커밋된 뒤 분석 전용 실행기에서 AI를 호출한다: 방문 저장·종료 응답이 AI를 기다리지 않고,
// AI 장애가 그 요청을 실패시키지 않는다. 잠금은 짧은 상태 전이 트랜잭션에서만 잡고 AI 응답을 기다리는 동안에는 잡지 않는다
@Service
public class AnalysisExecutor {

	// BE 내부 실패 코드: 실행기 큐가 가득 차 실행하지 못함 / AI 호출 경계에서 예상하지 못한 예외
	static final String QUEUE_FULL = "ANALYSIS_QUEUE_FULL";
	static final String INTERNAL_ERROR = "ANALYSIS_INTERNAL_ERROR";

	private static final Logger log = LoggerFactory.getLogger(AnalysisExecutor.class);

	private final AnalysisResultRepository analysisResultRepository;
	private final AnalysisWindowRepository analysisWindowRepository;
	private final AiAnalysisClient aiAnalysisClient;
	private final TransactionTemplate transactionTemplate;
	private final TransactionTemplate newTransactionTemplate;
	private final TaskExecutor analysisTaskExecutor;
	private final AlertTaskProcessor alertTaskProcessor;

	public AnalysisExecutor(AnalysisResultRepository analysisResultRepository,
		AnalysisWindowRepository analysisWindowRepository, AiAnalysisClient aiAnalysisClient,
		TransactionTemplate transactionTemplate, PlatformTransactionManager transactionManager,
		@org.springframework.beans.factory.annotation.Qualifier("analysisTaskExecutor") TaskExecutor analysisTaskExecutor, AlertTaskProcessor alertTaskProcessor) {
		this.analysisResultRepository = analysisResultRepository;
		this.analysisWindowRepository = analysisWindowRepository;
		this.aiAnalysisClient = aiAnalysisClient;
		this.transactionTemplate = transactionTemplate;
		this.newTransactionTemplate = new TransactionTemplate(transactionManager);
		this.newTransactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
		this.analysisTaskExecutor = analysisTaskExecutor;
		this.alertTaskProcessor = alertTaskProcessor;
	}

	// 커밋 직후 요청 스레드에서 실행된다. 분석마다 따로 실행기에 넣고, 어떤 예외도 이미 커밋된 요청의 응답으로 올리지 않는다
	@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
	public void onRequested(AnalysisRequestedEvent event) {
		for (UUID analysisId : event.analysisIds()) {
			try {
				analysisTaskExecutor.execute(() -> run(analysisId));
			} catch (TaskRejectedException e) {
				failPending(analysisId, QUEUE_FULL);
			} catch (RuntimeException e) {
				log.error("분석 실행 등록 실패 analysisId={}", analysisId, e);
			}
		}
	}

	// PENDING인 분석만 RUNNING으로 가져가므로 같은 분석을 중복·동시에 실행해도 AI 호출은 한 번이다.
	// 완료·실패를 기록할 때도 RUNNING인지 확인하므로 끝난 결과(복구로 확정된 FAILED 포함)를 덮어쓰지 않는다. BE 자동 재시도는 없다(잠정)
	public void run(UUID analysisId) {
		try {
			Claim claim = transactionTemplate.execute(status -> analysisResultRepository.findForUpdateByAnalysisId(analysisId)
				.filter(analysis -> analysis.getApiContractVersion() == 1 && analysis.getProcessingStatus() == AnalysisStatus.PENDING)
				.map(analysis -> {
					analysis.start(now());
					UUID sessionId = analysisWindowRepository.findById(analysis.getWindowId()).orElseThrow().getSessionId();
					return new Claim(analysis.getInputSnapshot(), sessionId, analysis.getWindowId());
				})
				.orElse(null));
			if (claim == null) {
				return;
			}
			AiAnalysisOutcome outcome;
			try {
				outcome = aiAnalysisClient.analyze(claim.inputSnapshot(), analysisId, claim.sessionId(), claim.windowId());
			} catch (RuntimeException e) {
				log.error("AI 호출 중 예상하지 못한 예외 analysisId={}", analysisId, e);
				outcome = AiAnalysisOutcome.failed(INTERNAL_ERROR);
			}
			if (finish(analysisId, claim.sessionId(), outcome) && isDrift(outcome)) {
				processAlertTask(analysisId);
			}
		} catch (RuntimeException e) {
			// 상태 전이 DB 오류 등: 남은 PENDING·RUNNING은 AnalysisRecovery가 제한 시간 뒤 FAILED로 확정한다
			log.error("분석 처리 실패 analysisId={}", analysisId, e);
		}
	}

	// RUNNING을 완료·실패로 바꿨으면 true. DRIFT로 완료하면 같은 트랜잭션에서 알림 후보 작업을 등록해,
	// 결과 저장 직후 서버가 멈춰도 후보 처리가 누락되지 않게 한다(작업은 AlertTaskProcessor가 다시 찾는다)
	private boolean finish(UUID analysisId, UUID sessionId, AiAnalysisOutcome outcome) {
		return Boolean.TRUE.equals(transactionTemplate.execute(status -> analysisResultRepository
			.findForUpdateByAnalysisId(analysisId)
			.filter(analysis -> analysis.getProcessingStatus() == AnalysisStatus.RUNNING)
			.map(analysis -> {
				analysis.finish(outcome, now());
				if (isDrift(outcome)) {
					alertTaskProcessor.register(analysisId, sessionId);
				}
				return true;
			})
			.orElse(false)));
	}

	private static boolean isDrift(AiAnalysisOutcome outcome) {
		return outcome.errorCode() == null && "DRIFT".equals(outcome.result());
	}

	// 결과 저장이 커밋된 뒤 바로 처리한다. 실패해도 저장된 분석 결과는 그대로이며 작업은 재시도·복구 대상으로 남는다
	private void processAlertTask(UUID analysisId) {
		try {
			alertTaskProcessor.process(analysisId);
		} catch (RuntimeException e) {
			log.error("AI 알림 후보 작업 처리 실패 analysisId={}", analysisId, e);
		}
	}

	// 커밋 후 단계에서는 원래 트랜잭션 자원이 아직 묶여 있으므로 새 트랜잭션으로 기록한다
	private void failPending(UUID analysisId, String errorCode) {
		try {
			newTransactionTemplate.executeWithoutResult(status -> analysisResultRepository.findForUpdateByAnalysisId(analysisId)
				.filter(analysis -> analysis.getApiContractVersion() == 1 && analysis.getProcessingStatus() == AnalysisStatus.PENDING)
				.ifPresent(analysis -> analysis.finish(AiAnalysisOutcome.failed(errorCode), now())));
		} catch (RuntimeException e) {
			log.error("분석 실패 기록 실패 analysisId={} errorCode={}", analysisId, errorCode, e);
		}
	}

	private static Instant now() {
		return Instant.now().truncatedTo(ChronoUnit.MILLIS);
	}

	private record Claim(String inputSnapshot, UUID sessionId, UUID windowId) {
	}
}
