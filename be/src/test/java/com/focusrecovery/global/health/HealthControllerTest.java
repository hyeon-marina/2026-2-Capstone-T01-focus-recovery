package com.focusrecovery.global.health;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.web.servlet.MockMvc;

// 웹 계층만 띄운다(DataSource·JPA·AI 클라이언트 없음): DB·AI 연결 없이도 응답해야 한다
@WebMvcTest(HealthController.class)
class HealthControllerTest {

	@Autowired
	private MockMvc mockMvc;
    @org.springframework.test.context.bean.override.mockito.MockitoBean
    private com.focusrecovery.domain.identity.AuthenticationService authentication;

	@Test
	void 상태_확인은_200과_JSON_status_UP만_반환한다() throws Exception {
		mockMvc.perform(get("/api/health"))
			.andExpect(status().isOk())
			.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
			.andExpect(content().json("{\"status\":\"UP\"}", JsonCompareMode.STRICT));
	}
}
