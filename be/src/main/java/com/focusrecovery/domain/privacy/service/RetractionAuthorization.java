package com.focusrecovery.domain.privacy.service;

import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;
import com.focusrecovery.domain.identity.*;

@Component
public class RetractionAuthorization {
    private final AuthenticationService authentication;
    public RetractionAuthorization(AuthenticationService authentication) { this.authentication = authentication; }
    public int authorize(HttpServletRequest request, UUID sessionId) {
        try { authentication.requireOwner(sessionId); return 0; }
        catch (com.focusrecovery.domain.session.exception.SessionNotFoundException e) { return 404; }
        catch (AccessDenied e) { return e.status(); }
    }
}
