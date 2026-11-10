package com.focusrecovery.domain.storage;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
@SpringBootTest(properties="spring.datasource.url=jdbc:h2:mem:v2_disabled;MODE=MySQL;DATABASE_TO_LOWER=TRUE")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class V2DisabledTest {
	@Autowired MockMvc mvc;
	@Test void rejectsV2ByDefaultAndPreservesV1() throws Exception {
		mvc.perform(post("/api/sessions").contentType(MediaType.APPLICATION_JSON)
			.content("{\"goalText\":\"합성 기존 목표입니다\",\"collectionSpecVersion\":\"2.0\"}"))
			.andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("V2_STORAGE_DISABLED"));
		mvc.perform(post("/api/sessions").contentType(MediaType.APPLICATION_JSON).header("Idempotency-Key","synthetic-disabled")
			.content("{\"goalText\":\"합성 기존 목표입니다\"}"))
			.andExpect(status().isCreated()).andExpect(jsonPath("$.collectionSpecVersion").value("1.0"));
		mvc.perform(post("/api/sessions").contentType(MediaType.APPLICATION_JSON).header("Idempotency-Key","synthetic-disabled")
			.content("{\"goalText\":\"합성 기존 목표입니다\",\"collectionSpecVersion\":\"2.0\"}"))
			.andExpect(status().isUnprocessableContent()).andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_MISMATCH"));
	}
}
