package com.focusrecovery.domain.alert.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.focusrecovery.domain.alert.dto.AlertResponse;
import com.focusrecovery.domain.alert.dto.AlertResponseRequest;
import com.focusrecovery.domain.alert.dto.NotificationResponseResponse;
import com.focusrecovery.domain.alert.entity.Notification;
import com.focusrecovery.domain.alert.entity.NotificationResponse;
import com.focusrecovery.domain.alert.exception.AlertNotFoundException;
import com.focusrecovery.domain.alert.repository.NotificationRepository;
import com.focusrecovery.domain.alert.repository.NotificationResponseRepository;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.entity.WorkSessionStatus;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.exception.ConflictException;
import com.focusrecovery.global.exception.InvalidRequestException;



// 실제 알림 표시 확인과 사용자 선택 저장. 둘 다 shownAt을 처음 기록할 수 있으므로 트랜잭션 시작부터 세션 배타 잠금을 잡고
// 그다음 알림 행을 잠근다(공유 → 배타 전환 없음). AI 후보 생성은 세션 공유 잠금을 먼저 잡으므로, 표시 기록이 커밋될 때까지 기다린 뒤
// 커밋된 표시 이력으로 연속 DRIFT·최소 간격을 판단한다. 잠금 순서는 세션 → 알림 행 → 응답으로 다른 쓰기와 같은 세션 우선 순서다.
// 늦게 도착한 요청을 요청 시점의 현재 후보 여부로 거절하지 않고, 전달된 시각 자체(생성·종료·현재 시각과의 관계)로 판단한다
@Service
public class AlertDisplayService {

	private final NotificationRepository notificationRepository;
	private final NotificationResponseRepository responseRepository;
	private final WorkSessionRepository workSessionRepository;
	private final AlertService alertService;
	private final Clock clock;
	private final Duration tolerance;
	private final V2StorageGate v2Gate;

	public AlertDisplayService(NotificationRepository notificationRepository,
		NotificationResponseRepository responseRepository, WorkSessionRepository workSessionRepository,
		AlertService alertService, Clock clock, AlertProperties properties, V2StorageGate v2Gate) {
		this.v2Gate = v2Gate;
		this.notificationRepository = notificationRepository;
		this.responseRepository = responseRepository;
		this.workSessionRepository = workSessionRepository;
		this.alertService = alertService;
		this.clock = clock;
		this.tolerance = properties.clockSkewTolerance();
	}

	public record ResponseResult(NotificationResponseResponse response, boolean created) {
	}

	// 최초 표시 시각만 기록한다. 같은 값 재전송은 그대로 반환하고 다른 값은 충돌이다
	@Transactional
	public AlertResponse markShown(UUID sessionId, UUID alertId, Instant shownAt) {
		requireMillis(shownAt, "shownAt");
		WorkSession session = workSessionRepository.findForUpdateBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		if (session.isV2()) throw new ConflictException("V2_ALERT_DISABLED", "v2 알림은 비활성 상태입니다.");
		Notification alert = lockAlert(sessionId, alertId);
		if (alert.getShownAt() != null) {
			if (!alert.getShownAt().equals(shownAt)) {
				throw shownAtConflict();
			}
		} else {
			requireDisplayable(alert, session, shownAt);
			alert.markShown(shownAt);
		}
		return alertService.toResponse(alert, session.getGoalText());
	}

