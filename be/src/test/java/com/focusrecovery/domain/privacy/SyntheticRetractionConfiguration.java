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
    @Bean @Primary RetractionAuthorization syntheticOwnership(JdbcTemplate jdbc) {
        return new RetractionAuthorization() {
            @Override public int authorize(HttpServletRequest request, UUID sessionId) {
                String header = request.getHeader("Authorization"), subject = null;
                for (String user : List.of("alice", "bob")) {
                    String expected = "Basic " + Base64.getEncoder().encodeToString((user + ":synthetic-test-only").getBytes(StandardCharsets.UTF_8));
                    if (header != null && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), header.getBytes(StandardCharsets.UTF_8))) subject = user;
                }
                if (subject == null) return 401;
                return jdbc.queryForObject("SELECT COUNT(*) FROM synthetic_retraction_owner WHERE session_id=? AND subject=?", Integer.class, sessionId.toString(), subject) == 1 ? 0 : 403;
            }
        };
    }
    @Bean @Primary RetractionExecutionPolicy syntheticExecution(JdbcTemplate jdbc) {
        return new RetractionExecutionPolicy() {
            @Override public boolean permitsSyntheticExecution(UUID sessionId) {
                return jdbc.queryForObject("SELECT COUNT(*) FROM synthetic_retraction_owner WHERE session_id=?", Integer.class, sessionId.toString()) == 1;
            }
        };
    }
}
