package com.focusrecovery.domain.integration;

import static org.assertj.core.api.Assertions.*;
import java.net.URI;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import com.focusrecovery.domain.analysis.client.*;
import com.focusrecovery.domain.analysis.dto.V2AnalysisInput;
import com.focusrecovery.domain.analysis.service.V2DispatchProperties;
import com.focusrecovery.domain.composition.dto.Composition;
import com.focusrecovery.support.MockV2AiServer;
import tools.jackson.databind.json.JsonMapper;

class V2AiClientTest {
	MockV2AiServer ai;
	V2AiClient client(String url, Duration timeout) {
		var settings = new V2DispatchProperties(false, timeout, timeout.plusSeconds(2), Duration.ZERO, Duration.ofMillis(10), 1);
		return new V2AiClient(new AiProperties(URI.create(url), Duration.ofMillis(100), Duration.ofSeconds(10), 0.001), settings, JsonMapper.builder().findAndAddModules().build());
	}
	Composition.Input input() { return new Composition.Input(2, UUID.randomUUID(), UUID.randomUUID(), 0, "a".repeat(64), List.of(new Composition.Visit(UUID.randomUUID(), 1))); }
	@BeforeEach void open() { ai = new MockV2AiServer(); }
	@AfterEach void close() { ai.close(); }
	@Test void httpTimeoutIncludesBodyWaitAndConnectionFailureIsExplicit() {
		ai.handler = (path, body) -> { try { Thread.sleep(400); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } return ai.normal(path, body); };
		assertThatThrownBy(() -> client(ai.url(), Duration.ofMillis(100)).compose(input())).isInstanceOf(V2AiException.class).extracting("code").isEqualTo("AI_TIMEOUT");
		assertThatThrownBy(() -> client("http://127.0.0.1:1", Duration.ofSeconds(1)).compose(input())).isInstanceOf(V2AiException.class).extracting("code").isEqualTo("AI_UNAVAILABLE");
	}
	@ParameterizedTest @ValueSource(strings={"duplicate-key", "invalid-json", "version-type", "missing-field"})
	void rejectsWireErrorsBeforeDtoCoercion(String error) {
		ai.handler = (path, body) -> {
			String good = ai.normal(path, body).body();
			return new MockV2AiServer.Reply(200, switch (error) {
				case "duplicate-key" -> good.replaceFirst("\\{", "{\"apiContractVersion\":2,");
				case "invalid-json" -> "not-json";
				case "version-type" -> good.replace("\"apiContractVersion\":2", "\"apiContractVersion\":\"2\"");
				default -> "{}";
			});
		};
		assertThatThrownBy(() -> client(ai.url(), Duration.ofSeconds(1)).compose(input())).isInstanceOf(V2AiException.class).extracting("code").isEqualTo("AI_INVALID_RESPONSE");
	}
	@Test void unsafeLeaseConfigurationCannotStart() {
		assertThatThrownBy(() -> new V2DispatchProperties(true, Duration.ofSeconds(60), Duration.ofSeconds(60), Duration.ZERO, Duration.ofSeconds(1), 2)).isInstanceOf(IllegalArgumentException.class);
	}
	@Test void v1PayloadCannotBeSentThroughV2Client() {
		var bad = new Composition.Input(1, UUID.randomUUID(), UUID.randomUUID(), 0, "a".repeat(64), input().visits());
		assertThatThrownBy(() -> client(ai.url(), Duration.ofSeconds(1)).compose(bad)).isInstanceOf(V2AiException.class);
		assertThat(ai.compositionCalls.get()).isZero();
	}
}