	// 최초 선택만 저장한다(201). 같은 action·selectedAt 재전송은 200, 다른 선택은 충돌이다.
	// 표시 확인이 아직 없으면 요청의 shownAt과 선택을 한 트랜잭션에서 저장하므로, 선택 저장이 실패하면 shownAt도 남지 않는다
	@Transactional
	public ResponseResult respond(UUID sessionId, UUID alertId, AlertResponseRequest request) {
		requireMillis(request.selectedAt(), "selectedAt");
		requireMillis(request.shownAt(), "shownAt");
		WorkSession session = workSessionRepository.findForUpdateBySessionId(sessionId).orElseThrow(SessionNotFoundException::new);
		v2Gate.checkAccess(session);
		if (session.isV2()) throw new ConflictException("V2_ALERT_DISABLED", "v2 알림은 비활성 상태입니다.");
		Notification alert = lockAlert(sessionId, alertId);
		if (alert.getShownAt() != null && request.shownAt() != null && !alert.getShownAt().equals(request.shownAt())) {
			throw shownAtConflict();
		}
		Optional<NotificationResponse> existing = responseRepository.findByAlertId(alertId);
		if (existing.isPresent()) {
			if (!existing.get().isSameSelection(request.action(), request.selectedAt())) {
				throw new ConflictException("RESPONSE_ALREADY_RECORDED", "이 알림의 사용자 선택이 이미 저장되었습니다.");
			}
			return new ResponseResult(NotificationResponseResponse.from(existing.get()), false);
		}
		Instant shownAt = alert.getShownAt();
		if (shownAt == null) {
			if (request.shownAt() == null) {
				throw new ConflictException("ALERT_NOT_SHOWN", "표시 시각을 확인할 수 없는 알림입니다.");
			}
			requireDisplayable(alert, session, request.shownAt());
			shownAt = request.shownAt();
			alert.markShown(shownAt);
		}
		// selectedAt과 shownAt은 같은 클라이언트 시계라 허용 오차 없이 비교한다
		if (request.selectedAt().isBefore(shownAt)) {
			throw new InvalidRequestException("selectedAt은 shownAt보다 앞설 수 없습니다.");
		}
		if (request.selectedAt().isAfter(clock.instant().plus(tolerance))) {
			throw new InvalidRequestException("selectedAt이 서버 현재 시각보다 미래입니다.");
		}
		NotificationResponse saved = responseRepository.saveAndFlush(
			NotificationResponse.of(alertId, request.action(), request.selectedAt()));
		return new ResponseResult(NotificationResponseResponse.from(saved), true);
	}

	// 다른 세션의 알림은 이 세션에서 찾을 수 없는 리소스로 처리한다
	private Notification lockAlert(UUID sessionId, UUID alertId) {
		return notificationRepository.findForUpdateByAlertId(alertId)
			.filter(alert -> alert.getSessionId().equals(sessionId))
			.orElseThrow(AlertNotFoundException::new);
	}

	// 클라이언트 시각과 서버 시각 비교에만 허용 오차를 쓴다(잠정 5초). 요청 도착 시각은 보지 않으므로 늦은 확인도 저장된다.
	// 후보 생성 전 표시, 미래 시각, 종료 후 표시는 표시할 수 없었던 알림이다
	private void requireDisplayable(Notification alert, WorkSession session, Instant shownAt) {
		boolean beforeCreated = shownAt.isBefore(alert.getCreatedAt().minus(tolerance));
		boolean future = shownAt.isAfter(clock.instant().plus(tolerance));
		boolean afterEnded = session.getStatus() == WorkSessionStatus.ENDED
			&& shownAt.isAfter(session.getEndedAt().plus(tolerance));
		if (beforeCreated || future || afterEnded) {
			throw new ConflictException("ALERT_NOT_DISPLAYABLE", "해당 시각에 표시될 수 없는 알림입니다.");
		}
	}

	// DATETIME(3)에 그대로 저장할 수 없는 밀리초 미만 값은 보정하지 않고 거절한다
	private static void requireMillis(Instant instant, String field) {
		if (instant != null && instant.getNano() % 1_000_000 != 0) {
			throw new InvalidRequestException(field + "는 밀리초까지만 입력할 수 있습니다.");
		}
	}

	private static ConflictException shownAtConflict() {
		return new ConflictException("ALERT_SHOWN_AT_CONFLICT", "이미 기록된 표시 시각과 다릅니다.");
	}
}
