package com.focusrecovery.domain.integration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
@SpringBootTest(properties={"focus-recovery.v2.storage.enabled=true", "focus-recovery.v2.storage.recovery-interval=1h", "focus-recovery.v2.retraction.interval=1h",
    "spring.datasource.url=jdbc:h2:mem:privacy93;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"})
@org.springframework.context.annotation.Import({V2IntegrationContract.TimeConfiguration.class, com.focusrecovery.domain.privacy.SyntheticRetractionConfiguration.class})
@AutoConfigureMockMvc @ActiveProfiles("test")
class V2RetractionTest extends V2RetractionContract {}
