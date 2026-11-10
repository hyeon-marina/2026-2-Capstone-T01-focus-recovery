package com.focusrecovery.domain.integration;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import com.focusrecovery.FocusRecoveryApplication;
import com.focusrecovery.domain.analysis.service.*;
import com.focusrecovery.domain.analysis.repository.*;
import com.focusrecovery.domain.composition.service.CompositionService;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.domain.visit.service.PageVisitService;
import com.focusrecovery.domain.visit.dto.*;
import com.focusrecovery.domain.window.repository.*;
import com.focusrecovery.domain.privacy.service.PrivacyRetractionService;
import com.focusrecovery.domain.privacy.dto.Retraction;
import com.focusrecovery.support.MockV2AiServer;

class V2DispatcherRestartTest {
	@TempDir Path directory;
	ConfigurableApplicationContext open(String ai) {
		var app = new SpringApplicationBuilder(FocusRecoveryApplication.class).profiles("test").web(WebApplicationType.NONE).run(
			"--spring.datasource.url=jdbc:h2:file:" + directory.resolve("dispatch89") + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE",
			"--focus-recovery.ai.base-url=" + ai, "--focus-recovery.v2.storage.enabled=true", "--focus-recovery.v2.dispatch.enabled=true",
			"--focus-recovery.v2.dispatch.interval=1h", "--focus-recovery.v2.storage.recovery-interval=1h", "--spring.main.banner-mode=off", "--logging.level.root=ERROR");
        com.focusrecovery.support.SyntheticIdentities.seed(app.getBean(org.springframework.jdbc.core.JdbcTemplate.class));
        com.focusrecovery.support.SyntheticIdentities.bind();
        return app;
	}
	@Test void restartDiscoversPendingAnalysisThenDirtyDecisionAndPreservesPrivacy() throws Exception {
		try (var ai = new MockV2AiServer()) {
			UUID session, window, visit, job;
			try (var app = open(ai.url())) {
				session = app.getBean(WorkSessionService.class).create("합성 재시작 비교 목표", null, "2.0").sessionId();
				List<UUID> ids = new ArrayList<>();
				for (int seq : List.of(1, 3, 8)) {
					UUID id = UUID.randomUUID(); ids.add(id);
					app.getBean(PageVisitService.class).save(session, new CreatePageVisitRequest(id.toString(), seq, "synthetic-tab", "https://example.org/docs", "example.org", "합성 문서",
						"합성 재시작 테스트를 위한 공개 예제 본문입니다. ".repeat(4), null, false, Instant.EPOCH, 5000L, 0, 1L, "SUCCESS"));
				}
				visit = ids.getLast(); job = UUID.randomUUID(); app.getBean(CompositionService.class).prepareNext(session, job);
				app.getBean(V2Dispatcher.class).runComposition(session, job);
				window = app.getBean(AnalysisWindowRepository.class).findBySessionIdOrderByWindowIndex(session).getFirst().getWindowId();
				assertThat(app.getBean(V2AnalysisOutboxService.class).pending()).hasSize(1);
			}
			try (var app = open(ai.url())) {
				V2LiveHttpTest.await(() -> { app.getBean(V2Dispatcher.class).dispatch(); return app.getBean(WindowStateHistoryRepository.class).findFirstByIdWindowIdOrderByIdStateVersionDesc(window).isPresent(); });
				app.getBean(PageVisitService.class).updateBehavior(session, visit, new UpdateVisitBehaviorRequest(300000L, 0, 2L));
				assertThat(app.getBean(AnalysisWindowRepository.class).findById(window).orElseThrow().isDecisionDirty()).isTrue();
			}
			try (var app = open(ai.url())) {
				app.getBean(V2Dispatcher.class).dispatch();
				var latest = app.getBean(WindowStateHistoryRepository.class).findFirstByIdWindowIdOrderByIdStateVersionDesc(window).orElseThrow();
				assertThat(latest.getId().stateVersion()).isEqualTo(2); assertThat(latest.getFinalState()).isEqualTo("DRIFT");
				assertThat(ai.analysisCalls.get()).isEqualTo(1); assertThat(ai.compositionCalls.get()).isEqualTo(1);
				app.getBean(PrivacyRetractionService.class).quarantine(session, new Retraction.Request(UUID.randomUUID(), visit, "SENSITIVE_CONTENT", Instant.EPOCH));
			}
			try (var app = open(ai.url())) {
				app.getBean(V2Dispatcher.class).dispatch();
				var status = (com.focusrecovery.domain.analysis.dto.V2AnalysisStatusResponse) app.getBean(AnalysisQueryService.class).status(session);
				assertThat(status.currentDecision().decisionStatus()).isEqualTo("INVALIDATED"); assertThat(status.lastSuccessfulState()).isNull(); assertThat(status.alert()).isNull();
				assertThat(ai.analysisCalls.get()).isEqualTo(1); assertThat(app.getBean(AnalysisWindowRepository.class).findBySessionIdOrderByWindowIndex(session)).hasSize(1);
			}
		}
	}
}
