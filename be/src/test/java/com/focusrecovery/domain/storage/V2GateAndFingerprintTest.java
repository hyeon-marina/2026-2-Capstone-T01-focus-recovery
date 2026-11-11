package com.focusrecovery.domain.storage;
import static org.assertj.core.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;
import com.focusrecovery.global.config.V2StorageGate;
import com.focusrecovery.global.util.CanonicalJson;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
class V2GateAndFingerprintTest {
	@ParameterizedTest @ValueSource(strings={"local","prod","production","test,prod","test,local",""})
	void enablingPropertyCannotOpenNonTestEnvironment(String profiles) {
		var env=new MockEnvironment().withProperty("focus-recovery.v2.storage.enabled","true");
		if (!profiles.isEmpty()) env.setActiveProfiles(profiles.split(","));
		assertThat(new V2StorageGate(env, null, new com.focusrecovery.domain.collection.CollectionSitePolicy(env,null,null,null)).enabled()).isFalse();
	}
	@Test void testRequiresExplicitFlag() {
		var env=new MockEnvironment();env.setActiveProfiles("test");
		assertThat(new V2StorageGate(env, null, new com.focusrecovery.domain.collection.CollectionSitePolicy(env,null,null,null)).enabled()).isFalse();
		env.setProperty("focus-recovery.v2.storage.enabled","true");assertThat(new V2StorageGate(env, null, new com.focusrecovery.domain.collection.CollectionSitePolicy(env,null,null,null)).enabled()).isTrue();
	}
	@Test void matchesContractPythonGoldenFingerprints() throws Exception {
		var mapper=JsonMapper.builder().build(); var json=new CanonicalJson(mapper);
		var cases=mapper.readTree(Files.readString(Path.of("../docs/contracts/v2/fixtures/schema-cases.json"))).get("cases");
		int checked=0;
		for (var sample:cases) {
			String name=sample.get("name").stringValue();
			if (!java.util.Set.of("analysis-request","compose-3").contains(name)) continue;
			ObjectNode input=(ObjectNode)sample.get("input").deepCopy();
			String fingerprint=input.remove("inputFingerprint").stringValue();
			assertThat(json.fingerprint(input)).isEqualTo(fingerprint);checked++;
		}
		assertThat(checked).isEqualTo(2);
	}
}
