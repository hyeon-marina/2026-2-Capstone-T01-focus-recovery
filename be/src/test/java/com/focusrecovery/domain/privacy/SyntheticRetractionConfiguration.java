package com.focusrecovery.domain.privacy;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import com.focusrecovery.domain.privacy.service.*;

/** Compiled only into test classes; never packaged in bootJar. Not a production identity scheme. */
@TestConfiguration
public class SyntheticRetractionConfiguration {
    @Bean @Primary RetractionExecutionPolicy syntheticExecution(JdbcTemplate jdbc) {
        return new RetractionExecutionPolicy() {
            @Override public boolean permitsSyntheticExecution(UUID sessionId) {
                return jdbc.queryForObject("SELECT COUNT(*) FROM synthetic_retraction_owner WHERE session_id=?", Integer.class, sessionId.toString()) == 1;
            }
        };
    }
}
