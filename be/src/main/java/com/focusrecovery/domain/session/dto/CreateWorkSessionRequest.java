package com.focusrecovery.domain.session.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "작업 세션 생성 요청")
public record CreateWorkSessionRequest(
	@Schema(description = "작업 목표. 앞뒤 공백을 제외하고 5자 이상 150자 이하", example = "Spring Boot JPA 공부하기",
		requiredMode = Schema.RequiredMode.REQUIRED, minLength = 5, maxLength = 150)
	@NotBlank(message = "작업 목표를 입력해 주세요.")
	@Size(min = 5, max = 150, message = "작업 목표는 5자 이상 150자 이하로 입력해 주세요.")
	String goalText,
	String collectionSpecVersion
) {

	// 검증은 생성 이후에 실행되므로 여기서 공백을 제거해 앞뒤 공백을 뺀 길이로 검증한다
	public CreateWorkSessionRequest {
		goalText = goalText == null ? null : goalText.strip();
	}
}
