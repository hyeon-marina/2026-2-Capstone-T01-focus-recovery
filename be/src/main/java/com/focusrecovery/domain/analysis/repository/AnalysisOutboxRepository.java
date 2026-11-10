package com.focusrecovery.domain.analysis.repository;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import com.focusrecovery.domain.analysis.entity.AnalysisOutbox;
public interface AnalysisOutboxRepository extends JpaRepository<AnalysisOutbox, UUID> {
	java.util.List<AnalysisOutbox> findBySessionId(UUID sessionId);
	java.util.List<AnalysisOutbox> findByProcessingStatusOrderByRequestedAt(String status, org.springframework.data.domain.Pageable pageable);
	java.util.List<AnalysisOutbox> findByProcessingStatusAndLeaseUntilLessThanEqual(String status, java.time.Instant now);
    // Current read under the session lock: a withdrawal may already have an older MySQL snapshot.
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    java.util.List<AnalysisOutbox> findForUpdateBySessionId(UUID sessionId);

}
