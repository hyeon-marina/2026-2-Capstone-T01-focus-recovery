package com.focusrecovery.domain.window.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import com.focusrecovery.domain.window.entity.AnalysisWindow;

public interface AnalysisWindowRepository extends JpaRepository<AnalysisWindow, UUID> {

	@Query("select w from AnalysisWindow w join AnalysisResult a on a.windowId = w.windowId where w.apiContractVersion = 2 and w.invalidated = false and w.decisionDirty = true and a.processingStatus = com.focusrecovery.domain.analysis.entity.AnalysisStatus.COMPLETED order by w.createdAt, w.windowIndex")
	List<AnalysisWindow> findReadyDecisions(org.springframework.data.domain.Pageable page);

	@org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
	Optional<AnalysisWindow> findForUpdateByWindowId(UUID windowId);
	List<AnalysisWindow> findBySessionIdOrderByWindowIndex(UUID sessionId);
	@Query("select w from AnalysisWindow w join w.visits v where w.sessionId = :sessionId and v.visitId = :visitId order by w.windowIndex")
	List<AnalysisWindow> findContainingVisit(UUID sessionId, UUID visitId);

	Optional<AnalysisWindow> findFirstBySessionIdOrderByWindowIndexDesc(UUID sessionId);

	@Query("""
		select w from AnalysisWindow w where w.sessionId = :sessionId
		and not exists (select 1 from AnalysisResult r where r.windowId = w.windowId)""")
	List<AnalysisWindow> findUnrequestedBySessionId(UUID sessionId);
}
