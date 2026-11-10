package com.focusrecovery.domain.integration;

import static org.assertj.core.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.*;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.composition.repository.ComposeRequestRepository;
import com.focusrecovery.domain.window.repository.AnalysisWindowRepository;
import com.focusrecovery.domain.window.repository.WindowStateHistoryRepository;
import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;
import com.focusrecovery.global.util.CanonicalJson;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

// This starts a real BE HTTP server. The separately started AI uses real composition,
// request registry and PageAnalysisModel orchestration, with explicit fake embedding/LLM.
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
	"focus-recovery.v2.storage.enabled=true", "focus-recovery.v2.dispatch.enabled=true", "focus-recovery.v2.dispatch.interval=50ms",
	"focus-recovery.v2.storage.recovery-interval=1h", "spring.datasource.url=jdbc:h2:mem:live89;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"})
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named="FOCUS89_AI_URL", matches="http://127\\.0\\.0\\.1:[0-9]+")
class V2LiveHttpTest {
	@LocalServerPort int port;
	@Autowired JsonMapper mapper;
	@Autowired CanonicalJson canonical;
	@Autowired AnalysisWindowRepository windows;
	@Autowired AnalysisResultRepository analyses;
	@Autowired ComposeRequestRepository compositions;
	@Autowired WindowStateHistoryRepository states;
	HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
	@DynamicPropertySource static void ai(DynamicPropertyRegistry properties) { properties.add("focus-recovery.ai.base-url", () -> System.getenv("FOCUS89_AI_URL")); }
	JsonNode call(String method, String path, Object value) throws Exception {
		HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(10));
		if (value instanceof CreatePageVisitRequest) {
			ObjectNode visit = (ObjectNode) mapper.valueToTree(value); visit.put("visitedAt", "2026-11-10T00:00:00.000Z"); value = visit;
		}
		if (value == null) request.GET(); else request.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(value)));
		var response = http.send(request.build(), HttpResponse.BodyHandlers.ofString()); assertThat(response.statusCode()).as("%s %s: %s", method, path, response.body()).isBetween(200, 201); return mapper.readTree(response.body());
	}
	@Test void actualBeToFastApiCompositionAndMockModelAnalysisThenBehaviorAndEnd() throws Exception {
		var created = call("POST", "/api/sessions", Map.of("goalText", "합성 공개 문서 비교하기", "collectionSpecVersion", "2.0"));
		UUID session = UUID.fromString(created.get("sessionId").stringValue()); String base = "/api/sessions/" + session;
		List<UUID> visits = new ArrayList<>();
		for (int sequence : List.of(1, 3, 8)) {
			UUID id = UUID.randomUUID(); visits.add(id);
			call("POST", base + "/visits", new CreatePageVisitRequest(id.toString(), sequence, "synthetic-tab", "https://example.org/docs", "example.org",
				"합성 예제", "합성 테스트용 공개 문서의 내용입니다. ".repeat(4), null, false, Instant.parse("2026-11-10T00:00:00Z"), 5000L, 0, 1L, "SUCCESS"));
			if (sequence < 8) {
				await(() -> compositions.findBySessionId(session).stream().anyMatch(j -> j.getComposedThroughSequence() == sequence && j.getProcessingStatus().equals("COMPLETED")));
				assertThat(windows.findBySessionIdOrderByWindowIndex(session)).isEmpty();
			}
		}
		await(() -> !states.findSuccessful(session, org.springframework.data.domain.PageRequest.of(0, 1)).isEmpty());
		JsonNode initial = call("GET", base + "/analysis-status", null); assertThat(initial.at("/currentDecision/finalState").stringValue()).isEqualTo("NORMAL");
		UUID window = UUID.fromString(initial.at("/currentDecision/windowId").stringValue());
		call("PATCH", base + "/visits/" + visits.getLast() + "/behavior", Map.of("activeDurationMs", 300000, "tabSwitchCount", 0, "behaviorVersion", 2));
		await(() -> states.findFirstByIdWindowIdOrderByIdStateVersionDesc(window).map(s -> s.getId().stateVersion() == 2).orElse(false));
		JsonNode drift = call("GET", base + "/analysis-status", null); assertThat(drift.at("/currentDecision/finalState").stringValue()).isEqualTo("DRIFT");
		assertThat(drift.get("alert").isObject()).isTrue(); assertThat(drift.at("/alert/stateVersion").longValue()).isEqualTo(2);
		JsonNode history = call("GET", base + "/windows/" + window + "/states", null); assertThat(history.get("items").size()).isEqualTo(2);
		var analysis = analyses.findByWindowId(window).orElseThrow(); assertThat(analysis.getProcessingStatus()).isEqualTo(AnalysisStatus.COMPLETED);
		assertThat(windows.findBySessionIdOrderByWindowIndex(session)).hasSize(1); assertThat(states.findByIdWindowIdOrderByIdStateVersionDesc(window)).hasSize(2);
		JsonNode ended = call("POST", base + "/end", Map.of());
		assertThat(call("GET", base + "/analysis-status", null).get("alert").isNull()).isTrue();
		// Export synthetic wire evidence for the independent shared Schema validator.
		Path directory = Path.of("/private/tmp/focus89-http-evidence"); Files.createDirectories(directory);
		Files.writeString(directory.resolve("status.json"), mapper.writeValueAsString(drift)); Files.writeString(directory.resolve("states.json"), mapper.writeValueAsString(history));
		Files.writeString(directory.resolve("analysis-request.json"), analysis.getInputSnapshot()); Files.writeString(directory.resolve("analysis-response.json"), analysis.getResponseSnapshot());
		for (var job : compositions.findBySessionId(session)) {
			Files.writeString(directory.resolve("compose-" + job.getAfterSequence() + "-request.json"), job.getInputSnapshot());
			Files.writeString(directory.resolve("compose-" + job.getAfterSequence() + "-response.json"), job.getResponseSnapshot());
		}
		// AI's actual HTTP error path: tampered fingerprint must fail, without BE fallback.
		ObjectNode bad = (ObjectNode) mapper.readTree(analysis.getInputSnapshot()); bad.put("inputFingerprint", "a".repeat(64));
		var rejected = http.send(HttpRequest.newBuilder(URI.create(System.getenv("FOCUS89_AI_URL") + "/api/ai/analyses"))
			.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(bad))).build(), HttpResponse.BodyHandlers.ofString());
		assertThat(rejected.statusCode()).isEqualTo(422); assertThat(mapper.readTree(rejected.body()).get("code").stringValue()).isEqualTo("INVALID_REQUEST");
	}
	static void await(BooleanSupplier check) throws InterruptedException {
		long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
		while (!check.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(20);
		assertThat(check.getAsBoolean()).isTrue();
	}
}
