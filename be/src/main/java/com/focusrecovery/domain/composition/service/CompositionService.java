package com.focusrecovery.domain.composition.service;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.focusrecovery.domain.composition.dto.Composition;
import com.focusrecovery.domain.composition.entity.ComposeRequest;
import com.focusrecovery.domain.composition.repository.ComposeRequestRepository;
import com.focusrecovery.domain.analysis.dto.V2AnalysisInput;
import com.focusrecovery.domain.analysis.entity.AnalysisResult;
import com.focusrecovery.domain.analysis.entity.AnalysisOutbox;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.analysis.repository.AnalysisOutboxRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.visit.entity.PageVisit;
import com.focusrecovery.domain.visit.repository.PageVisitRepository;
import com.focusrecovery.domain.window.entity.AnalysisWindow;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.exception.InvalidRequestException;
import com.focusrecovery.global.util.CanonicalJson;
import tools.jackson.databind.json.JsonMapper;

// 모든 변경은 session → job → window/analysis 순서. 반환된 Claim은 트랜잭션 밖 후속 어댑터용이다.
@Service
public class CompositionService {
	private final WorkSessionRepository sessions;
	private final PageVisitRepository visits;
	private final ComposeRequestRepository jobs;
	private final AnalysisWindowRepository windows;
	private final AnalysisResultRepository analyses;
	private final AnalysisOutboxRepository outbox;
	private final V2StorageGate gate;
	private final CanonicalJson json;
	private final JsonMapper mapper;
	private final Clock clock;
	private final com.focusrecovery.domain.alert.service.V2AlertService alerts;
	private final com.focusrecovery.domain.analysis.service.V2DispatchProperties dispatch;

	public CompositionService(WorkSessionRepository sessions, PageVisitRepository visits, ComposeRequestRepository jobs,
		AnalysisWindowRepository windows, AnalysisResultRepository analyses, AnalysisOutboxRepository outbox,
		V2StorageGate gate, CanonicalJson json, JsonMapper mapper, Clock clock, com.focusrecovery.domain.analysis.service.V2DispatchProperties dispatch, com.focusrecovery.domain.alert.service.V2AlertService alerts) {
		this.dispatch = dispatch; this.alerts = alerts; this.sessions = sessions; this.visits = visits; this.jobs = jobs; this.windows = windows;
		this.analyses = analyses; this.outbox = outbox; this.gate = gate; this.json = json; this.mapper = mapper; this.clock = clock;
	}

	@Transactional
	public Composition.Input prepareNext(UUID sessionId, UUID requestId) {
		WorkSession session = session(sessionId);
		ComposeRequest existing = jobs.findById(requestId).orElse(null);
		if (existing != null) {
			if (!existing.getSessionId().equals(sessionId)) throw conflict("COMPOSE_ID_CONFLICT");
			return input(existing);
		}
		return prepare(sessionId, requestId, session.getComposedThroughSequence(), prefix(sessionId, session.getComposedThroughSequence()));
	}

	@Transactional
	public Composition.Input prepare(UUID sessionId, UUID requestId, int after, List<Composition.Visit> items) {
		WorkSession session = session(sessionId);
		if (requestId == null || requestId.version() != 4 || items == null || items.isEmpty() || items.size() > 256 || after < 0)
			throw new InvalidRequestException("구성 입력이 유효하지 않습니다.");
		List<Composition.Visit> frozen = List.copyOf(items);
		String fingerprint = json.fingerprint(Map.of("apiContractVersion", 2, "composeRequestId", requestId,
			"sessionId", sessionId, "afterSequence", after, "visits", frozen));
		ComposeRequest existing = jobs.findById(requestId).orElse(null);
		if (existing != null) {
			if (!existing.getSessionId().equals(sessionId) || !existing.getInputFingerprint().equals(fingerprint))
				throw conflict("COMPOSE_ID_CONFLICT");
			return input(existing);
		}
		if (jobs.findByActiveSessionId(sessionId).isPresent()) throw conflict("COMPOSE_IN_PROGRESS");
		if (after != session.getComposedThroughSequence()) throw conflict("COMPOSE_CURSOR_CONFLICT");
		if (!frozen.equals(prefix(sessionId, after)) || frozen.getLast().sequence() <= after)
			throw conflict("COMPOSE_INPUT_MISMATCH");
		Composition.Input input = new Composition.Input(2, requestId, sessionId, after, fingerprint, frozen);
		jobs.saveAndFlush(ComposeRequest.pending(requestId, sessionId, after, frozen.getLast().sequence(),
			session.getPrivacyRevision(), fingerprint, json.write(input), now()));
		return input;
	}

	@Transactional
	public Composition.Claim claim(UUID sessionId, UUID requestId) {
		requireActive(session(sessionId));
		ComposeRequest job = job(sessionId, requestId);
		if (!job.getProcessingStatus().equals("PENDING") || (job.getNextAttemptAt() != null && job.getNextAttemptAt().isAfter(now()))) return null;
		return new Composition.Claim(job.claim(now(), dispatch.lease()), input(job));
	}

