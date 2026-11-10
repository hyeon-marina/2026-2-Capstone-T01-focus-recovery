package com.focusrecovery.domain.session.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import com.focusrecovery.domain.session.entity.WorkSession;

import jakarta.persistence.LockModeType;

public interface WorkSessionRepository extends JpaRepository<WorkSession, UUID> {

	@org.springframework.data.jpa.repository.Query("select s from WorkSession s where s.collectionSpecVersion = '2.0' and s.privacyStatus = 'CLEAR' and s.compositionDirty = true and not exists (select 1 from ComposeRequest j where j.activeSessionId = s.sessionId) and not exists (select 1 from ComposeRequest j where j.sessionId = s.sessionId and j.afterSequence = s.composedThroughSequence and j.processingStatus = 'FAILED') order by s.startedAt")
	java.util.List<WorkSession> findDirtyCompositionCandidates(org.springframework.data.domain.Pageable page);

	Optional<WorkSession> findByIdempotencyKey(String idempotencyKey);

	// 공유 잠금: 행동 정보 갱신끼리는 동시에 진행되고, 종료·방문 저장(쓰기 잠금)과는 직렬화된다
	@Lock(LockModeType.PESSIMISTIC_READ)
	Optional<WorkSession> findForShareBySessionId(UUID sessionId);

	// 배타 잠금: 처음부터 쓰기 잠금으로 조회해 공유 잠금→쓰기 잠금 전환(데드락 원인)을 피한다
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	Optional<WorkSession> findForUpdateBySessionId(UUID sessionId);
}
