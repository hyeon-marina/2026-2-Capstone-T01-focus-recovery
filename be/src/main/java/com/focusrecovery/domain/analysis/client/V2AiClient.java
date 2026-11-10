package com.focusrecovery.domain.analysis.client;

import java.net.http.*;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.stereotype.Component;
import com.focusrecovery.domain.analysis.dto.V2AnalysisInput;
import com.focusrecovery.domain.analysis.dto.V2AnalysisCompletion;
import com.focusrecovery.domain.analysis.service.V2DispatchProperties;
import com.focusrecovery.domain.composition.dto.Composition;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

// v1 DTO/확률 검증과 독립인 wire 경계. 원문·모델 오류 본문을 예외나 로그에 넣지 않는다.
@Component
public class V2AiClient {
	private final AiProperties ai;
    private final String serviceToken;
	private final V2DispatchProperties dispatch;
	private final JsonMapper mapper;
	private final JsonMapper strict;
	private final HttpClient http;
	private static final Set<String> ERRORS = Set.of("INVALID_REQUEST", "COMPOSE_ID_CONFLICT", "COMPOSE_IN_PROGRESS",
		"ANALYSIS_ID_CONFLICT", "ANALYSIS_IN_PROGRESS", "AI_COMPOSITION_FAILED", "AI_ANALYSIS_FAILED", "AI_NOT_READY", "PRIVACY_RETRACTED");
	private static final Set<String> TRANSIENT = Set.of("AI_TIMEOUT", "AI_UNAVAILABLE", "AI_NOT_READY", "COMPOSE_IN_PROGRESS", "AI_COMPOSITION_FAILED");
	public V2AiClient(AiProperties ai, V2DispatchProperties dispatch, JsonMapper mapper, @org.springframework.beans.factory.annotation.Value("${focus-recovery.v2.dispatch.service-token:}") String serviceToken) {
        this.serviceToken = serviceToken;
		this.ai = ai; this.dispatch = dispatch; this.mapper = mapper;
		this.strict = mapper.rebuild().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
		this.http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(ai.connectTimeout()).build();
	}
	public Composition.Output compose(Composition.Input input) {
		require(input != null && input.apiContractVersion() == 2 && input.visits() != null && !input.visits().isEmpty());
		JsonNode body = post("/api/ai/window-compositions", mapper.writeValueAsString(input));
		try {
			fields(body, "apiContractVersion", "composeRequestId", "sessionId", "afterSequence", "inputFingerprint", "composedThroughSequence", "windows");
			version(body); id(body.get("composeRequestId"), input.composeRequestId()); id(body.get("sessionId"), input.sessionId());
			integer(body.get("afterSequence"), input.afterSequence()); hash(body.get("inputFingerprint"), input.inputFingerprint());
			integer(body.get("composedThroughSequence"), input.visits().getLast().sequence());
			JsonNode windows = body.get("windows");
			require(windows.isArray() && windows.size() == Math.max(0, input.visits().size() - 2));
			for (int i = 0; i < windows.size(); i++) {
				JsonNode window = windows.get(i); fields(window, "visitIds", "endVisitId");
				JsonNode ids = window.get("visitIds"); require(ids.isArray() && ids.size() == 3);
				for (int j = 0; j < 3; j++) id(ids.get(j), input.visits().get(i + j).visitId());
				id(window.get("endVisitId"), input.visits().get(i + 2).visitId());
			}
			return mapper.treeToValue(body, Composition.Output.class);
		} catch (RuntimeException e) { throw invalid(); }
	}
	public V2AnalysisCompletion analyze(V2AnalysisInput input) {
		require(input != null && input.apiContractVersion() == 2 && input.visits() != null && input.visits().size() == 3);
		JsonNode body = post("/api/ai/analyses", mapper.writeValueAsString(input));
		try {
			fields(body, "apiContractVersion", "analysisId", "sessionId", "windowId", "inputFingerprint", "pageResults", "modelVersions", "analyzedAt");
			version(body); id(body.get("analysisId"), input.analysisId()); id(body.get("sessionId"), input.sessionId());
			id(body.get("windowId"), input.windowId()); hash(body.get("inputFingerprint"), input.inputFingerprint());
			JsonNode pages = body.get("pageResults"); require(pages.isArray() && pages.size() == 3);
			for (int i = 0; i < 3; i++) {
				JsonNode page = pages.get(i); fields(page, "position", "visitId", "label", "semanticRelevance", "rationale");
				integer(page.get("position"), i + 1); id(page.get("visitId"), input.visits().get(i).visitId());
				text(page.get("label"), 1, 30); require(Set.of("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED").contains(page.get("label").stringValue()));
				JsonNode score = page.get("semanticRelevance");
				require(score.isNumber() && Double.isFinite(score.doubleValue()) && score.doubleValue() >= -1 && score.doubleValue() <= 1);
				text(page.get("rationale"), 1, 500); require(!page.get("rationale").stringValue().isBlank());
			}
			JsonNode versions = body.get("modelVersions"); fields(versions, "embedding", "context", "prompt", "labelGuide");
			for (var entry : versions.properties()) { text(entry.getValue(), 1, 200); require(!entry.getValue().stringValue().isBlank()); }
			text(body.get("analyzedAt"), 24, 24);
			String time = body.get("analyzedAt").stringValue();
			require(time.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z"));
			DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withResolverStyle(ResolverStyle.STRICT).parse(time);
			Instant.parse(time);
			return mapper.treeToValue(body, V2AnalysisCompletion.class);
		} catch (RuntimeException e) { throw invalid(); }
	}
	private JsonNode post(String path, String payload) {
		var target = ai.baseUrl().resolve(path);
        if (serviceToken.length() < 32 || !("https".equals(target.getScheme()) || "http".equals(target.getScheme()) && Set.of("localhost","127.0.0.1").contains(target.getHost())))
            throw new V2AiException("AI_NOT_READY", true);
        HttpRequest request = HttpRequest.newBuilder(ai.baseUrl().resolve(path)).timeout(dispatch.responseTimeout())
			.header("Content-Type", "application/json").header("Authorization", "Bearer " + serviceToken).POST(HttpRequest.BodyPublishers.ofString(payload)).build();
		CompletableFuture<HttpResponse<String>> pending = http.sendAsync(request, HttpResponse.BodyHandlers.ofString());
		try {
			// 본문 수신까지 포함하는 hard BE deadline. AI soft timeout에 의존하지 않는다.
			HttpResponse<String> response = pending.get(dispatch.responseTimeout().toMillis(), TimeUnit.MILLISECONDS);
			JsonNode body;
			try { body = strict.readTree(response.body()); } catch (RuntimeException e) { throw invalid(); }
			if (response.statusCode() != 200) {
				String code = body.path("code").asString("");
				if (!ERRORS.contains(code)) code = response.statusCode() >= 500 ? "AI_UNAVAILABLE" : "AI_INVALID_RESPONSE";
				throw new V2AiException(code, TRANSIENT.contains(code));
			}
			return body;
		} catch (TimeoutException e) { pending.cancel(true); throw new V2AiException("AI_TIMEOUT", true);
		} catch (InterruptedException e) { pending.cancel(true); Thread.currentThread().interrupt(); throw new V2AiException("AI_UNAVAILABLE", true);
		} catch (ExecutionException e) { throw new V2AiException(e.getCause() instanceof HttpTimeoutException ? "AI_TIMEOUT" : "AI_UNAVAILABLE", true); }
	}
	private static void fields(JsonNode node, String... names) {
		require(node != null && node.isObject());
		Set<String> actual = new HashSet<>(); node.properties().forEach(e -> actual.add(e.getKey()));
		require(actual.equals(Set.of(names)));
	}
	private static void version(JsonNode body) { integer(body.get("apiContractVersion"), 2); }
	private static void integer(JsonNode node, int expected) { require(node != null && node.isNumber() && node.decimalValue().compareTo(java.math.BigDecimal.valueOf(expected)) == 0); }
	private static void id(JsonNode node, UUID expected) {
		require(node != null && node.isString() && node.stringValue().matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}") && node.stringValue().equals(expected.toString()));
	}
	private static void hash(JsonNode node, String expected) { require(node != null && node.isString() && node.stringValue().matches("[0-9a-f]{64}") && node.stringValue().equals(expected)); }
	private static void text(JsonNode node, int min, int max) {
		require(node != null && node.isString()); int size = node.stringValue().codePointCount(0, node.stringValue().length()); require(size >= min && size <= max);
	}
	private static void require(boolean valid) { if (!valid) throw invalid(); }
	private static V2AiException invalid() { return new V2AiException("AI_INVALID_RESPONSE", false); }
}
