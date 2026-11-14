package com.focusrecovery.domain.privacy;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.net.*;
import java.time.Duration;
import java.util.UUID;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;
import com.focusrecovery.domain.analysis.client.AiProperties;
import com.focusrecovery.domain.privacy.entity.RetractionTargetId;
import com.focusrecovery.domain.privacy.service.*;
import com.focusrecovery.domain.privacy.service.RetractionWorkService.AiOutcome;
import tools.jackson.databind.json.JsonMapper;

class RetractionDispatcherTest {
    final RetractionWorkService work = mock(RetractionWorkService.class);
    final RetractionTargetId id = new RetractionTargetId(UUID.randomUUID(), "AI_CACHE_AND_MEMORY", UUID.randomUUID().toString());
    final RetractionWorkService.Claim claim = new RetractionWorkService.Claim(id, UUID.fromString(id.targetId()), UUID.randomUUID(), UUID.randomUUID());
    final MockEnvironment environment = new MockEnvironment().withProperty("focus-recovery.v2.retraction.service-secret", "isolated-retraction-secret-0123456789abcdef");
    void run(String base, AiOutcome expected) {
        when(work.claim(id)).thenReturn(claim);
        var ai = new AiProperties(URI.create(base), Duration.ofSeconds(1), Duration.ofSeconds(1), 0.01);
        new RetractionDispatcher(null, null, work, ai, environment, JsonMapper.builder().build()).run(id);
        verify(work).finishAi(claim, expected);
    }
    @Test void missingAuthenticationIsDiagnosedWithoutSending() {
        environment.setProperty("focus-recovery.v2.retraction.service-secret", "");
        run("http://127.0.0.1:1", AiOutcome.AI_RETRACTION_AUTH_NOT_CONFIGURED);
    }
    @Test void missingReceiverIsRetryableAndDiagnosed() throws Exception {
        try (var socket = new java.net.ServerSocket(0)) {
            int port = socket.getLocalPort(); socket.close();
            run("http://127.0.0.1:" + port, AiOutcome.AI_RETRACTION_UNREACHABLE);
        }
    }
    @ParameterizedTest @ValueSource(strings={"http://example.org", "ftp://127.0.0.1", "https://user:secret@example.org"})
    void unsafeDestinationsCannotReceiveIdsOrSecrets(String url) { run(url, AiOutcome.AI_RETRACTION_DESTINATION_BLOCKED); }
    @Test void interruptedDeliveryRetainsInterruptAndCannotConfirm() throws Exception {
        try {
            Thread.currentThread().interrupt();
            run("http://127.0.0.1:1", AiOutcome.AI_RETRACTION_INTERRUPTED);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally { Thread.interrupted(); }
    }
    @ParameterizedTest @ValueSource(strings={"success", "401", "403", "503", "redirect", "malformed", "wrong-id", "false-durable", "extra"})
    void strictAckAndFixedFailureCodes(String scenario) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/v2/visit-retractions", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("POST");
            assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isEqualTo("Bearer isolated-retraction-secret-0123456789abcdef");
            var mapper = JsonMapper.builder().build();
            var input = mapper.readTree(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            assertThat(input.size()).isEqualTo(3);
            assertThat(input.path("retractionId").asString()).isEqualTo(id.retractionId().toString());
            var body = mapper.createObjectNode().put("retractionId", id.retractionId().toString()).put("visitId", claim.visitId().toString()).put("status", "QUARANTINED").put("durable", true);
            if (scenario.equals("wrong-id")) body.put("visitId", UUID.randomUUID().toString());
            if (scenario.equals("false-durable")) body.put("durable", false);
            if (scenario.equals("extra")) body.put("PRIVATE_SOURCE", "must-not-persist");
            int status = scenario.matches("[0-9]+") ? Integer.parseInt(scenario) : scenario.equals("redirect") ? 307 : 200;
            byte[] bytes = (scenario.equals("malformed") ? "PRIVATE_SOURCE" : body.toString()).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        try {
            // The receiver override must work even when the inference origin is unavailable.
            environment.setProperty("focus-recovery.v2.retraction.base-url", "http://127.0.0.1:" + server.getAddress().getPort());
            var expected = switch (scenario) {
                case "success" -> AiOutcome.CONFIRMED;
                case "401", "403" -> AiOutcome.AI_RETRACTION_AUTH_REJECTED;
                case "503", "redirect" -> AiOutcome.AI_RETRACTION_HTTP_REJECTED;
                default -> AiOutcome.AI_RETRACTION_INVALID_ACK;
            };
            run("http://127.0.0.1:1", expected);
        } finally { server.stop(0); }
    }
}