	@Transactional
	public Composition.Receipt complete(UUID sessionId, UUID requestId, UUID token, Composition.Output output) {
		WorkSession session = session(sessionId); // privacy gate precedes receipt replay
		ComposeRequest job = job(sessionId, requestId);
		if (output == null) throw conflict("AI_INVALID_RESPONSE");
		if (job.getProcessingStatus().equals("COMPLETED")) {
			if (!json.write(output).equals(json.write(mapper.readValue(job.getResponseSnapshot(), Composition.Output.class))))
				throw conflict("COMPOSE_ID_CONFLICT");
			return mapper.readValue(job.getReceipt(), Composition.Receipt.class);
		}
		requireActive(session);
        owned(job, token);
		if (job.getPrivacyRevision() != session.getPrivacyRevision()) throw conflict("COMPOSE_INPUT_MISMATCH");
		if (job.getAfterSequence() != session.getComposedThroughSequence()) throw conflict("COMPOSE_CURSOR_CONFLICT");
		Composition.Input input = input(job);
		validate(job, input, output);
		// Append 이후에도 동결 through 이하 prefix만 비교한다. PATCH는 identity 입력을 바꾸지 않는다.
		List<Composition.Visit> current = prefix(sessionId, job.getAfterSequence()).stream()
			.filter(item -> item.sequence() <= job.getComposedThroughSequence()).toList();
		if (!current.equals(input.visits())) throw conflict("COMPOSE_INPUT_MISMATCH");
		int nextIndex = windows.findFirstBySessionIdOrderByWindowIndexDesc(sessionId)
			.map(AnalysisWindow::getWindowIndex).orElse(0);
		List<Composition.StoredWindow> stored = new ArrayList<>();
		for (Composition.Window item : output.windows()) {
			AnalysisWindow window = windows.saveAndFlush(AnalysisWindow.v2(sessionId, Math.incrementExact(nextIndex), item.visitIds(), now()));
			nextIndex = window.getWindowIndex();
			UUID analysisId = UUID.randomUUID();
			List<V2AnalysisInput.Visit> analysisVisits = new ArrayList<>();
			for (int i = 0; i < item.visitIds().size(); i++) {
				PageVisit visit = visits.findById(item.visitIds().get(i)).orElseThrow();
				if (!visit.getSessionId().equals(sessionId) || !"SUCCESS".equals(visit.getExtractionStatus()) || visit.getActiveDurationMs() < 5000)
					throw conflict("COMPOSE_INPUT_MISMATCH");
				analysisVisits.add(V2AnalysisInput.Visit.of(i + 1, visit));
			}
			String hash = json.fingerprint(Map.of("apiContractVersion", 2, "analysisId", analysisId, "sessionId", sessionId,
				"windowId", window.getWindowId(), "windowIndex", nextIndex, "goalText", session.getGoalText(), "visits", analysisVisits));
			V2AnalysisInput snapshot = new V2AnalysisInput(2, analysisId, sessionId, window.getWindowId(), nextIndex, session.getGoalText(), hash, analysisVisits);
			analyses.saveAndFlush(AnalysisResult.requestV2(analysisId, window.getWindowId(), json.write(snapshot), hash, now()));
			outbox.save(AnalysisOutbox.pending(analysisId, sessionId, session.getPrivacyRevision(), now()));
			stored.add(new Composition.StoredWindow(window.getWindowId(), nextIndex, analysisId));
		}
		if (!stored.isEmpty()) alerts.invalidateSessionPending(sessionId, now());
		Composition.Receipt receipt = new Composition.Receipt(requestId, output.composedThroughSequence(), stored);
		session.composedThrough(output.composedThroughSequence());
		job.complete(json.write(output), json.write(receipt), now());
		outbox.flush();
		return receipt;
	}

	@Transactional
	public void fail(UUID sessionId, UUID requestId, UUID token) {
		session(sessionId); ComposeRequest job = job(sessionId, requestId); owned(job, token);
		job.terminal("FAILED", "AI_COMPOSITION_FAILED", now());
	}

	// Dispatcher가 일시 오류로 분류한 경우 같은 ID/본문을 재사용한다. 이 서비스 안에서는 HTTP를 호출하지 않는다.
	@Transactional
	public void retry(UUID sessionId, UUID requestId, UUID token, String errorCode) {
		session(sessionId); ComposeRequest job = job(sessionId, requestId); owned(job, token);
		if (errorCode == null || !java.util.Set.of("AI_TIMEOUT", "AI_UNAVAILABLE", "AI_NOT_READY", "COMPOSE_IN_PROGRESS", "AI_COMPOSITION_FAILED").contains(errorCode))
			throw new InvalidRequestException("지원하지 않는 구성 재시도 코드입니다.");
		job.retry(now(), errorCode);
	}

