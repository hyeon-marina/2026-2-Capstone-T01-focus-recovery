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
}
