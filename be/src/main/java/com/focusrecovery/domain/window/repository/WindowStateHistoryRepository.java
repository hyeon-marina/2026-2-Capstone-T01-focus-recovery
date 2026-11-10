package com.focusrecovery.domain.window.repository;
import java.util.Optional;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import com.focusrecovery.domain.window.entity.WindowStateHistory;
import com.focusrecovery.domain.window.entity.WindowStateId;
public interface WindowStateHistoryRepository extends JpaRepository<WindowStateHistory, WindowStateId> {
	Optional<WindowStateHistory> findByIdWindowIdAndInputFingerprint(UUID windowId, String fingerprint);
	List<WindowStateHistory> findByIdWindowIdOrderByIdStateVersionDesc(UUID windowId);
	Optional<WindowStateHistory> findFirstByIdWindowIdOrderByIdStateVersionDesc(UUID windowId);
	org.springframework.data.domain.Page<WindowStateHistory> findByIdWindowIdOrderByIdStateVersionDesc(UUID windowId, org.springframework.data.domain.Pageable page);
	@org.springframework.data.jpa.repository.Query("select s from WindowStateHistory s join AnalysisWindow w on w.windowId = s.id.windowId where w.sessionId = :sessionId and w.invalidated = false order by w.windowIndex desc, s.id.stateVersion desc")
	List<WindowStateHistory> findSuccessful(UUID sessionId, org.springframework.data.domain.Pageable page);
	@org.springframework.data.jpa.repository.Query("select count(s) > 0 from WindowStateHistory s join AnalysisWindow w on w.windowId = s.id.windowId where w.sessionId = :sessionId and w.invalidated = false and w.decisionDirty = false and w.decisionErrorCode is null and w.windowIndex > :from and w.windowIndex < :to and s.id.stateVersion = w.lastStateVersion and s.finalState in ('NORMAL', 'TRANSITION')")
	boolean existsReturnedBetween(UUID sessionId, int from, int to);
}