	@Transactional
	public void retryWithBackoff(UUID sessionId, UUID requestId, UUID token, String errorCode) {
		retry(sessionId, requestId, token, errorCode);
		ComposeRequest job = job(sessionId, requestId);
		job.deferUntil(now().plus(dispatch.retryBackoff().multipliedBy(1L << Math.min(10, job.getAttempts() - 1))));
	}

	@Transactional
	public void fail(UUID sessionId, UUID requestId, UUID token, String code) {
		session(sessionId); ComposeRequest job = job(sessionId, requestId); owned(job, token);
		job.terminal("FAILED", code, now());
	}

	// dirty is already durable on the session. A failed frozen prefix needs explicit investigation,
	// rather than minting unbounded new IDs and bypassing the three-claim limit.
	@Transactional
	public void prepareDirty(UUID sessionId) {
		WorkSession session = session(sessionId);
		if (!session.isCompositionDirty() || jobs.findByActiveSessionId(sessionId).isPresent()) return;
		var previous = jobs.findFirstBySessionIdOrderByRequestedAtDesc(sessionId);
		if (previous.isPresent() && previous.get().getAfterSequence() == session.getComposedThroughSequence()
			&& previous.get().getProcessingStatus().equals("FAILED")) return;
		prepareNext(sessionId, UUID.randomUUID());
	}

	@Transactional
	public void recover(UUID sessionId, UUID requestId) {
		WorkSession session = session(sessionId); ComposeRequest job = job(sessionId, requestId);
		if (job.getProcessingStatus().equals("RUNNING") && !job.getLeaseUntil().isAfter(now())) {
			if (job.getPrivacyRevision() != session.getPrivacyRevision()) job.terminal("INVALIDATED", "PRIVACY_RETRACTED", now());
			else job.recover(now());
		}
	}

	private void validate(ComposeRequest job, Composition.Input input, Composition.Output output) {
		if (output.apiContractVersion() != 2 || !Objects.equals(output.sessionId(), job.getSessionId())
			|| !Objects.equals(output.composeRequestId(), job.getComposeRequestId()) || output.afterSequence() != job.getAfterSequence()
			|| !Objects.equals(output.inputFingerprint(), job.getInputFingerprint())
			|| output.composedThroughSequence() != job.getComposedThroughSequence() || output.windows() == null
			|| output.windows().size() != Math.max(0, input.visits().size() - 2)) throw conflict("AI_INVALID_RESPONSE");
		// Validation only: AI receives an ordered stream, never preformed windows.
		for (int i = 0; i < output.windows().size(); i++) {
			Composition.Window item = output.windows().get(i);
			List<UUID> expected = input.visits().subList(i, i + 3).stream().map(Composition.Visit::visitId).toList();
			if (item == null || !expected.equals(item.visitIds()) || !expected.getLast().equals(item.endVisitId()))
				throw conflict("AI_INVALID_RESPONSE");
		}
	}
	private List<Composition.Visit> prefix(UUID sessionId, int after) {
		List<PageVisit> items = new ArrayList<>(visits.findBySessionIdAndSequenceLessThanEqualOrderBySequenceDesc(sessionId, after, PageRequest.of(0, 2)));
		items.sort(Comparator.comparingInt(PageVisit::getSequence));
		items.addAll(visits.findBySessionIdAndSequenceGreaterThanOrderBySequence(sessionId, after, PageRequest.of(0, 256 - items.size())));
		return items.stream().map(v -> new Composition.Visit(v.getVisitId(), v.getSequence())).toList();
	}
    private void requireActive(WorkSession session) {
        if (session.getStatus() != com.focusrecovery.domain.session.entity.WorkSessionStatus.ACTIVE) throw conflict("SESSION_ENDED");
    }
	private WorkSession session(UUID id) {
		gate.requireEnabled();
		WorkSession session = sessions.findForUpdateBySessionId(id).orElseThrow(SessionNotFoundException::new);
		gate.requireV2(session); gate.checkPrivacy(session); return session;
	}
	private ComposeRequest job(UUID sessionId, UUID id) {
		return jobs.findById(id).filter(job -> job.getSessionId().equals(sessionId))
			.orElseThrow(() -> conflict("COMPOSE_INPUT_MISMATCH"));
	}
	private Composition.Input input(ComposeRequest job) { return mapper.readValue(job.getInputSnapshot(), Composition.Input.class); }
	private void owned(ComposeRequest job, UUID token) {
		if (!job.getProcessingStatus().equals("RUNNING") || token == null || !token.equals(job.getClaimToken())
			|| !job.getLeaseUntil().isAfter(now())) throw conflict("COMPOSE_CLAIM_LOST");
	}
	private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MILLIS); }
	private static ConflictException conflict(String code) { return new ConflictException(code, "구성 작업을 적용할 수 없습니다."); }
}
