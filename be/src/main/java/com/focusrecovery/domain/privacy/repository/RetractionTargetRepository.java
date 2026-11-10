package com.focusrecovery.domain.privacy.repository;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import com.focusrecovery.domain.privacy.entity.RetractionTarget;
import com.focusrecovery.domain.privacy.entity.RetractionTargetId;
public interface RetractionTargetRepository extends JpaRepository<RetractionTarget, RetractionTargetId> {
	List<RetractionTarget> findByIdRetractionId(UUID retractionId);
}
