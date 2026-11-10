package com.focusrecovery.domain.analysis.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import com.focusrecovery.domain.analysis.dto.AnalysisSummaryResponse;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;

import jakarta.persistence.LockModeType;

public interface AnalysisResultRepository extends JpaRepository<AnalysisResult, UUID> {

	// 상태 전이(PENDING→RUNNING, RUNNING→완료/실패)를 분석 행 단위로 직렬화한다. AI 호출 중에는 잡지 않는다
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	Optional<AnalysisResult> findForUpdateByAnalysisId(UUID analysisId);

	Optional<AnalysisResult> findByWindowId(UUID windowId);

	// from < windowIndex < to 구간 중 NORMAL·TRANSITION으로 완료된 분석이 있는지(정상 복귀 여부)
	@Query("""
		select count(r) > 0 from AnalysisResult r join AnalysisWindow w on w.windowId = r.windowId
		where w.sessionId = :sessionId and w.windowIndex > :from and w.windowIndex < :to
			and r.processingStatus = :status and r.result in ('NORMAL', 'TRANSITION')""")
	boolean existsCompletedBetween(UUID sessionId, int from, int to, AnalysisStatus status);

	// 목록·최신 상태는 큰 JSON 컬럼(input_snapshot 등)을 읽지 않도록 요약 필드만 조회한다. 최신 여부는 windowIndex로만 판단한다
	@Query(value = """
		select new com.focusrecovery.domain.analysis.dto.AnalysisSummaryResponse(
			r.analysisId, r.windowId, w.windowIndex, r.processingStatus, r.result, r.pNormal, r.pTransition, r.pDrift,
			r.requestedAt, r.analyzedAt, r.completedAt, r.errorCode)
		from AnalysisResult r join AnalysisWindow w on w.windowId = r.windowId
		where w.sessionId = :sessionId order by w.windowIndex desc""",
		countQuery = """
			select count(r) from AnalysisResult r join AnalysisWindow w on w.windowId = r.windowId
			where w.sessionId = :sessionId""")
	Page<AnalysisSummaryResponse> findSummariesBySessionId(UUID sessionId, Pageable pageable);

	@Query("""
		select new com.focusrecovery.domain.analysis.dto.AnalysisSummaryResponse(
			r.analysisId, r.windowId, w.windowIndex, r.processingStatus, r.result, r.pNormal, r.pTransition, r.pDrift,
			r.requestedAt, r.analyzedAt, r.completedAt, r.errorCode)
		from AnalysisResult r join AnalysisWindow w on w.windowId = r.windowId
		where w.sessionId = :sessionId and r.processingStatus = :status order by w.windowIndex desc""")
	List<AnalysisSummaryResponse> findSummariesBySessionIdAndStatus(UUID sessionId, AnalysisStatus status, Pageable pageable);

	// 조건부 갱신이라 그사이 완료·실패로 바뀐 분석은 건드리지 않는다
	@Modifying
	@Query("""
		update AnalysisResult r set r.processingStatus = com.focusrecovery.domain.analysis.entity.AnalysisStatus.FAILED,
			r.errorCode = :errorCode, r.completedAt = :now
		where r.processingStatus = com.focusrecovery.domain.analysis.entity.AnalysisStatus.PENDING
			and r.apiContractVersion = 1 and r.requestedAt < :cutoff""")
	int failPendingRequestedBefore(Instant cutoff, String errorCode, Instant now);

	// started_at이 없는 RUNNING은 V5 이전에 시작된 행이다: 시작 시각을 모르므로 requested_at과 별도 기준(legacyCutoff)으로 판단한다
	@Modifying
	@Query("""
		update AnalysisResult r set r.processingStatus = com.focusrecovery.domain.analysis.entity.AnalysisStatus.FAILED,
			r.errorCode = :errorCode, r.completedAt = :now
		where r.processingStatus = com.focusrecovery.domain.analysis.entity.AnalysisStatus.RUNNING
			and r.apiContractVersion = 1 and (r.startedAt < :cutoff or (r.startedAt is null and r.requestedAt < :legacyCutoff))""")
	int failRunningStartedBefore(Instant cutoff, Instant legacyCutoff, String errorCode, Instant now);
}
