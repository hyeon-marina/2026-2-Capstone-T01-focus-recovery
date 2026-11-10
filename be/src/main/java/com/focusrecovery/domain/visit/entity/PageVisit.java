package com.focusrecovery.domain.visit.entity;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;

@Entity
@Table(name = "page_visit")
public class PageVisit implements Persistable<UUID> {

	@Id
	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "visit_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID visitId;

	@JdbcTypeCode(SqlTypes.CHAR)
	@Column(name = "session_id", columnDefinition = "CHAR(36)", nullable = false, updatable = false)
	private UUID sessionId;

	@Column(name = "sequence", nullable = false, updatable = false)
	private int sequence;

	@Column(name = "browser_tab_key", length = 100, nullable = false, updatable = false)
	private String browserTabKey;

	@Column(name = "normalized_url", columnDefinition = "TEXT", nullable = false, updatable = false)
	private String normalizedUrl;

	@Column(name = "domain", nullable = false, updatable = false)
	private String domain;

	@Column(name = "title", columnDefinition = "TEXT", updatable = false)
	private String title;

	@Column(name = "content", columnDefinition = "MEDIUMTEXT", updatable = false)
	private String content;

	@Column(name = "search_query", columnDefinition = "TEXT", updatable = false)
	private String searchQuery;

	@Column(name = "is_search_result_page", nullable = false, updatable = false)
	private boolean searchResultPage;

	@Column(name = "visited_at", columnDefinition = "DATETIME(3)", nullable = false, updatable = false)
	private Instant visitedAt;

	@Column(name = "active_duration_ms", nullable = false)
	private long activeDurationMs;

	@Column(name = "tab_switch_count", nullable = false)
	private int tabSwitchCount;

	@Column(name = "behavior_version", nullable = false)
	private long behaviorVersion;

	@Column(name = "updated_at", columnDefinition = "DATETIME(3)")
	private Instant updatedAt;

	@Column(name = "extraction_status", length = 30, updatable = false)
	private String extractionStatus;
	public void extracted(String status) { extractionStatus = status; }
	public String getExtractionStatus() { return extractionStatus; }

	// FE가 ID를 발급하므로 save()가 merge(조회 후 UPDATE)로 기존 행을 덮어쓰지 않도록 항상 INSERT 하게 한다
	@Transient
	private boolean isNew = true;

	protected PageVisit() {
	}

	public PageVisit(UUID visitId, UUID sessionId, int sequence, String browserTabKey, String normalizedUrl,
		String domain, String title, String content, String searchQuery, boolean searchResultPage, Instant visitedAt,
		long activeDurationMs, int tabSwitchCount, long behaviorVersion) {
		this.visitId = visitId;
		this.sessionId = sessionId;
		this.sequence = sequence;
		this.browserTabKey = browserTabKey;
		this.normalizedUrl = normalizedUrl;
		this.domain = domain;
		this.title = title;
		this.content = content;
		this.searchQuery = searchQuery;
		this.searchResultPage = searchResultPage;
		this.visitedAt = visitedAt;
		this.activeDurationMs = activeDurationMs;
		this.tabSwitchCount = tabSwitchCount;
		this.behaviorVersion = behaviorVersion;
	}

	public boolean hasSameOriginal(PageVisit other) {
		return Objects.equals(extractionStatus, other.extractionStatus)
			&& sessionId.equals(other.sessionId)
			&& sequence == other.sequence
			&& browserTabKey.equals(other.browserTabKey)
			&& normalizedUrl.equals(other.normalizedUrl)
			&& domain.equals(other.domain)
			&& Objects.equals(title, other.title)
			&& Objects.equals(content, other.content)
			&& Objects.equals(searchQuery, other.searchQuery)
			&& searchResultPage == other.searchResultPage
			&& visitedAt.equals(other.visitedAt);
	}

	public void updateBehavior(long activeDurationMs, int tabSwitchCount, long behaviorVersion, Instant updatedAt) {
		this.activeDurationMs = activeDurationMs;
		this.tabSwitchCount = tabSwitchCount;
		this.behaviorVersion = behaviorVersion;
		this.updatedAt = updatedAt;
	}

	@PostLoad
	@PostPersist
	void markNotNew() {
		isNew = false;
	}

	@Override
	public UUID getId() {
		return visitId;
	}

	@Override
	public boolean isNew() {
		return isNew;
	}

	public UUID getVisitId() {
		return visitId;
	}

	public UUID getSessionId() {
		return sessionId;
	}

	public int getSequence() {
		return sequence;
	}

	public String getBrowserTabKey() {
		return browserTabKey;
	}

	public String getNormalizedUrl() {
		return normalizedUrl;
	}

	public String getDomain() {
		return domain;
	}

	public String getTitle() {
		return title;
	}

	public String getContent() {
		return content;
	}

	public String getSearchQuery() {
		return searchQuery;
	}

	public boolean isSearchResultPage() {
		return searchResultPage;
	}

	public Instant getVisitedAt() {
		return visitedAt;
	}

	public long getActiveDurationMs() {
		return activeDurationMs;
	}

	public int getTabSwitchCount() {
		return tabSwitchCount;
	}

	public long getBehaviorVersion() {
		return behaviorVersion;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}
}
