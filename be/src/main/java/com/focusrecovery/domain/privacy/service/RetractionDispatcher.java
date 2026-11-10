package com.focusrecovery.domain.privacy.service;

import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import com.focusrecovery.domain.analysis.client.AiProperties;
import com.focusrecovery.domain.privacy.entity.RetractionTargetId;
import com.focusrecovery.domain.privacy.repository.RetractionTargetRepository;
import com.focusrecovery.global.config.V2StorageGate;
import tools.jackson.databind.json.JsonMapper;

@Service
public class RetractionDispatcher {
    private final V2StorageGate gate;
    private final RetractionTargetRepository targets;
    private final RetractionWorkService work;
    private final AiProperties ai;
    private final Environment environment;
    private final JsonMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
    public RetractionDispatcher(V2StorageGate gate, RetractionTargetRepository targets, RetractionWorkService work,
        AiProperties ai, Environment environment, JsonMapper mapper) {
        this.gate = gate; this.targets = targets; this.work = work; this.ai = ai; this.environment = environment; this.mapper = mapper;
    }
    @Scheduled(fixedDelayString="${focus-recovery.v2.retraction.interval:1m}", initialDelayString="${focus-recovery.v2.retraction.interval:1m}")
    public void dispatch() {
        if (!gate.enabled()) return;
        for (var target : targets.findWork(PageRequest.of(0, 100))) {
            try { run(target.getId()); }
            catch (RuntimeException e) { org.slf4j.LoggerFactory.getLogger(RetractionDispatcher.class).warn("회수 작업 미적용 type={}", e.getClass().getSimpleName()); }
        }
    }
    // Proxied claim/commit transactions are complete before external HTTP begins.
    public void run(RetractionTargetId id) {
        var claim = work.claim(id); if (claim == null) return;
        if (id.targetType().equals("BE_PAYLOADS")) {
            try { work.scrub(claim); } catch (RuntimeException e) { work.failPayload(claim); }
        } else if (id.targetType().equals("AI_CACHE_AND_MEMORY")) {
            boolean confirmed = false;
            try {
                String secret = environment.getProperty("focus-recovery.v2.retraction.service-secret", "");
                URI uri = ai.baseUrl().resolve("/internal/v2/visit-retractions");
                // Synthetic trust boundary: no redirects, no non-loopback cleartext service calls.
                if (secret.length() < 32 || !"http".equals(uri.getScheme()) || !Set.of("127.0.0.1", "localhost").contains(uri.getHost())) throw new IllegalStateException();
                var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5))
                    .header("Content-Type", "application/json").header("Authorization", "Bearer " + secret)
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(Map.of("retractionId", id.retractionId(), "sessionId", claim.sessionId(), "visitId", claim.visitId())))).build();
                var response = http.send(request, HttpResponse.BodyHandlers.ofString());
                var body = mapper.readTree(response.body());
                confirmed = response.statusCode() == 200 && body.isObject() && body.size() == 4
                    && body.path("retractionId").asString("").equals(id.retractionId().toString())
                    && body.path("visitId").asString("").equals(claim.visitId().toString())
                    && body.path("status").asString("").equals("QUARANTINED")
                    && body.path("durable").isBoolean() && body.path("durable").booleanValue();
            } catch (InterruptedException e) { Thread.currentThread().interrupt();
            } catch (Exception e) { /* Persist only a fixed code, never remote exception bodies. */ }
            work.finishAi(claim, confirmed);
        }
    }
}
