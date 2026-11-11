package com.focusrecovery.domain.consent;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.focusrecovery.domain.identity.AuthenticatedParticipant;
import com.focusrecovery.domain.session.dto.WorkSessionResponse;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.exception.IdempotencyKeyMismatchException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.global.config.V2StorageGate;

@Service
public class OwnedSessionService {
    private final WorkSessionRepository sessions;
    private final ConsentService consent;
    private final V2StorageGate gate;
    private final com.focusrecovery.domain.collection.CollectionSitePolicy sites;
    public OwnedSessionService(WorkSessionRepository sessions, ConsentService consent, V2StorageGate gate, com.focusrecovery.domain.collection.CollectionSitePolicy sites) { this.sessions = sessions; this.consent = consent; this.gate = gate; this.sites=sites; }
    @Transactional public WorkSessionResponse create(String goal, String key, String requestedVersion) {
        if(sites.realProfile())throw new com.focusrecovery.global.exception.ConflictException("ASSIGNMENT_REQUIRED","확정된 배정에서 시작하세요.");
        return createAssigned(goal,key,requestedVersion);
    }
    @Transactional public WorkSessionResponse createAssigned(String goal, String key, String requestedVersion) {
        UUID owner = AuthenticatedParticipant.required().participantId();
        consent.lockParticipant(owner);
        UUID consentId = consent.requireConsent(owner);
        String version = gate.version(requestedVersion);
        if(sites.realProfile() && !version.equals("2.0"))throw new com.focusrecovery.global.exception.ConflictException("COLLECTION_VERSION_MISMATCH","실제 수집 배포는 v2 배정만 허용합니다.");
        // Hash the participant-scoped idempotency key; never replay another participant's session.
        String scopedKey = key == null ? null : com.focusrecovery.domain.identity.AuthenticationService.digest(owner + ":" + key);
        if (scopedKey != null) {
            var existing = sessions.findByIdempotencyKey(scopedKey);
            if (existing.isPresent()) {
                var s = existing.get();
                if (!owner.equals(s.getOwnerParticipantId()) || !s.getGoalText().equals(goal.strip()) || !s.getCollectionSpecVersion().equals(version)) throw new IdempotencyKeyMismatchException();
                gate.checkAccess(s); return WorkSessionResponse.from(s);
            }
        }
        if (version.equals("2.0")) gate.requireEnabled();
        var session = WorkSession.start(goal.strip(), scopedKey, version);
        session.assignOwner(owner, consentId);
        sessions.saveAndFlush(session); sites.bind(session);
        return WorkSessionResponse.from(session);
    }
}
