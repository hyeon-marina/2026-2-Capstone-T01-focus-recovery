package com.focusrecovery.domain.privacy.repository;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import com.focusrecovery.domain.privacy.entity.RetractionTarget;
import com.focusrecovery.domain.privacy.entity.RetractionTargetId;
public interface RetractionTargetRepository extends JpaRepository<RetractionTarget, RetractionTargetId> {
	@org.springframework.data.jpa.repository.Query("select t from RetractionTarget t where t.processingStatus in ('PENDING', 'FAILED', 'RUNNING') order by t.nextAttemptAt")
	List<RetractionTarget> findWork(org.springframework.data.domain.Pageable page);
	List<RetractionTarget> findByIdRetractionId(UUID retractionId);
}
