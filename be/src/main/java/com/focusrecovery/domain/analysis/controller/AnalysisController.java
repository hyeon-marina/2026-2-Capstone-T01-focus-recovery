package com.focusrecovery.domain.analysis.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.focusrecovery.domain.analysis.dto.AnalysisDetailResponse;
import com.focusrecovery.domain.analysis.dto.AnalysisPageResponse;
import com.focusrecovery.domain.analysis.dto.AnalysisStatusResponse;
import com.focusrecovery.domain.analysis.service.AnalysisQueryService;
import com.focusrecovery.global.exception.ErrorResponse;
import com.focusrecovery.global.util.Pages;
import com.focusrecovery.global.util.Uuids;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

@Tag(name = "AI 분석 결과", description = "탐색 구간 AI 분석 상태·결과 조회 API (조회 전용)")
@RestController
@RequestMapping("/api/sessions/{sessionId}")
public class AnalysisController {

	private static final String INVALID_SESSION_ID = "세션 ID가 올바른 UUID 형식이 아닙니다.";
	private static final String NOT_FOUND_EXAMPLES = "SESSION_NOT_FOUND: 세션 없음";

	private final AnalysisQueryService analysisQueryService;
	private final com.focusrecovery.domain.analysis.service.V2AnalysisQueryService v2;

	public AnalysisController(AnalysisQueryService analysisQueryService, com.focusrecovery.domain.analysis.service.V2AnalysisQueryService v2) {
		this.analysisQueryService = analysisQueryService; this.v2 = v2;
	}

