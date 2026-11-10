package com.focusrecovery.global.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import com.focusrecovery.domain.alert.exception.AlertNotFoundException;
import com.focusrecovery.domain.analysis.exception.AnalysisNotFoundException;
import com.focusrecovery.domain.session.exception.IdempotencyKeyMismatchException;
import com.focusrecovery.domain.session.exception.SessionNotFoundException;
import com.focusrecovery.domain.visit.exception.VisitNotFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

	private static final String INVALID_REQUEST = "INVALID_REQUEST";

	@ExceptionHandler(MethodArgumentNotValidException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public ErrorResponse handleValidation(MethodArgumentNotValidException e) {
		return new ErrorResponse(
			INVALID_REQUEST,
			"요청 값이 올바르지 않습니다.",
			e.getBindingResult().getFieldErrors().stream()
				.map(error -> new ErrorResponse.FieldError(error.getField(), error.getDefaultMessage()))
				.toList()
		);
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public ErrorResponse handleUnreadable(HttpMessageNotReadableException e) {
		return ErrorResponse.of(INVALID_REQUEST, "요청 본문을 읽을 수 없습니다.");
	}

	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public ErrorResponse handleTypeMismatch(MethodArgumentTypeMismatchException e) {
		return ErrorResponse.of(INVALID_REQUEST, e.getName() + " 값의 형식이 올바르지 않습니다.");
	}

	@ExceptionHandler(InvalidRequestException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	public ErrorResponse handleInvalidRequest(InvalidRequestException e) {
		return ErrorResponse.of(INVALID_REQUEST, e.getMessage());
	}

	@ExceptionHandler(SessionNotFoundException.class)
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public ErrorResponse handleSessionNotFound(SessionNotFoundException e) {
		return ErrorResponse.of("SESSION_NOT_FOUND", e.getMessage());
	}

	@ExceptionHandler(IdempotencyKeyMismatchException.class)
	@ResponseStatus(HttpStatus.UNPROCESSABLE_CONTENT)
	public ErrorResponse handleIdempotencyKeyMismatch(IdempotencyKeyMismatchException e) {
		return ErrorResponse.of("IDEMPOTENCY_KEY_MISMATCH", e.getMessage());
	}

	@ExceptionHandler(VisitNotFoundException.class)
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public ErrorResponse handleVisitNotFound(VisitNotFoundException e) {
		return ErrorResponse.of("VISIT_NOT_FOUND", e.getMessage());
	}

	@ExceptionHandler(AlertNotFoundException.class)
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public ErrorResponse handleAlertNotFound(AlertNotFoundException e) {
		return ErrorResponse.of("ALERT_NOT_FOUND", e.getMessage());
	}

	@ExceptionHandler(com.focusrecovery.domain.window.exception.WindowNotFoundException.class)
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public ErrorResponse handleWindowNotFound(com.focusrecovery.domain.window.exception.WindowNotFoundException e) {
		return ErrorResponse.of("WINDOW_NOT_FOUND", e.getMessage());
	}

	@ExceptionHandler(AnalysisNotFoundException.class)
	@ResponseStatus(HttpStatus.NOT_FOUND)
	public ErrorResponse handleAnalysisNotFound(AnalysisNotFoundException e) {
		return ErrorResponse.of("ANALYSIS_NOT_FOUND", e.getMessage());
	}

	// 저장 오류의 원문/예외 traceback도 개인정보 사본이 될 수 있으므로 기록하지 않는다.
	@ExceptionHandler(StoredDataException.class)
	@ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
	public ErrorResponse handleStoredData(StoredDataException e) {
		log.error("저장 데이터 처리 실패 type={}", e.getClass().getSimpleName());
		return ErrorResponse.of("INTERNAL_ERROR", "서버 내부 오류가 발생했습니다.");
	}

	@ExceptionHandler(ConflictException.class)
	@ResponseStatus(HttpStatus.CONFLICT)
	public ErrorResponse handleConflict(ConflictException e) {
		return ErrorResponse.of(e.getCode(), e.getMessage());
	}
}
