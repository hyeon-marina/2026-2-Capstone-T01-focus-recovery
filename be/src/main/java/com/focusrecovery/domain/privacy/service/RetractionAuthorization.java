package com.focusrecovery.domain.privacy.service;

import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/** No production identity/owner mapping exists. Only test-source code may replace this boundary. */
@Component
public class RetractionAuthorization {
    public int authorize(HttpServletRequest request, UUID sessionId) { return 401; }
}
