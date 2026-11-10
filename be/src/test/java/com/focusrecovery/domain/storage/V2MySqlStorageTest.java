package com.focusrecovery.domain.storage;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest(properties={"focus-recovery.v2.storage.enabled=true","focus-recovery.v2.storage.recovery-interval=1h"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named="FOCUS85_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus85.*")
class V2MySqlStorageTest extends V2StorageContract {
	@DynamicPropertySource static void mysql(DynamicPropertyRegistry registry) {
		registry.add("spring.datasource.url", () -> System.getenv("FOCUS85_MYSQL_URL"));
		registry.add("spring.datasource.username", () -> "root");
		registry.add("spring.datasource.password", () -> "synthetic-test-only");
	}
}
