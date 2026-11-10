package com.focusrecovery.domain.integration;

import static org.assertj.core.api.Assertions.*;
import java.util.*;
import java.util.stream.*;
import org.junit.jupiter.api.*;
import com.focusrecovery.domain.window.service.FinalStateRules;
import com.focusrecovery.domain.window.dto.SaveWindowState.Behavior;
import com.focusrecovery.domain.analysis.dto.V2AnalysisCompletion.Page;

class FinalStateRulesTest {
	@TestFactory Stream<DynamicTest> all216Combinations() {
		List<DynamicTest> tests = new ArrayList<>();
		for (String a : List.of("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED"))
		for (String b : List.of("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED"))
		for (String c : List.of("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED"))
		for (int bits = 0; bits < 8; bits++) {
			List<String> labels = List.of(a, b, c); int mask = bits;
			List<Page> pages = IntStream.range(0, 3).mapToObj(i -> new Page(i + 1, new UUID(0, i + 1), labels.get(i), 0, "synthetic")).toList();
			List<Behavior> behaviors = IntStream.range(0, 3).mapToObj(i -> new Behavior(new UUID(0, i + 1), (mask & (1 << i)) == 0 ? 299999 : 300000, 0, 1)).toList();
			// Independent explicit conditions, not another copy of the suffix loop.
			String expected = !c.equals("UNRELATED") ? "NORMAL"
				: (b.equals("UNRELATED") && a.equals("UNRELATED")) || (mask & 4) != 0 || (b.equals("UNRELATED") && (mask & 2) != 0) ? "DRIFT"
				: b.equals("UNRELATED") ? "TRANSITION" : "NORMAL";
			tests.add(DynamicTest.dynamicTest(labels + " " + bits, () -> assertThat(new FinalStateRules().judge(pages, behaviors)).isEqualTo(expected)));
		}
		return tests.stream();
	}
	@Test void missingAndUnpairedInputsAreRejected() {
		var rules = new FinalStateRules();
		assertThatThrownBy(() -> rules.judge(null, null)).isInstanceOf(IllegalArgumentException.class);
		var pages = List.of(new Page(1, UUID.randomUUID(), "DIRECT", 0, "synthetic"));
		assertThatThrownBy(() -> rules.judge(pages, List.of())).isInstanceOf(IllegalArgumentException.class);
	}
}
