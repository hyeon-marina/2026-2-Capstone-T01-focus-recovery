package com.focusrecovery.domain.identity;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.http.MediaType;
import com.focusrecovery.domain.consent.*;
import com.focusrecovery.domain.session.entity.WorkSession;
import com.focusrecovery.domain.session.repository.WorkSessionRepository;
import com.focusrecovery.domain.session.service.WorkSessionService;
import com.focusrecovery.domain.composition.service.CompositionService;
import com.focusrecovery.domain.composition.dto.Composition;
import com.focusrecovery.domain.analysis.service.V2AnalysisOutboxService;
import com.focusrecovery.domain.privacy.service.*;
import com.focusrecovery.domain.privacy.entity.RetractionTargetId;
import com.focusrecovery.domain.visit.dto.CreatePageVisitRequest;
import com.focusrecovery.domain.visit.service.PageVisitService;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:auth95;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "focus-recovery.v2.storage.enabled=true", "focus-recovery.v2.storage.recovery-interval=1h", "focus-recovery.v2.withdrawal.interval=1h", "focus-recovery.v2.retraction.interval=1h"})
@AutoConfigureMockMvc @ActiveProfiles("test")
class AuthConsentTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired AuthenticationService authentication;
    @Autowired ConsentService consent;
    @Autowired OwnedSessionService owned;
    @Autowired WithdrawalService withdrawals;
    @Autowired WithdrawalDispatcher dispatcher;
    @Autowired PageVisitService visits;
    @Autowired CompositionService compositions;
    @Autowired V2AnalysisOutboxService analyses;
    @Autowired RetractionWorkService retractionWork;
    @Autowired WorkSessionRepository sessions;
    @Autowired WorkSessionService workSessions;
    @Autowired JsonMapper mapper;
    String alice, bob;
    UUID a, b;
    static final String POLICY = "SYNTHETIC-95-NO-PARTICIPANTS";
    @BeforeEach void setup() {
        if (jdbc.queryForObject("SELECT COUNT(*) FROM consent_policy WHERE policy_id=?",Integer.class,POLICY)==0)
            jdbc.update("INSERT INTO consent_policy VALUES(?,'1','SESSION_COLLECTION','Synthetic authentication tests only','Closed catalog fixtures','Synthetic test processing only',NULL,NULL,'SYNTHETIC',?)", POLICY,Timestamp.from(Instant.EPOCH));
        a=UUID.randomUUID(); b=UUID.randomUUID(); alice=provision(a); bob=provision(b);
    }
    @AfterEach void cleanup() {
        AuthenticatedParticipant.clear();
        jdbc.update("UPDATE consent_policy SET status='RETIRED',effective_at='2098-01-01 00:00:00' WHERE policy_id=? AND policy_version IN ('2','3')",POLICY);
        jdbc.update("UPDATE consent_policy SET status='SYNTHETIC',approval_ref=NULL,retention_policy_ref=NULL WHERE policy_id=? AND policy_version='1'",POLICY);
    }
    String provision(UUID owner) {
        byte[] bytes=new byte[32]; new java.security.SecureRandom().nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",owner.toString(),AuthenticationService.digest(UUID.randomUUID().toString()),Timestamp.from(Instant.now()));
        jdbc.update("INSERT INTO access_credential(token_hash,participant_id,expires_at) VALUES(?,?,?)",AuthenticationService.digest(token),owner.toString(),Timestamp.from(Instant.now().plusSeconds(3600)));
        return token;
    }
    void as(String token) { AuthenticatedParticipant.bind(authentication.authenticate("Bearer "+token)); }
    void agree(String token) { as(token); consent.accept(new ConsentService.Accept(UUID.randomUUID(),POLICY,"1",true)); }
    UUID session(String token) { agree(token); return owned.create("Synthetic public document research",UUID.randomUUID().toString(),"2.0").sessionId(); }
    String path(UUID s) { return "/api/sessions/"+s; }
    int statusGet(String token,String path) throws Exception { return mvc.perform(get(path).header("Authorization","Bearer "+token)).andReturn().getResponse().getStatus(); }
    CreatePageVisitRequest visit(UUID id,int sequence) { return new CreatePageVisitRequest(id.toString(),sequence,"synthetic-tab","https://example.org/docs","example.org","Synthetic public document","Synthetic public catalog content for ownership and consent integration. ".repeat(2),null,false,Instant.EPOCH,5000L,0,1L,"SUCCESS"); }
    @Test void opaqueTokenIsVerifiedOnServerAndOnlyHashIsStored() throws Exception {
        var r=mvc.perform(get("/api/auth/me").header("Authorization","Bearer "+alice)).andExpect(status().isOk()).andExpect(jsonPath("$.participantId").value(a.toString())).andReturn();
        assertThat(r.getResponse().getContentAsString()).doesNotContain(alice,AuthenticationService.digest(alice));
        assertThat(authentication.authenticate("Bearer "+alice).toString()).doesNotContain(alice,AuthenticationService.digest(alice));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM access_credential WHERE token_hash=?",Integer.class,alice)).isZero();
        assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
    }
    @ParameterizedTest @ValueSource(strings={"", "Bearer forged", "Basic abc", "Bearer 95000000-0000-4000-8000-000000000001"})
    void unauthenticatedForgedAndIdsNeverAuthenticate(String header) throws Exception {
        mvc.perform(post("/api/sessions").header("Authorization",header).contentType(MediaType.APPLICATION_JSON).content("{\"goalText\":\"Synthetic goal\"}"))
            .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/consent").header("Authorization",header)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/future-api").header("Authorization",header)).andExpect(status().isUnauthorized());
    }
    @Test void expiryAndLogoutAreRecheckedWithoutServerSessionCache() throws Exception {
        jdbc.update("UPDATE access_credential SET expires_at=? WHERE token_hash=?",Timestamp.from(Instant.EPOCH),AuthenticationService.digest(alice));
        assertThat(statusGet(alice,"/api/auth/me")).isEqualTo(401);
        mvc.perform(post("/api/auth/logout").header("Authorization","Bearer "+bob)).andExpect(status().isNoContent());
        assertThat(statusGet(bob,"/api/auth/me")).isEqualTo(401);
    }
    @Test void newVerifierAfterRestartRequiresPersistedUnrevokedToken() {
        var restarted=new AuthenticationService(jdbc,Clock.systemUTC());
        assertThat(restarted.authenticate("Bearer "+alice).participantId()).isEqualTo(a);
        jdbc.update("UPDATE access_credential SET revoked_at=? WHERE token_hash=?",Timestamp.from(Instant.now()),AuthenticationService.digest(alice));
        assertThatThrownBy(()->restarted.authenticate("Bearer "+alice)).isInstanceOf(AccessDenied.class);
    }
    @Test void missingConsentAndDraftPolicyBlockCreation() throws Exception {
        AuthenticatedParticipant.clear();
        assertThatThrownBy(()->workSessions.create("Synthetic unauthorized internal creation",null,"2.0")).isInstanceOf(AccessDenied.class);
        as(alice); assertThatThrownBy(()->owned.create("Synthetic goal",null,"2.0")).hasFieldOrPropertyWithValue("code","CONSENT_REQUIRED");
        jdbc.update("UPDATE consent_policy SET status='DRAFT' WHERE policy_id=?",POLICY);
        assertThatThrownBy(()->consent.accept(new ConsentService.Accept(UUID.randomUUID(),POLICY,"1",true))).hasFieldOrPropertyWithValue("code","CONSENT_POLICY_UNAVAILABLE");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM consent_record WHERE participant_id=?",Integer.class,a.toString())).isZero();
    }
    @Test void approvedWithoutEvidenceIsStillUnusableAndExplicitActionIsRequired() {
        as(alice); jdbc.update("UPDATE consent_policy SET status='APPROVED' WHERE policy_id=?",POLICY);
        assertThatThrownBy(()->consent.accept(new ConsentService.Accept(UUID.randomUUID(),POLICY,"1",true))).hasFieldOrPropertyWithValue("code","CONSENT_POLICY_UNAVAILABLE");
        assertThatThrownBy(()->consent.accept(new ConsentService.Accept(UUID.randomUUID(),POLICY,"1",false))).isInstanceOf(com.focusrecovery.global.exception.InvalidRequestException.class);
    }
    @Test void duplicateConsentPreservesFirstAcceptanceAndAuditEvents() {
        as(alice); UUID request=UUID.randomUUID(); var input=new ConsentService.Accept(request,POLICY,"1",true);
        UUID id=consent.accept(input).consentId(); assertThat(consent.accept(input).consentId()).isEqualTo(id);
        assertThat(consent.accept(new ConsentService.Accept(UUID.randomUUID(),POLICY,"1",true)).consentId()).isEqualTo(id);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM consent_record WHERE participant_id=?",Integer.class,a.toString())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM consent_event WHERE participant_id=?",Integer.class,a.toString())).isEqualTo(2);
        as(bob); assertThat(consent.state().consentValid()).isFalse();
    }
    @Test void newPolicyVersionInvalidatesOldConsentAndBoundSession() {
        UUID s=session(alice);
        jdbc.update("INSERT INTO consent_policy VALUES(?,'2','SESSION_COLLECTION','Synthetic next version','Closed fixtures','Synthetic only',NULL,NULL,'SYNTHETIC',?)",POLICY,Timestamp.from(Instant.EPOCH.plusSeconds(1)));
        assertThat(consent.state().consentValid()).isFalse();
        assertThatThrownBy(()->visits.save(s,visit(UUID.randomUUID(),1))).hasFieldOrPropertyWithValue("code","CONSENT_REQUIRED");
        assertThat(consent.accept(new ConsentService.Accept(UUID.randomUUID(),POLICY,"2",true)).consentValid()).isTrue();
        assertThatThrownBy(()->visits.save(s,visit(UUID.randomUUID(),1))).hasFieldOrPropertyWithValue("code","CONSENT_REQUIRED");
    }
    @ParameterizedTest @ValueSource(strings={"", "/visits", "/analysis-status", "/analyses", "/alerts", "/alerts/history", "/windows/95000000-0000-4000-8000-000000000010/states"})
    void otherOwnerAndMissingResourceAreIndistinguishable(String suffix) throws Exception {
        UUID s=session(alice);
        assertThat(statusGet(bob,path(s)+suffix)).isEqualTo(404);
        assertThat(statusGet(bob,path(UUID.randomUUID())+suffix)).isEqualTo(404);
    }
    @ParameterizedTest @ValueSource(strings={"/end", "/visits", "/visit-retractions", "/alerts/95000000-0000-4000-8000-000000000010/responses"})
    void otherOwnerCannotWriteOrRetract(String suffix) throws Exception {
        UUID s=session(alice);
        mvc.perform(post(path(s)+suffix).header("Authorization","Bearer "+bob).contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isNotFound());
        assertThat(sessions.findById(s).orElseThrow().isQuarantined()).isFalse();
    }
    @Test void otherVisitIdAndAlertIdCannotBeReused() throws Exception {
        UUID sa=session(alice), va=UUID.randomUUID(); visits.save(sa,visit(va,1));
        UUID sb=session(bob);
        mvc.perform(patch(path(sa)+"/visits/"+va+"/behavior").header("Authorization","Bearer "+bob).contentType(MediaType.APPLICATION_JSON).content("{\"activeDurationMs\":6000,\"tabSwitchCount\":0,\"behaviorVersion\":2}")).andExpect(status().isNotFound());
        assertThatThrownBy(()->visits.save(sb,visit(va,1))).isInstanceOf(com.focusrecovery.domain.visit.exception.VisitNotFoundException.class);
        mvc.perform(patch(path(sa)+"/alerts/"+UUID.randomUUID()+"/shown").header("Authorization","Bearer "+bob).contentType(MediaType.APPLICATION_JSON).content("{\"shownAt\":\"2026-11-10T00:00:00.000Z\"}")).andExpect(status().isNotFound());
    }
    @Test void ownerlessLegacyRowIsPreservedButCannotBeClaimed() throws Exception {
        UUID id=sessions.saveAndFlush(WorkSession.start("Legacy data preserve",null,"2.0")).getSessionId();
        assertThat(statusGet(alice,path(id))).isEqualTo(404);
        assertThatThrownBy(()->compositions.prepareNext(id,UUID.randomUUID())).hasFieldOrPropertyWithValue("code","CONSENT_REQUIRED");
        assertThat(sessions.findById(id).orElseThrow().getOwnerParticipantId()).isNull();
    }
    @Test void endedSessionRemainsOwnerAccessibleAndRetractable() throws Exception {
        UUID s=session(alice);
        mvc.perform(post(path(s)+"/end").header("Authorization","Bearer "+alice).contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isOk());
        assertThat(statusGet(alice,path(s))).isEqualTo(200); assertThat(statusGet(bob,path(s))).isEqualTo(404);
        as(alice); UUID id=UUID.randomUUID(); assertThat(withdrawals.accept(id).status()).isEqualTo("QUARANTINED");
        assertThat(sessions.findById(s).orElseThrow().isQuarantined()).isTrue();
    }
    @Test void sameSessionKeyIsParticipantScopedAndNeverLeaksPriorGoal() {
        agree(alice); var first=owned.create("Synthetic Alice goal","same-key","2.0");
        assertThat(owned.create("Synthetic Alice goal","same-key","2.0").sessionId()).isEqualTo(first.sessionId());
        agree(bob); var second=owned.create("Synthetic Bob goal","same-key","2.0");
        assertThat(second.sessionId()).isNotEqualTo(first.sessionId());
    }
    @Test void withdrawalIncludesActiveEndedEmptyAndEveryVisitAndRetriesAfterNewWorker() throws Exception {
        UUID s1=session(alice),v1=UUID.randomUUID(),v2=UUID.randomUUID(); visits.save(s1,visit(v1,1)); visits.save(s1,visit(v2,2));
        UUID s2=owned.create("Synthetic ended goal",null,"2.0").sessionId();
        mvc.perform(post(path(s2)+"/end").header("Authorization","Bearer "+alice).contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isOk());
        as(alice); UUID id=UUID.randomUUID(); var r=withdrawals.accept(id);
        assertThat(r.sessions()).hasSize(2); assertThat(withdrawals.accept(id).withdrawalId()).isEqualTo(id);
        assertThat(withdrawals.accept(UUID.randomUUID()).withdrawalId()).isEqualTo(id);
        assertThat(consent.state().withdrawn()).isTrue(); assertThat(consent.state().consentValid()).isFalse();
        assertThatThrownBy(()->owned.create("Synthetic forbidden goal",null,"2.0")).hasFieldOrPropertyWithValue("code","CONSENT_REQUIRED");
        assertThatThrownBy(()->visits.save(s1,visit(UUID.randomUUID(),3))).hasFieldOrPropertyWithValue("code","PRIVACY_RETRACTED");
        assertThat(statusGet(alice,path(s1)+"/analysis-status")).isEqualTo(403);
        var environment=new org.springframework.mock.env.MockEnvironment().withProperty("focus-recovery.v2.storage.enabled","true"); environment.setActiveProfiles("test");
        new WithdrawalDispatcher(jdbc,withdrawals,new com.focusrecovery.global.config.V2StorageGate(environment,consent,new com.focusrecovery.domain.collection.CollectionSitePolicy(environment,jdbc,java.time.Clock.systemUTC(),tools.jackson.databind.json.JsonMapper.builder().build()))).dispatch();
        assertThat(withdrawals.status(id).sessions()).allSatisfy(s->assertThat(s.status()).isEqualTo("INVENTORIED"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM withdrawal_retraction WHERE withdrawal_id=?",Integer.class,id.toString())).isEqualTo(2);
        dispatcher.dispatch(); assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM visit_tombstone WHERE session_id=?",Integer.class,s1.toString())).isEqualTo(2);
        assertThat(withdrawals.status(id).status()).isEqualTo("QUARANTINED"); assertThat(withdrawals.status(id).unmet()).isNotEmpty();
        as(bob); assertThatThrownBy(()->withdrawals.status(id)).isInstanceOf(AccessDenied.class);
    }
    @Test void lateCompositionAndAnalysisClaimCannotSurviveWithdrawal() {
        UUID s=session(alice); for(int i=1;i<=3;i++)visits.save(s,visit(UUID.randomUUID(),i));
        UUID job=UUID.randomUUID(); var input=compositions.prepareNext(s,job); var claim=compositions.claim(s,job);
        withdrawals.accept(UUID.randomUUID());
        assertThatThrownBy(()->compositions.complete(s,job,claim.token(),new Composition.Output(2,job,s,0,input.inputFingerprint(),3,List.of(new Composition.Window(input.visits().stream().map(Composition.Visit::visitId).toList(),input.visits().getLast().visitId())))))
            .hasFieldOrPropertyWithValue("code","PRIVACY_RETRACTED");
        assertThatThrownBy(()->analyses.claim(s,UUID.randomUUID())).hasFieldOrPropertyWithValue("code","PRIVACY_RETRACTED");
    }
    @Test void concurrentWithdrawalAndPostAlwaysLeaveQuarantineAndCompleteInventory() throws Exception {
        UUID s=session(alice),id=UUID.randomUUID();
        try(var pool=Executors.newFixedThreadPool(2)) {
            var latch=new CountDownLatch(1);
            var post=pool.submit(()->{latch.await(); try {visits.save(s,visit(id,1));return true;}catch(com.focusrecovery.global.exception.ConflictException e){assertThat(e.getCode()).isEqualTo("PRIVACY_RETRACTED");return false;}});
            var withdraw=pool.submit(()->{as(alice);try{latch.await();return withdrawals.accept(UUID.randomUUID()).withdrawalId();}finally{AuthenticatedParticipant.clear();}});
            latch.countDown(); boolean stored=post.get(10,TimeUnit.SECONDS); UUID parent=withdraw.get(10,TimeUnit.SECONDS); dispatcher.dispatch();
            assertThat(sessions.findById(s).orElseThrow().isQuarantined()).isTrue();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM withdrawal_retraction WHERE withdrawal_id=?",Integer.class,parent.toString())).isEqualTo(stored?1:0);
        }
    }
    @Test void cleartextOutsideLoopbackSyntheticBoundaryIsRejected() throws Exception {
        mvc.perform(get("/api/auth/me").with(r -> { r.setRemoteAddr("203.0.113.95"); return r; }).header("Authorization","Bearer "+alice)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").secure(true).with(r -> { r.setRemoteAddr("203.0.113.95"); return r; }).header("Authorization","Bearer "+alice)).andExpect(status().isOk());
    }
    @Test void foreignConsentSubjectAndAdditionalFieldsCannotBeAccepted() throws Exception {
        mvc.perform(post("/api/consent").header("Authorization","Bearer "+alice).contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(Map.of("requestId",UUID.randomUUID(),"policyId",POLICY,"policyVersion","1","accepted",true,"participantId",b))))
            .andExpect(status().isBadRequest());
        assertThat(consent.validConsent(a)).isNull();assertThat(consent.validConsent(b)).isNull();
    }
    @Test void concurrentWithdrawalRequestsShareOneCanonicalJobAndEchoEachRequestId() throws Exception {
        UUID s=session(alice),one=UUID.randomUUID(),two=UUID.randomUUID();
        try(var pool=Executors.newFixedThreadPool(2)) {
            var first=pool.submit(()->{as(alice);try{return withdrawals.accept(one);}finally{AuthenticatedParticipant.clear();}});
            var second=pool.submit(()->{as(alice);try{return withdrawals.accept(two);}finally{AuthenticatedParticipant.clear();}});
            var r1=first.get(10,TimeUnit.SECONDS);var r2=second.get(10,TimeUnit.SECONDS);
            assertThat(r1.withdrawalId()).isEqualTo(r2.withdrawalId());assertThat(r1.requestId()).isEqualTo(one);assertThat(r2.requestId()).isEqualTo(two);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM consent_withdrawal WHERE participant_id=?",Integer.class,a.toString())).isEqualTo(1);
            assertThat(sessions.findById(s).orElseThrow().isQuarantined()).isTrue();
        }
    }

    @Test void retiringLatestPolicyNeverReactivatesAnOlderConsent() {
        agree(alice);
        jdbc.update("INSERT INTO consent_policy VALUES(?,'3','SESSION_COLLECTION','Synthetic retired policy','Closed fixtures','Synthetic only',NULL,NULL,'RETIRED',?)",POLICY,Timestamp.from(Instant.EPOCH.plusSeconds(2)));
        assertThat(consent.state().policy().status()).isEqualTo("RETIRED");assertThat(consent.state().consentValid()).isFalse();
    }

    @Test @org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
    void authenticationNeverWritesCredentialOrHashToApplicationLogs(org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        mvc.perform(get("/api/auth/me").header("Authorization","Bearer "+alice)).andExpect(status().isOk());
        mvc.perform(get("/api/auth/me").header("Authorization","Bearer "+alice+"x")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/logout").header("Authorization","Bearer "+alice)).andExpect(status().isNoContent());
        mvc.perform(get("/api/auth/me").header("Authorization","Bearer "+alice)).andExpect(status().isUnauthorized());
        assertThat(output.getAll()).doesNotContain(alice,bob,AuthenticationService.digest(alice));
    }

}