	@Operation(
		summary = "최신 분석 상태 조회",
		description = """
			FE 주기 조회용입니다. 분석 대기와 실제 판정을 구분합니다. 종료된 세션도 조회할 수 있습니다.

			**latestAnalysis**
			- 저장된 분석 중 windowIndex가 가장 큰 분석입니다(처리 상태 무관). 처리 중·실패면 result와 확률은 null입니다.
			- 최신 여부는 windowIndex로만 판단하며 완료 시각이나 AI 응답 도착 순서와 무관합니다. 분석이 없으면 null입니다.
			- 마지막 방문의 행동 정보가 준비되지 않아 아직 분석 요청이 생성되지 않은 구간은 나타나지 않습니다.

			**latestCompletedAnalysis**
			- COMPLETED 중 windowIndex가 가장 큰 분석으로, 완료된 분석 중 가장 최신인 **참고 결과**입니다. 없으면 null입니다.
			- 현재 탐색 상태를 뜻하지 않으며, 알림 표시를 허용한다는 의미도 아닙니다.
			- FE는 두 분석의 windowIndex를 비교해 서로 다른 구간의 결과인지 구분해야 합니다.
			  예) latestAnalysis가 구간 4의 RUNNING이고 latestCompletedAnalysis가 구간 3의 DRIFT라면, 구간 3의 결과로 새 알림을 표시하면 안 됩니다.
			- 두 windowIndex가 같다는 것만으로 알림을 허용하면 안 됩니다. 아직 분석 요청이 생성되지 않은 더 최신 구간이 있을 수 있습니다.

			**alert (알림 표시 기준)**
			- 실제 알림 표시는 BE가 반환한 alert 후보를 기준으로 합니다. FE는 표시 직전에 세션이 ACTIVE인지와 alertId 중복 여부를 확인합니다.
			- 서버 설정(잠정)으로 활성화된 한 가지 방식(AI 또는 FIXED_INTERVAL)의 아직 표시되지 않은 후보만 반환합니다. 세션별 방식 선택은 아직 지원하지 않습니다.
			- 고정 주기 후보는 현재 회차(startedAt + 간격 × n 중 지금까지 도래한 가장 최근 예정 시각)의 미표시 후보만 반환합니다. 이전 회차 후보는 반환하지 않습니다.
			- AI 후보는 실제 최신 구간(analysis_window의 최대 windowIndex)의 COMPLETED·DRIFT 분석에 연결된 것만 반환합니다. 더 최신 구간이 생겼으면 이전 구간의 후보는 반환하지 않습니다.
			- 반환할 후보가 없거나 세션이 종료됐으면 null입니다. latestCompletedAnalysis가 DRIFT여도 alert가 null이면 알림을 표시하지 않습니다.
			- 같은 후보는 표시 전까지 같은 alertId로 반환됩니다. 실제 표시 확인 API는 후속 작업이라 현재 shownAt은 항상 null입니다.

			조회만 하며 분석·알림 후보를 만들거나 AI를 호출하지 않습니다(AI 후보는 분석 완료 시 BE 내부에서 만듭니다).
			""")
	@ApiResponse(responseCode = "200", description = "조회 성공", content = @Content(schema = @Schema(oneOf = {AnalysisStatusResponse.class, com.focusrecovery.domain.analysis.dto.V2AnalysisStatusResponse.class})))
	@ApiResponse(responseCode = "400", description = "세션 ID가 UUID 형식이 아님",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "INVALID_REQUEST", "message": "세션 ID가 올바른 UUID 형식이 아닙니다.", "fieldErrors": []}""")))
	@ApiResponse(responseCode = "404", description = NOT_FOUND_EXAMPLES,
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "SESSION_NOT_FOUND", "message": "작업 세션을 찾을 수 없습니다.", "fieldErrors": []}""")))
	@GetMapping("/analysis-status")
	public Object status(
		@Parameter(description = "작업 세션 ID (UUID)", example = "1ba72f77-c166-4e06-88c7-1d6ed919cd9b")
		@PathVariable String sessionId
	) {
		return analysisQueryService.status(Uuids.parse(sessionId, INVALID_SESSION_ID));
	}

	@Operation(summary = "v2 Window 상태 이력 조회", description = "stateVersion 내림차순. 합성 테스트 Gate와 개인정보 검사를 적용합니다.")
	@GetMapping("/windows/{windowId}/states")
	public com.focusrecovery.domain.window.dto.WindowStatePage states(@PathVariable String sessionId, @PathVariable String windowId,
		@RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
		Pages.validate(page, size);
		return v2.history(Uuids.parse(sessionId, INVALID_SESSION_ID), Uuids.parse(windowId, "Window ID가 올바른 UUID 형식이 아닙니다."), page, size);
	}

	@Operation(
		summary = "분석 결과 목록 조회",
		description = """
			세션의 분석을 windowIndex 내림차순으로 조회합니다. PENDING·RUNNING·FAILED도 포함하며 실패를 NORMAL로 바꾸지 않습니다.
			목록 항목에는 inputSnapshot 등 JSON 필드가 없습니다(상세 조회에서 확인). 분석이 없으면 빈 목록입니다.
			""")
	@ApiResponse(responseCode = "200", description = "조회 성공", content = @Content(schema = @Schema(implementation = AnalysisPageResponse.class)))
	@ApiResponse(responseCode = "400", description = "잘못된 UUID 또는 페이지네이션 값(page 0 이상, size 1~100, page × size가 int 범위 이내)",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "INVALID_REQUEST", "message": "size는 1 이상 100 이하여야 합니다.", "fieldErrors": []}""")))
	@ApiResponse(responseCode = "404", description = NOT_FOUND_EXAMPLES,
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "SESSION_NOT_FOUND", "message": "작업 세션을 찾을 수 없습니다.", "fieldErrors": []}""")))
	@GetMapping("/analyses")
	public Object list(
		@Parameter(description = "작업 세션 ID (UUID)", example = "1ba72f77-c166-4e06-88c7-1d6ed919cd9b")
		@PathVariable String sessionId,
		@Parameter(description = "페이지 번호 (0부터)", example = "0")
		@RequestParam(defaultValue = "0") int page,
		@Parameter(description = "페이지 크기 (1~100)", example = "20")
		@RequestParam(defaultValue = "20") int size
	) {
		Pages.validate(page, size);
		return analysisQueryService.list(Uuids.parse(sessionId, INVALID_SESSION_ID), page, size);
	}

	@Operation(
		summary = "분석 결과 상세 조회",
		description = """
			분석 요약 필드와 구간 구성·분석 당시 입력·맥락·모델 버전을 조회합니다.

			- visits: 구간 구성 방문 5개(position 1~5 순서)의 visitId·sequence입니다.
			- inputSnapshot: BE가 분석 요청 전에 고정한 목표·방문·행동 입력이며 이후 행동 갱신으로 바뀌지 않습니다.
			- contextResult·inputSnapshot·featureSnapshot·modelVersions는 JSON 객체 또는 null입니다(문자열 아님).
			- 다른 세션의 분석은 404 ANALYSIS_NOT_FOUND입니다.
			""")
	@ApiResponse(responseCode = "200", description = "조회 성공", content = @Content(schema = @Schema(implementation = AnalysisDetailResponse.class)))
	@ApiResponse(responseCode = "400", description = "세션 ID 또는 분석 ID가 UUID 형식이 아님",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = @ExampleObject(value = """
			{"code": "INVALID_REQUEST", "message": "분석 ID가 올바른 UUID 형식이 아닙니다.", "fieldErrors": []}""")))
	@ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND: 세션 없음 / ANALYSIS_NOT_FOUND: 분석이 없거나 다른 세션 소속",
		content = @Content(schema = @Schema(implementation = ErrorResponse.class), examples = {
			@ExampleObject(name = "SESSION_NOT_FOUND", value = """
				{"code": "SESSION_NOT_FOUND", "message": "작업 세션을 찾을 수 없습니다.", "fieldErrors": []}"""),
			@ExampleObject(name = "ANALYSIS_NOT_FOUND", value = """
				{"code": "ANALYSIS_NOT_FOUND", "message": "해당 세션에서 분석 결과를 찾을 수 없습니다.", "fieldErrors": []}""")
		}))
	@GetMapping("/analyses/{analysisId}")
	public Object detail(
		@Parameter(description = "작업 세션 ID (UUID)", example = "1ba72f77-c166-4e06-88c7-1d6ed919cd9b")
		@PathVariable String sessionId,
		@Parameter(description = "분석 ID (UUID)", example = "5b1f0c2e-8d3a-4c7e-9f21-6a4d2b8e1c90")
		@PathVariable String analysisId
	) {
		return analysisQueryService.detail(Uuids.parse(sessionId, INVALID_SESSION_ID),
			Uuids.parse(analysisId, "분석 ID가 올바른 UUID 형식이 아닙니다."));
	}
}
