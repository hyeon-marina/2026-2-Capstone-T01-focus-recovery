package com.focusrecovery.domain.integration;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.*;

@SpringBootTest(properties={"focus-recovery.v2.storage.enabled=true", "focus-recovery.v2.storage.recovery-interval=1h"})
@org.springframework.context.annotation.Import(V2IntegrationContract.TimeConfiguration.class)
@AutoConfigureMockMvc
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named="FOCUS89_MYSQL_URL", matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus89.*")
class V2MySqlIntegrationTest extends V2IntegrationContract {
	@DynamicPropertySource static void mysql(DynamicPropertyRegistry properties) {
		properties.add("spring.datasource.url", () -> System.getenv("FOCUS89_MYSQL_URL"));
		properties.add("spring.datasource.username", () -> "root"); properties.add("spring.datasource.password", () -> "synthetic-test-only");
	}
}
