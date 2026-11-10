package com.focusrecovery.domain.composition.repository;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import com.focusrecovery.domain.composition.entity.ComposeRequest;
public interface ComposeRequestRepository extends JpaRepository<ComposeRequest, UUID> {
	java.util.Optional<ComposeRequest> findByActiveSessionId(UUID sessionId);
	java.util.List<ComposeRequest> findBySessionId(UUID sessionId);
	java.util.List<ComposeRequest> findByProcessingStatusAndLeaseUntilLessThanEqual(String status, java.time.Instant now);
	java.util.Optional<ComposeRequest> findFirstBySessionIdOrderByRequestedAtDesc(UUID sessionId);
	java.util.List<ComposeRequest> findByProcessingStatusAndNextAttemptAtLessThanEqualOrderByRequestedAt(String status, java.time.Instant now, org.springframework.data.domain.Pageable page);
}
