package com.focusrecovery.domain.collection;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.context.*;

@EnabledIfEnvironmentVariable(named="FOCUS97_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus97.*")
class CollectionConsentProgressMySqlTest extends CollectionConsentProgressTest {
    @DynamicPropertySource static void mysql(DynamicPropertyRegistry p) {
        p.add("spring.datasource.url",()->System.getenv("FOCUS97_MYSQL_URL"));
        p.add("spring.datasource.username",()->"root");
        p.add("spring.datasource.password",()->System.getenv("FOCUS97_MYSQL_PASSWORD"));
    }
}
