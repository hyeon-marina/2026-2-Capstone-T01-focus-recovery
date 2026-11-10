package com.focusrecovery.global.config;

import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OpenApiDocsTest {

	@Autowired
	private MockMvc mockMvc;

	@Test
	void OpenAPI_문서에_세션_API가_포함된다() throws Exception {
		mockMvc.perform(get("/v3/api-docs"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.info.title").value("Focus Recovery API"))
			.andExpect(jsonPath("$.paths['/api/sessions'].post.parameters[0].name").value("Idempotency-Key"))
			.andExpect(jsonPath("$.paths['/api/sessions'].post.responses['422']").exists())
			.andExpect(jsonPath("$.paths['/api/sessions'].post.responses['404']").doesNotExist())
			.andExpect(jsonPath("$.paths['/api/sessions/{sessionId}'].get.responses['404']").exists())
			.andExpect(jsonPath("$.paths['/api/sessions/{sessionId}'].get.responses['422']").doesNotExist());
	}

	// 분석 상태 조회는 최신 완료 결과를 알림 근거로 오해하지 않도록 사용 규칙을 문서에 담는다
	@Test
	void OpenAPI_문서에_분석_상태_조회의_알림_사용_규칙이_포함된다() throws Exception {
		mockMvc.perform(get("/v3/api-docs"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.paths['/api/sessions/{sessionId}/analysis-status'].get.description",
				allOf(containsString("참고 결과"), containsString("구간 3의 결과로 새 알림을 표시하면 안 됩니다"),
					containsString("windowIndex가 같다는 것만으로 알림을 허용하면 안 됩니다"),
					containsString("ACTIVE인지와 alertId 중복"), containsString("아직 표시되지 않은 후보만"),
					containsString("이전 구간의 후보는 반환하지 않습니다"))))
			.andExpect(jsonPath("$.components.schemas.AnalysisStatusResponse.properties.latestCompletedAnalysis.description",
				containsString("알림 표시 허용을 의미하지 않는다")))
			.andExpect(jsonPath("$.components.schemas.AnalysisStatusResponse.properties.alert.description",
				containsString("미표시 후보만")));
	}

	// 분석 상세의 JSON 필드는 문자열이 아니라 객체 또는 null로 문서화되고, JsonNode 내부 구조가 노출되지 않아야 한다
	@Test
	void OpenAPI_문서의_분석_상세_JSON_필드는_객체_또는_null_타입이다() throws Exception {
		String base = "$.components.schemas.AnalysisDetailResponse.properties.";
		var result = mockMvc.perform(get("/v3/api-docs")).andExpect(status().isOk());
		for (String field : new String[] {"contextResult", "inputSnapshot", "featureSnapshot", "modelVersions"}) {
			result.andExpect(jsonPath(base + field + ".type", containsInAnyOrder("object", "null")))
				.andExpect(jsonPath(base + field + ".$ref").doesNotExist())
				.andExpect(jsonPath(base + field + ".properties").doesNotExist());
		}
		result.andExpect(jsonPath("$.components.schemas.JsonNode").doesNotExist());
	}

	// FE가 시각 입력 형식(밀리초까지, 초과 정밀도는 400)과 잠정 허용치를 알 수 있어야 한다
	@Test
	void OpenAPI_문서에_알림_시각_입력_형식과_잠정_허용치가_포함된다() throws Exception {
		var result = mockMvc.perform(get("/v3/api-docs")).andExpect(status().isOk());
		for (String path : new String[] {"$.paths['/api/sessions/{sessionId}/alerts/{alertId}/shown'].patch.description",
			"$.paths['/api/sessions/{sessionId}/alerts/{alertId}/responses'].post.description"}) {
			result.andExpect(jsonPath(path, allOf(containsString("밀리초(소수점 3자리)까지만 허용"),
				containsString("최종 합의 전 잠정 설정 5초"), containsString("이번 작업에서 확정한 구현 정책"))));
		}
		result.andExpect(jsonPath("$.components.schemas.ShownRequest.properties.shownAt.description",
			containsString("더 세밀하면 400")));
	}

	@Test
	void OpenAPI_문서에_알림_이력_offset_페이지네이션_한계가_포함된다() throws Exception {
		mockMvc.perform(get("/v3/api-docs"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.paths['/api/sessions/{sessionId}/alerts'].get.description",
				allOf(containsString("offset 페이지네이션의 한계"), containsString("스냅샷 일관성은 보장하지 않습니다"),
					containsString("alertId로 중복을 걸러도"), containsString("커서 방식은 후속 개선"))));
	}

	@Test
	void OpenAPI_문서에_상태_확인_API와_확인_범위가_포함된다() throws Exception {
		mockMvc.perform(get("/v3/api-docs"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.paths['/api/health'].get.description",
				allOf(containsString("HTTP 서버의 응답 가능 여부뿐"), containsString("DB나 AI가 정상이라는 뜻은 아닙니다"))))
			.andExpect(jsonPath("$.components.schemas.HealthResponse.properties.length()").value(1));
	}
}
