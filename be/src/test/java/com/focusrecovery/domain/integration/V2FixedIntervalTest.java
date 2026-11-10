package com.focusrecovery.domain.integration;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import com.focusrecovery.domain.alert.service.AlertService;
import com.focusrecovery.domain.analysis.dto.V2AnalysisStatusResponse;
import com.focusrecovery.domain.analysis.service.AnalysisQueryService;
import com.focusrecovery.domain.session.service.WorkSessionService;

@SpringBootTest(properties={"focus-recovery.v2.storage.enabled=true", "focus-recovery.alert.mode=FIXED_INTERVAL",
	"spring.datasource.url=jdbc:h2:mem:fixed89;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc @ActiveProfiles("test") @Import(V2IntegrationContract.TimeConfiguration.class)
class V2FixedIntervalTest {
	@Autowired WorkSessionService sessions;
	@Autowired AlertService alerts;
	@Autowired AnalysisQueryService queries;
	@Autowired V2IntegrationContract.AdjustableClock clock;
	@Autowired MockMvc mvc;
	@Test void v2FixedScheduleKeepsLegacyModeWithExplicitNullStateReferences() throws Exception {
		var session = sessions.create("합성 고정 주기 목표", null, "2.0"); clock.freeze(); clock.advance(Duration.ofMinutes(11));
		try {
			var candidate = alerts.requestFixedInterval(session.sessionId());
			var status = (V2AnalysisStatusResponse) queries.status(session.sessionId());
			assertThat(status.alert().alertId()).isEqualTo(candidate.alert().alertId());
			assertThat(status.alert().windowId()).isNull(); assertThat(status.alert().stateVersion()).isNull();
			mvc.perform(get("/api/sessions/" + session.sessionId() + "/analysis-status")).andExpect(status().isOk())
				.andExpect(jsonPath("$.alert.windowId").value(org.hamcrest.Matchers.nullValue())).andExpect(jsonPath("$.alert.stateVersion").value(org.hamcrest.Matchers.nullValue()));
			sessions.end(session.sessionId(), List.of()); assertThat(((V2AnalysisStatusResponse) queries.status(session.sessionId())).alert()).isNull();
		} finally { clock.resume(); }
	}
}
