package com.focusrecovery.domain.window.service;

import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;
import com.focusrecovery.domain.analysis.dto.V2AnalysisCompletion;
import com.focusrecovery.domain.window.dto.SaveWindowState;

@Component
public class FinalStateRules {
	public static final String VERSION = "suffix3-v2-proposed.1";
	public String judge(List<V2AnalysisCompletion.Page> pages, List<SaveWindowState.Behavior> behaviors) {
		if (pages == null || behaviors == null || pages.size() != 3 || behaviors.size() != 3)
			throw new IllegalArgumentException("incomplete decision input");
		for (int i = 0; i < 3; i++) {
			var page = pages.get(i); var behavior = behaviors.get(i);
			if (page == null || behavior == null || page.position() != i + 1 || page.visitId() == null
				|| !page.visitId().equals(behavior.visitId()) || page.label() == null
				|| !Set.of("DIRECT", "JUSTIFIED_DETOUR", "UNRELATED").contains(page.label())
				|| behavior.activeDurationMs() < 5000 || behavior.activeDurationMs() > 9007199254740991L)
				throw new IllegalArgumentException("invalid decision input");
		}
		int suffix = 0; boolean longVisit = false;
		for (int i = 2; i >= 0 && pages.get(i).label().equals("UNRELATED"); i--) {
			suffix++; longVisit |= behaviors.get(i).activeDurationMs() >= 300000;
		}
		if (suffix == 3 || longVisit) return "DRIFT";
		return suffix == 2 ? "TRANSITION" : "NORMAL";
	}
}
