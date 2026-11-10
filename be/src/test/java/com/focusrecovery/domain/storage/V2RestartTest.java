package com.focusrecovery.domain.storage;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import com.focusrecovery.FocusRecoveryApplication;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.domain.visit.service.PageVisitService;
import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;
import com.focusrecovery.domain.composition.dto.Composition;
import com.focusrecovery.domain.composition.service.*;
import com.focusrecovery.domain.analysis.repository.AnalysisResultRepository;
import com.focusrecovery.domain.analysis.entity.AnalysisStatus;
import com.focusrecovery.domain.analysis.service.V2AnalysisOutboxService;
import com.focusrecovery.domain.privacy.dto.Retraction;
import com.focusrecovery.domain.privacy.service.PrivacyRetractionService;
import com.focusrecovery.domain.privacy.repository.VisitTombstoneRepository;

class V2RestartTest {
	@TempDir Path directory;
	ConfigurableApplicationContext open() {
		return new SpringApplicationBuilder(FocusRecoveryApplication.class).profiles("test").web(WebApplicationType.NONE)
			.run("--spring.datasource.url=jdbc:h2:file:"+directory.resolve("restart")+";MODE=MySQL;DATABASE_TO_LOWER=TRUE",
				"--focus-recovery.v2.storage.enabled=true","--focus-recovery.v2.storage.recovery-interval=1h",
				"--spring.main.banner-mode=off","--logging.level.root=ERROR");
	}
	@Test void newApplicationContextRecoversDurableReceiptsClaimsOutboxAndTombstone() {
		UUID session,interruptedSession,privateSession,privateVisit=UUID.randomUUID();
		Composition.Claim interrupted;
		Composition.Receipt receipt;
		Composition.Output output;
		try(var app=open()) {
			var sessions=app.getBean(WorkSessionService.class);var visits=app.getBean(PageVisitService.class);var compose=app.getBean(CompositionService.class);
			session=sessions.create("합성 재시작 목표입니다",null,"2.0").sessionId();
			List<Composition.Visit> items=new ArrayList<>();
			for(int i=1;i<=4;i++) {UUID id=UUID.randomUUID();visits.save(session,request(id,i));items.add(new Composition.Visit(id,i));}
			UUID id=UUID.randomUUID();var input=compose.prepareNext(session,id);var claim=compose.claim(session,id);
			output=new Composition.Output(2,id,session,0,input.inputFingerprint(),4,List.of(
				new Composition.Window(items.subList(0,3).stream().map(Composition.Visit::visitId).toList(),items.get(2).visitId()),
				new Composition.Window(items.subList(1,4).stream().map(Composition.Visit::visitId).toList(),items.get(3).visitId())));
			receipt=compose.complete(session,id,claim.token(),output);
			app.getBean(V2AnalysisOutboxService.class).claim(session,receipt.windows().getLast().analysisId());
			interruptedSession=sessions.create("합성 중단 목표입니다",null,"2.0").sessionId();
			visits.save(interruptedSession,request(UUID.randomUUID(),1));UUID pendingId=UUID.randomUUID();
			compose.prepareNext(interruptedSession,pendingId);interrupted=compose.claim(interruptedSession,pendingId);
			privateSession=sessions.create("합성 격리 목표입니다",null,"2.0").sessionId();
			app.getBean(PrivacyRetractionService.class).quarantine(privateSession,new Retraction.Request(UUID.randomUUID(),privateVisit,"SENSITIVE_CONTENT",Instant.EPOCH));
			var jdbc=app.getBean(JdbcTemplate.class);
			jdbc.update("update compose_request set lease_until=? where compose_request_id=?",java.sql.Timestamp.from(Instant.EPOCH),pendingId.toString());
			jdbc.update("update analysis_outbox set lease_until=? where analysis_id=?",java.sql.Timestamp.from(Instant.EPOCH),receipt.windows().getLast().analysisId().toString());
		}
		try(var restarted=open()) {
			var compose=restarted.getBean(CompositionService.class);var outbox=restarted.getBean(V2AnalysisOutboxService.class);
			assertThat(compose.complete(session,receipt.composeRequestId(),null,output)).isEqualTo(receipt);
			assertThat(outbox.pending()).containsExactly(receipt.windows().getFirst().analysisId());
			restarted.getBean(V2StorageRecovery.class).recover();
			var recovered=compose.claim(interruptedSession,interrupted.input().composeRequestId());
			assertThat(recovered.token()).isNotEqualTo(interrupted.token());
			assertThat(restarted.getBean(AnalysisResultRepository.class).findById(receipt.windows().getLast().analysisId()).orElseThrow().getProcessingStatus()).isEqualTo(AnalysisStatus.FAILED);
			assertThat(restarted.getBean(VisitTombstoneRepository.class).existsById(privateVisit)).isTrue();
			assertThatThrownBy(() -> restarted.getBean(PageVisitService.class).save(privateSession,request(privateVisit,1)))
				.isInstanceOf(com.focusrecovery.global.exception.ConflictException.class).extracting("code").isEqualTo("PRIVACY_RETRACTED");
		}
	}
	CreatePageVisitRequest request(UUID id,int sequence) {
		return new CreatePageVisitRequest(id.toString(),sequence,"synthetic-tab","https://example.org/docs","example.org","합성 제목",
			"합성 재시작 테스트용 공개 문서입니다. ".repeat(4),null,false,Instant.EPOCH,5000L,0,1L,"SUCCESS");
	}
}
