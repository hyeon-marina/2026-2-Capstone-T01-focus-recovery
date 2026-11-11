package com.focusrecovery.domain.identity;

import java.time.Instant;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthenticationController {
    private final AuthenticationService service;
    public AuthenticationController(AuthenticationService service) { this.service = service; }
    @org.springframework.beans.factory.annotation.Autowired private org.springframework.core.env.Environment env;
    public record Identity(UUID participantId, Instant expiresAt, boolean localMode) {}
    @GetMapping("/me") public Identity me() {
        var p = AuthenticatedParticipant.required(); return new Identity(p.participantId(), p.expiresAt(), java.util.Arrays.equals(env.getActiveProfiles(),new String[]{"individual-local"}));
    }
    @PostMapping("/logout") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void logout() { service.logout(); }
}
