package com.focusrecovery.domain.privacy.controller;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.focusrecovery.domain.privacy.dto.Retraction;
import com.focusrecovery.domain.privacy.service.*;
import com.focusrecovery.global.exception.*;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@RestController
@RequestMapping("/api/sessions/{sessionId}/visit-retractions")
public class PrivacyRetractionController {
    private final RetractionAuthorization authorization;
    private final PrivacyRetractionService service;
    private final JsonMapper mapper;
    public PrivacyRetractionController(RetractionAuthorization authorization, PrivacyRetractionService service, JsonMapper mapper) {
        this.authorization = authorization; this.service = service;
        this.mapper = mapper.rebuild().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    }
    @PostMapping("/quarantine")
    public PrivacyRetractionService.Closure quarantine(@PathVariable UUID sessionId) {
        return service.quarantineForOwner(sessionId, false);
    }

    @PostMapping("/close")
    public PrivacyRetractionService.Closure close(@PathVariable UUID sessionId) {
        return service.quarantineForOwner(sessionId, true);
    }

    @PostMapping
    public ResponseEntity<?> retract(@PathVariable String sessionId, @RequestBody String raw, HttpServletRequest http) {
        UUID session;
        try { session = id(sessionId); } catch (RuntimeException e) { return failure(400, "INVALID_REQUEST"); }
        int denied = authorization.authorize(http, session);
        if (denied != 0) return failure(denied, "INVALID_REQUEST");
        Retraction.Request request;
        try {
            JsonNode body = mapper.readTree(raw);
            Set<String> fields = new HashSet<>(); body.properties().forEach(e -> fields.add(e.getKey()));
            if (!body.isObject() || !fields.equals(Set.of("retractionId", "visitId", "observedAt", "reasonCode"))) throw new IllegalArgumentException();
            for (var e : body.properties()) if (!e.getValue().isString()) throw new IllegalArgumentException();
            String time = body.get("observedAt").stringValue(), reason = body.get("reasonCode").stringValue();
            if (!time.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z")
                || !Set.of("SENSITIVE_CONTENT", "CONSENT_WITHDRAWN").contains(reason)) throw new IllegalArgumentException();
            DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withResolverStyle(ResolverStyle.STRICT).parse(time);
            request = new Retraction.Request(id(body.get("retractionId").stringValue()), id(body.get("visitId").stringValue()), reason, Instant.parse(time));
        } catch (RuntimeException e) { return failure(400, "INVALID_REQUEST"); }
        try {
            PrivacyRetractionService.Accepted result;
            try { result = service.accept(session, request); }
            catch (org.springframework.dao.DataIntegrityViolationException e) { result = service.accept(session, request); }
            return ResponseEntity.status(result.created() ? 202 : 200).body(result.receipt());
        } catch (ConflictException e) { return failure(409, e.getCode().equals("RETRACTION_ID_CONFLICT") ? e.getCode() : "PRIVACY_RETRACTED");
        } catch (com.focusrecovery.domain.visit.exception.VisitNotFoundException e) { return failure(404, "VISIT_NOT_FOUND");
        } catch (com.focusrecovery.domain.session.exception.SessionNotFoundException e) { return failure(404, "SESSION_NOT_FOUND"); }
    }
    private static UUID id(String value) {
        if (value == null || !value.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) throw new IllegalArgumentException();
        return UUID.fromString(value);
    }
    private static ResponseEntity<?> failure(int status, String code) {
        return ResponseEntity.status(status).body(Map.of("apiContractVersion", 2, "code", code,
            "message", "요청을 처리할 수 없습니다.", "fieldErrors", List.of()));
    }
}
