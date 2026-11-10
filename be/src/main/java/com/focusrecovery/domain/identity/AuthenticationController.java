package com.focusrecovery.domain.identity;

import java.time.Instant;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthenticationController {
    private final AuthenticationService service;
    public AuthenticationController(AuthenticationService service) { this.service = service; }
    public record Identity(UUID participantId, Instant expiresAt) {}
    @GetMapping("/me") public Identity me() {
        var p = AuthenticatedParticipant.required(); return new Identity(p.participantId(), p.expiresAt());
    }
    @PostMapping("/logout") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void logout() { service.logout(); }
}
