package com.focusrecovery.domain.alert.service;

import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.focusrecovery.domain.alert.dto.AlertHistoryItem;
import com.focusrecovery.domain.alert.dto.AlertHistoryPageResponse;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.exception.ConflictException;



// 알림·사용자 선택 이력 조회(읽기 전용). 현재 후보 여부·알림 모드·표시 가능 조건과 무관하게 세션의 모든 알림을 반환하며,
// AI 호출·후보 생성·shownAt 기록·복구 처리를 하지 않는다.
// offset 페이지는 요청마다 따로 조회하므로 활성 세션에서 페이지 사이에 새 알림이 생기면 중복·변동이 생길 수 있다.
// 후속 개선: 일관된 연속 조회를 위한 (createdAt, alertId) 커서 방식(현재 인덱스 idx_notification_session_created로 지원 가능)
@Service
@Transactional(readOnly = true)
public class AlertHistoryService {

	private final WorkSessionRepository workSessionRepository;
	private final NotificationRepository notificationRepository;
	private final V2StorageGate v2Gate;

	public AlertHistoryService(WorkSessionRepository workSessionRepository, NotificationRepository notificationRepository, V2StorageGate v2Gate) {
		this.v2Gate = v2Gate;
		this.workSessionRepository = workSessionRepository;
		this.notificationRepository = notificationRepository;
	}

	public AlertHistoryPageResponse history(UUID sessionId, int page, int size) {
		WorkSession session = workSessionRepository.findForShareBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		return AlertHistoryPageResponse.from(notificationRepository.findHistoryBySessionId(sessionId, PageRequest.of(page, size))
			.map(row -> AlertHistoryItem.of(row, session.getGoalText())));
	}
}
