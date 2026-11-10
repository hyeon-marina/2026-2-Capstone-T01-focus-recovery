package com.focusrecovery.domain.visit.dto;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Type;
import java.util.Set;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;
import com.focusrecovery.global.exception.InvalidRequestException;
import tools.jackson.databind.json.JsonMapper;

// v1 역직렬화 관용성은 유지하고 v2만 필드 생략·문자열 숫자·추가 필드를 구분한다. 원문을 로그에 남기지 않는다.
@ControllerAdvice
public class VisitJsonCapture extends RequestBodyAdviceAdapter {
	private static final String ATTRIBUTE = VisitJsonCapture.class.getName();
	private static final Set<String> FIELDS = Set.of("visitId", "sequence", "browserTabKey", "normalizedUrl", "domain", "title",
		"content", "searchQuery", "isSearchResultPage", "visitedAt", "activeDurationMs", "tabSwitchCount", "behaviorVersion", "extractionStatus");
	@Override
	public boolean supports(MethodParameter parameter, Type type, Class<? extends HttpMessageConverter<?>> converter) {
		return type == CreatePageVisitRequest.class;
	}
	@Override
	public HttpInputMessage beforeBodyRead(HttpInputMessage message, MethodParameter parameter, Type type,
		Class<? extends HttpMessageConverter<?>> converter) throws IOException {
		byte[] bytes = message.getBody().readAllBytes();
		RequestContextHolder.currentRequestAttributes().setAttribute(ATTRIBUTE, bytes, RequestAttributes.SCOPE_REQUEST);
		return new HttpInputMessage() {
			public InputStream getBody() { return new ByteArrayInputStream(bytes); }
			public HttpHeaders getHeaders() { return message.getHeaders(); }
		};
	}
	public static void validateV2(JsonMapper mapper) {
		var attributes = RequestContextHolder.getRequestAttributes();
		if (attributes == null) return; // 내부 호출은 typed DTO 및 서비스 검증을 사용한다.
		byte[] bytes = (byte[]) attributes.getAttribute(ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
		if (bytes == null) return;
		var node = mapper.readTree(bytes);
		var fields = new java.util.HashSet<String>(); node.properties().forEach(e -> fields.add(e.getKey()));
		if (!node.isObject() || !fields.equals(FIELDS)) throw invalid();
		for (String field : FIELDS) {
			var value = node.get(field);
			boolean valid = switch (field) {
				case "sequence", "activeDurationMs", "tabSwitchCount", "behaviorVersion" -> value.isIntegralNumber();
				case "isSearchResultPage" -> value.isBoolean();
				case "searchQuery" -> value.isString() || value.isNull();
				default -> value.isString();
			};
			if (!valid) throw invalid();
		}
		if (!node.get("visitedAt").stringValue().matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z")) throw invalid();
	}
	private static InvalidRequestException invalid() { return new InvalidRequestException("v2 방문 필드의 형식이 유효하지 않습니다."); }
}
