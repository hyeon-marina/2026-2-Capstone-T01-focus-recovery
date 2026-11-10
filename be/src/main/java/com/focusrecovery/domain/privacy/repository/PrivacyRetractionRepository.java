package com.focusrecovery.domain.privacy.repository;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import com.focusrecovery.domain.privacy.entity.PrivacyRetraction;
public interface PrivacyRetractionRepository extends JpaRepository<PrivacyRetraction, UUID> {

}
