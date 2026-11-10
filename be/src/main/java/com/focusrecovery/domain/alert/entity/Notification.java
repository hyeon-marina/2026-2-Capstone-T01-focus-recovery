package com.focusrecovery.domain.alert.entity;

import java.time.Instant;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;

// 알림 후보. 후보 생성과 실제 표시는 별개이며 shownAt은 실제 표시 확인 때만 기록한다(생성 시각으로 대신하지 않음)
@Entity
@Table(name = "notification")
public class Notification implements Persistable<UUID> {

	@Id
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "alert_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID alertId;

	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "session_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID sessionId;

	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "analysis_id", columnDefinition = "CHAR(36)", updatable = false)
	private UUID analysisId;

	@Enumerated(EnumType.STRING)
	@Column(name = "alert_type", length = 30, nullable = false, updatable = false)
	private AlertType alertType;

	@Column(name = "message", columnDefinition = "TEXT", nullable = false, updatable = false)
	private String message;

	@Column(name = "created_at", columnDefinition = "DATETIME(3)", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "shown_at", columnDefinition = "DATETIME(3)")
	private Instant shownAt;

	// 고정 주기 후보의 예정 회차 시각. AI 후보는 null
	@Column(name = "scheduled_at", columnDefinition = "DATETIME(3)", updatable = false)
	private Instant scheduledAt;

	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "window_id", columnDefinition = "CHAR(36)", updatable = false)
	private UUID windowId;
	@Column(name = "state_version", updatable = false)
	private Long stateVersion;
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "state_analysis_id", columnDefinition = "CHAR(36)", updatable = false)
	private UUID stateAnalysisId;
	@Column(name = "invalidated_at", columnDefinition = "DATETIME(3)")
	private Instant invalidatedAt;
	public UUID getWindowId() { return windowId; }
	public Long getStateVersion() { return stateVersion; }
	public Instant getInvalidatedAt() { return invalidatedAt; }
	public void invalidate(Instant at) { if (shownAt == null && invalidatedAt == null) invalidatedAt = at; }
	public static Notification v2(UUID sessionId, UUID windowId, long version, UUID analysisId, String message, Instant now) {
		Notification n = create(sessionId, null, AlertType.AI, message, now);
		n.windowId = windowId; n.stateVersion = version; n.stateAnalysisId = analysisId; return n;
	}

	// 서버가 ID를 발급하므로 save()가 merge(조회 후 INSERT)하지 않도록 항상 INSERT 하게 한다
	@Transient
	private boolean isNew = true;

	protected Notification() {
	}

	public static Notification ai(UUID sessionId, UUID analysisId, String message, Instant createdAt) {
		return create(sessionId, analysisId, AlertType.AI, message, createdAt);
	}

	public static Notification fixedInterval(UUID sessionId, String message, Instant scheduledAt, Instant createdAt) {
		Notification notification = create(sessionId, null, AlertType.FIXED_INTERVAL, message, createdAt);
		notification.scheduledAt = scheduledAt;
		return notification;
	}

	private static Notification create(UUID sessionId, UUID analysisId, AlertType alertType, String message,
		Instant createdAt) {
		Notification notification = new Notification();
		notification.alertId = UUID.randomUUID();
		notification.sessionId = sessionId;
		notification.analysisId = analysisId;
		notification.alertType = alertType;
		notification.message = message;
		notification.createdAt = createdAt;
		return notification;
	}

	// 실제 화면 표시 시각을 최초 한 번 기록한다(후보 생성·조회 시각으로 대신하지 않음)
	public void markShown(Instant shownAt) {
		this.shownAt = shownAt;
	}

	@PostLoad
	@PostPersist
	void markNotNew() {
		isNew = false;
	}

	@Override
	public UUID getId() {
		return alertId;
	}

	@Override
	public boolean isNew() {
		return isNew;
	}

	public UUID getAlertId() {
		return alertId;
	}

	public UUID getSessionId() {
		return sessionId;
	}

	public UUID getAnalysisId() {
		return stateAnalysisId == null ? analysisId : stateAnalysisId;
	}

	public AlertType getAlertType() {
		return alertType;
	}

	public String getMessage() {
		return message;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getShownAt() {
		return shownAt;
	}

	public Instant getScheduledAt() {
		return scheduledAt;
	}
}
