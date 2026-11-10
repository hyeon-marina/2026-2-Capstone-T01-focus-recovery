package com.focusrecovery.domain.identity;

import java.time.Instant;
import java.util.UUID;

public record AuthenticatedParticipant(UUID participantId, String tokenHash, Instant expiresAt) {
    private static final ThreadLocal<AuthenticatedParticipant> CURRENT = new ThreadLocal<>();
    public static AuthenticatedParticipant current() { return CURRENT.get(); }
    public static AuthenticatedParticipant required() {
        var current = CURRENT.get();
        if (current == null) throw new AccessDenied(401);
        return current;
    }
    public static void bind(AuthenticatedParticipant principal) { CURRENT.set(principal); }
    public static void clear() { CURRENT.remove(); }
    @Override public String toString() { return "AuthenticatedParticipant[redacted]"; }
}
