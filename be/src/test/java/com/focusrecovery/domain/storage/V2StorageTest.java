package com.focusrecovery.domain.storage;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
@com.focusrecovery.support.SyntheticAuthenticated
@SpringBootTest(properties={"focus-recovery.v2.storage.enabled=true","focus-recovery.v2.storage.recovery-interval=1h",
	"spring.datasource.url=jdbc:h2:mem:v2_storage;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class V2StorageTest extends V2StorageContract {}
