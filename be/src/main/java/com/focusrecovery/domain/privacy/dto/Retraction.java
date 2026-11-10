package com.focusrecovery.domain.privacy.dto;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
public final class Retraction {
	private Retraction() {}
	public record Request(UUID retractionId, UUID visitId, String reasonCode, Instant observedAt) {}
	public record Receipt(UUID retractionId, UUID visitId, String status, List<UUID> invalidatedWindowIds) {}
}
