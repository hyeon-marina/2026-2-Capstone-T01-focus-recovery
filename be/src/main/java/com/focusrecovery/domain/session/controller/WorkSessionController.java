package com.focusrecovery.domain.session.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.focusrecovery.domain.session.dto.CreateWorkSessionRequest;
import com.focusrecovery.domain.session.dto.EndWorkSessionRequest;
import com.focusrecovery.domain.session.dto.WorkSessionResponse;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.global.exception.InvalidRequestException;
import com.focusrecovery.global.util.Uuids;

import com.focusrecovery.global.exception.ErrorResponse;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@Tag(name = "작업 세션", description = "작업 세션 생성·조회 API")
@RestController
@RequestMapping("/api/sessions")
public class WorkSessionController {

	private final WorkSessionService workSessionService;

	public WorkSessionController(WorkSessionService workSessionService) {
		this.workSessionService = workSessionService;
	}

	@Operation(
		summary = "작업 세션 생성",
		description = """
			작업 목표(goalText)로 새 작업 세션을 시작합니다. 목표의 앞뒤 공백은 제거되어 저장됩니다.

			**Idempotency-Key (선택)**
			- 헤더가 없으면 요청마다 새 세션을 생성합니다. 같은 목표라도 서로 다른 세션이 됩니다.
			- 네트워크 재시도로 인한 중복 생성을 막으려면 "작업 시작" 동작마다 새 키(예: UUID)를 만들고, 재시도할 때는 같은 키를 다시 보냅니다.
			- 같은 키 + 같은 목표로 다시 요청하면 새로 저장하지 않고 기존 세션을 201로 그대로 반환합니다(동시 요청 포함).
			- 같은 키로 다른 목표를 보내면 422를 반환합니다.
			""")
	@ApiResponse(responseCode = "201", description = "세션 생성 성공 (같은 키 재요청 시 기존 세션 반환)")
	@ApiResponse(responseCode = "400", description = "goalText 누락·공백·길이(5~150자) 위반, 요청 본문 오류, Idempotency-Key 형식 오류",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = {
			@ExampleObject(name = "목표 길이 위반", value = """
				{"code": "INVALID_REQUEST", "message": "요청 값이 올바르지 않습니다.",
				 "fieldErrors": [{"field": "goalText", "message": "작업 목표는 5자 이상 150자 이하로 입력해 주세요."}]}"""),
			@ExampleObject(name = "Idempotency-Key 형식 오류", value = """
				{"code": "INVALID_REQUEST", "message": "Idempotency-Key는 1~255자여야 합니다.", "fieldErrors": []}""")
		}))
	@ApiResponse(responseCode = "422", description = "같은 Idempotency-Key로 다른 goalText를 보냄",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "IDEMPOTENCY_KEY_MISMATCH", "message": "같은 Idempotency-Key로 다른 요청 내용이 전달되었습니다.", "fieldErrors": []}""")))
	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public WorkSessionResponse create(
		@Parameter(description = "중복 생성 방지용 키 (선택, 1~255자). 재시도 시 같은 값을 보냅니다.",
			example = "3f1c2a9e-7b4d-4e8a-9c1f-2d6b5a8e0f13")
		@RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
		@Valid @RequestBody CreateWorkSessionRequest request
	) {
		if (idempotencyKey != null && (idempotencyKey.isBlank() || idempotencyKey.length() > 255)) {
			throw new InvalidRequestException("Idempotency-Key는 1~255자여야 합니다.");
		}
		return workSessionService.create(request.goalText(), idempotencyKey, request.collectionSpecVersion());
	}

	@Operation(summary = "작업 세션 조회", description = "세션 ID로 작업 세션 하나를 조회합니다.")
	@ApiResponse(responseCode = "200", description = "조회 성공")
	@ApiResponse(responseCode = "400", description = "세션 ID가 UUID 형식(8-4-4-4-12)이 아님",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "INVALID_REQUEST", "message": "세션 ID가 올바른 UUID 형식이 아닙니다.", "fieldErrors": []}""")))
	@ApiResponse(responseCode = "404", description = "세션이 존재하지 않음",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "SESSION_NOT_FOUND", "message": "작업 세션을 찾을 수 없습니다.", "fieldErrors": []}""")))
	@GetMapping("/{sessionId}")
	public WorkSessionResponse get(
		@Parameter(description = "작업 세션 ID (UUID)", example = "1ba72f77-c166-4e06-88c7-1d6ed919cd9b")
		@PathVariable String sessionId
	) {
		return workSessionService.get(Uuids.parse(sessionId, "세션 ID가 올바른 UUID 형식이 아닙니다."));
	}

	@Operation(
		summary = "작업 세션 종료",
		description = """
			진행 중(ACTIVE)인 작업 세션을 종료(ENDED)하고 서버 현재 시각(UTC, 밀리초)을 endedAt으로 기록합니다.

			**finalBehaviors (선택)**
			- 종료 직전 방문별 마지막 행동 정보입니다. 본문 생략, `{}`, finalBehaviors 생략·null·빈 배열이면 종료만 처리합니다.
			- 각 방문은 이 세션에 속해야 하며(아니면 404 VISIT_NOT_FOUND), 방문 행동 정보 갱신(PATCH)과 같은 버전·누적값 규칙으로 반영됩니다.
			  낮은 버전과 같은 버전·같은 값은 무시되고, 같은 버전·다른 값과 높은 버전의 누적값 감소는 409입니다.
			- 행동 정보 반영과 종료는 하나의 트랜잭션입니다. 하나라도 실패하면 행동 정보와 종료 모두 반영되지 않고 세션은 ACTIVE로 남습니다.

			- 이미 종료된 세션에 다시 요청하면 finalBehaviors를 반영하지 않고 200으로 기존 세션을 반환하며, 최초 endedAt이 유지됩니다(동시 요청 포함).
			- goalText, startedAt과 저장된 방문 기록은 그대로 유지됩니다.
			- 종료 후에는 새 방문 저장과 행동 정보 갱신이 409 SESSION_ENDED로 거절됩니다. 이미 저장된 같은 방문의 재전송(200), 세션 조회와 방문 목록 조회는 계속 가능합니다.
			""")
	@ApiResponse(responseCode = "200", description = "종료 성공 또는 이미 종료된 세션 (status=ENDED, endedAt 포함)")
	@ApiResponse(responseCode = "400", description = "세션 ID가 UUID 형식이 아님, finalBehaviors 항목의 필수값 누락·음수·잘못된 방문 ID",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "INVALID_REQUEST", "message": "세션 ID가 올바른 UUID 형식이 아닙니다.", "fieldErrors": []}""")))
	@ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND: 세션 없음 / VISIT_NOT_FOUND: finalBehaviors의 방문이 이 세션에 없음",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = {
			@ExampleObject(name = "SESSION_NOT_FOUND", value = """
				{"code": "SESSION_NOT_FOUND", "message": "작업 세션을 찾을 수 없습니다.", "fieldErrors": []}"""),
			@ExampleObject(name = "VISIT_NOT_FOUND", value = """
				{"code": "VISIT_NOT_FOUND", "message": "해당 세션에서 방문 기록을 찾을 수 없습니다.", "fieldErrors": []}""")
		}))
	@ApiResponse(responseCode = "409", description = "BEHAVIOR_VERSION_CONFLICT: 같은 버전에 다른 값 / "
		+ "BEHAVIOR_COUNTER_DECREASED: 높은 버전에서 누적값 감소 (세션은 종료되지 않음)",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "BEHAVIOR_COUNTER_DECREASED", "message": "더 높은 버전에서 누적값이 감소했습니다.", "fieldErrors": []}""")))
	@PostMapping("/{sessionId}/end")
	public WorkSessionResponse end(
		@Parameter(description = "작업 세션 ID (UUID)", example = "1ba72f77-c166-4e06-88c7-1d6ed919cd9b")
		@PathVariable String sessionId,
		@Valid @RequestBody(required = false) EndWorkSessionRequest request
	) {
		return workSessionService.end(Uuids.parse(sessionId, "세션 ID가 올바른 UUID 형식이 아닙니다."),
			request == null ? null : request.finalBehaviors());
	}
}
