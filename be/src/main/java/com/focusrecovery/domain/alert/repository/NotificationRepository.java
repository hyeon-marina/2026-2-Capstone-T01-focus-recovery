package com.focusrecovery.domain.alert.repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import com.focusrecovery.domain.alert.dto.AlertHistoryRow;
import com.focusrecovery.domain.alert.entity.AlertType;
import com.focusrecovery.domain.alert.entity.Notification;

import jakarta.persistence.LockModeType;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

	java.util.List<Notification> findByWindowIdAndShownAtIsNull(UUID windowId);
	java.util.List<Notification> findBySessionIdAndShownAtIsNull(UUID sessionId);
	Optional<Notification> findByWindowIdAndStateVersion(UUID windowId, long stateVersion);

	Optional<Notification> findByAnalysisId(UUID analysisId);

	@Lock(LockModeType.PESSIMISTIC_WRITE)
	Optional<Notification> findForUpdateByAlertId(UUID alertId);

	// 이력: 알림 하나당 한 행(응답은 알림당 최대 1개, UNIQUE). 응답·분석이 없어도 빠지지 않도록 LEFT JOIN하고,
	// 정렬·페이지는 DB에서 한다. 분석은 구간 순서를 얻으려고 조인만 하며 JSON 컬럼은 읽지 않는다
	@Query(value = """
		select new com.focusrecovery.domain.alert.dto.AlertHistoryRow(
			n.alertId, n.sessionId, n.alertType, coalesce(n.analysisId, n.stateAnalysisId), w.windowIndex, n.message, n.createdAt, n.shownAt,
			r.feedbackId, r.action, r.selectedAt, n.windowId, n.stateVersion, n.invalidatedAt)
		from Notification n
		left join AnalysisResult a on a.analysisId = coalesce(n.analysisId, n.stateAnalysisId)
		left join AnalysisWindow w on w.windowId = a.windowId
		left join NotificationResponse r on r.alertId = n.alertId
		where n.sessionId = :sessionId
		order by n.createdAt desc, n.alertId desc""",
		countQuery = "select count(n) from Notification n where n.sessionId = :sessionId")
	Page<AlertHistoryRow> findHistoryBySessionId(UUID sessionId, Pageable pageable);

	Optional<Notification> findByAnalysisIdAndShownAtIsNull(UUID analysisId);

	Optional<Notification> findBySessionIdAndScheduledAt(UUID sessionId, Instant scheduledAt);

	@Query("select max(n.shownAt) from Notification n where n.sessionId = :sessionId and n.alertType = :alertType")
	Optional<Instant> findLastShownAt(UUID sessionId, AlertType alertType);

	// 실제 표시된 AI 알림 중 가장 뒤 구간의 windowIndex (shownAt이 없는 후보는 표시된 것으로 보지 않는다)
	@Query("""
		select max(w.windowIndex) from Notification n
		join AnalysisResult r on r.analysisId = coalesce(n.analysisId, n.stateAnalysisId)
		join AnalysisWindow w on w.windowId = r.windowId
		where n.sessionId = :sessionId and n.alertType = com.focusrecovery.domain.alert.entity.AlertType.AI
			and n.shownAt is not null""")
	Optional<Integer> findLastShownAiWindowIndex(UUID sessionId);
}
