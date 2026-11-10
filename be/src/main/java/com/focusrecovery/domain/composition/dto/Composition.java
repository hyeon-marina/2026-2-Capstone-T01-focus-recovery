package com.focusrecovery.domain.composition.dto;

import java.util.List;
import java.util.UUID;

// 내부 저장 경계 DTO. Controller나 AI HTTP client는 이번 Issue에서 공개하지 않는다.
public final class Composition {
	private Composition() {}
	public record Visit(UUID visitId, int sequence) {}
	public record Input(int apiContractVersion, UUID composeRequestId, UUID sessionId, int afterSequence,
		String inputFingerprint, List<Visit> visits) {}
	public record Window(List<UUID> visitIds, UUID endVisitId) {}
	public record Output(int apiContractVersion, UUID composeRequestId, UUID sessionId, int afterSequence,
		String inputFingerprint, int composedThroughSequence, List<Window> windows) {}
	public record StoredWindow(UUID windowId, int windowIndex, UUID analysisId) {}
	public record Receipt(UUID composeRequestId, int composedThroughSequence, List<StoredWindow> windows) {}
	public record Claim(UUID token, Input input) {}
}
