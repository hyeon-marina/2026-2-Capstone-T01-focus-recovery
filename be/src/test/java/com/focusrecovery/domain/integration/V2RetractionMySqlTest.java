package com.focusrecovery.domain.integration;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.*;
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest(properties={"focus-recovery.v2.storage.enabled=true", "focus-recovery.v2.storage.recovery-interval=1h", "focus-recovery.v2.retraction.interval=1h"})
@org.springframework.context.annotation.Import({V2IntegrationContract.TimeConfiguration.class, com.focusrecovery.domain.privacy.SyntheticRetractionConfiguration.class})
@AutoConfigureMockMvc @ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named="FOCUS93_MYSQL_URL", matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus93.*")
class V2RetractionMySqlTest extends V2RetractionContract {
    @DynamicPropertySource static void mysql(DynamicPropertyRegistry p) {
        p.add("spring.datasource.url", () -> System.getenv("FOCUS93_MYSQL_URL"));
        p.add("spring.datasource.username", () -> "root"); p.add("spring.datasource.password", () -> System.getenv().getOrDefault("FOCUS93_MYSQL_PASSWORD","synthetic-test-only"));
    }
}
