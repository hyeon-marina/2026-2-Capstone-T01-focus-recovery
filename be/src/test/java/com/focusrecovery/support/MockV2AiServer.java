package com.focusrecovery.support;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;
import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

public class MockV2AiServer implements AutoCloseable {
	public final JsonMapper mapper = JsonMapper.builder().findAndAddModules().build();
	private final HttpServer server;
	private final ExecutorService executor = Executors.newCachedThreadPool();
	public final AtomicInteger compositionCalls = new AtomicInteger(), analysisCalls = new AtomicInteger();
	public volatile BiFunction<String, ObjectNode, Reply> handler = this::normal;
	public volatile List<String> labels = List.of("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED");
	public volatile ObjectNode lastComposition, lastAnalysis;
	public record Reply(int status, String body) {}
	public MockV2AiServer() {
		try {
			server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
			server.setExecutor(executor);
			server.createContext("/api/ai/", exchange -> {
				if (!"Bearer synthetic-internal-service-token-95-0123456789".equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
                    exchange.sendResponseHeaders(401, -1); exchange.close(); return;
                }
                String path = exchange.getRequestURI().getPath();
				ObjectNode request = (ObjectNode) mapper.readTree(exchange.getRequestBody().readAllBytes());
				if (path.endsWith("window-compositions")) { compositionCalls.incrementAndGet(); lastComposition = request; }
				else { analysisCalls.incrementAndGet(); lastAnalysis = request; }
				Reply reply = handler.apply(path, request);
				byte[] body = reply.body().getBytes(StandardCharsets.UTF_8);
				try { exchange.getResponseHeaders().add("Content-Type", "application/json"); exchange.sendResponseHeaders(reply.status(), body.length); exchange.getResponseBody().write(body); }
				catch (IOException ignored) { } finally { exchange.close(); }
			});
			server.start();
		} catch (IOException e) { throw new IllegalStateException(e); }
	}
	public String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }
	public void reset() { handler = this::normal; labels = List.of("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED"); compositionCalls.set(0); analysisCalls.set(0); }
	public Reply normal(String path, ObjectNode request) {
		ObjectNode response = request.deepCopy(); var visits = response.remove("visits");
		if (path.endsWith("window-compositions")) {
			response.put("composedThroughSequence", visits.get(visits.size() - 1).get("sequence").intValue());
			var windows = response.putArray("windows");
			for (int i = 0; i < visits.size() - 2; i++) {
				var window = windows.addObject(); var ids = window.putArray("visitIds");
				for (int j = 0; j < 3; j++) ids.add(visits.get(i + j).get("visitId").stringValue());
				window.put("endVisitId", visits.get(i + 2).get("visitId").stringValue());
			}
		} else {
			response.remove("goalText"); response.remove("windowIndex"); var pages = response.putArray("pageResults");
			for (int i = 0; i < 3; i++) {
				var page = pages.addObject(); page.put("position", i + 1); page.set("visitId", visits.get(i).get("visitId"));
				page.put("label", labels.get(i)); page.put("semanticRelevance", 0.25); page.put("rationale", "Synthetic fixture rationale.");
			}
			response.set("modelVersions", mapper.valueToTree(Map.of("embedding", "synthetic-mock", "context", "synthetic-mock", "prompt", "synthetic-mock", "labelGuide", "synthetic-mock")));
			response.put("analyzedAt", "2026-11-10T00:00:00.000Z");
		}
		return new Reply(200, mapper.writeValueAsString(response));
	}
	@Override public void close() { server.stop(0); executor.shutdownNow(); }
}
