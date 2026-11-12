package com.focusrecovery.domain.identity;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.context.*;

@EnabledIfEnvironmentVariable(named="FOCUS95_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus95.*")
class AuthConsentMySqlTest extends AuthConsentTest {
    @DynamicPropertySource static void mysql(DynamicPropertyRegistry p) {
        p.add("spring.datasource.url",()->System.getenv("FOCUS95_MYSQL_URL"));
        p.add("spring.datasource.username",()->"root");p.add("spring.datasource.password",()->"synthetic-test-only");
    }
}
