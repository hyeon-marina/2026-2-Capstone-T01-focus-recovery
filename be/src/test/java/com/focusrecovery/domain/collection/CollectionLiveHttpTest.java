package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import com.focusrecovery.domain.identity.AuthenticationService;
import com.focusrecovery.domain.privacy.service.RetractionExecutionPolicy;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
 "spring.datasource.url=jdbc:h2:mem:collection97live;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
 "focus-recovery.collection.administration-enabled=true","focus-recovery.v2.storage.enabled=true","focus-recovery.v2.dispatch.enabled=true","focus-recovery.v2.dispatch.interval=50ms",
 "focus-recovery.v2.withdrawal.interval=50ms","focus-recovery.v2.retraction.interval=50ms","focus-recovery.v2.storage.recovery-interval=1h",
 "focus-recovery.v2.retraction.service-secret=synthetic-service-only-secret-93-0123456789"})
@ActiveProfiles("test") @Import(CollectionLiveHttpTest.SyntheticExecution.class)
@EnabledIfEnvironmentVariable(named="FOCUS97_AI_URL",matches="http://127\\.0\\.0\\.1:8897")
class CollectionLiveHttpTest {
 @LocalServerPort int port;@Autowired JdbcTemplate jdbc;
 @DynamicPropertySource static void services(DynamicPropertyRegistry p){
  p.add("focus-recovery.ai.base-url",()->System.getenv("FOCUS97_AI_URL"));
  if(System.getenv("FOCUS97_MYSQL_URL")!=null){p.add("spring.datasource.url",()->System.getenv("FOCUS97_MYSQL_URL"));p.add("spring.datasource.username",()->"root");p.add("spring.datasource.password",()->System.getenv("FOCUS97_MYSQL_PASSWORD"));}
 }
 @TestConfiguration static class SyntheticExecution {
  @Bean @Primary RetractionExecutionPolicy synthetic(JdbcTemplate jdbc){return new RetractionExecutionPolicy(null,null){
   @Override public boolean permitsSyntheticExecution(UUID session){return jdbc.queryForObject("SELECT COUNT(*) FROM work_session s JOIN consent_record c ON c.consent_id=s.consent_id JOIN consent_policy p ON p.policy_id=c.policy_id AND p.policy_version=c.policy_version WHERE s.session_id=? AND p.status='SYNTHETIC'",Integer.class,session.toString())==1;}
  };}
 }
 @Test @EnabledIfEnvironmentVariable(named="CHROMIUM_PATH",matches=".+")
 void actualChromeToMysqlAndFastApiTenVisitsEightWindowsRegistrationAndWithdrawal() throws Exception {
  for(String table:List.of("collection_failure","collection_attempt","collection_assignment","collection_goal","collection_slot","collection_plan","collection_audit","collection_operator"))jdbc.update("DELETE FROM "+table);
  String operator=UUID.randomUUID().toString(),token=Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.SecureRandom.getSeed(32));
  jdbc.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",operator,AuthenticationService.digest(UUID.randomUUID().toString()),Timestamp.from(Instant.now()));
  jdbc.update("INSERT INTO access_credential VALUES(?,?,?,NULL)",AuthenticationService.digest(token),operator,Timestamp.from(Instant.now().plusSeconds(3600)));
  jdbc.update("INSERT INTO collection_operator VALUES(?,'synthetic-authority-97',?,NULL)",operator,Timestamp.from(Instant.now()));
  if(jdbc.queryForObject("SELECT COUNT(*) FROM consent_policy WHERE policy_id='SYNTHETIC-97'",Integer.class)==0)jdbc.update("INSERT INTO consent_policy VALUES('SYNTHETIC-97','1','SESSION_COLLECTION','Closed catalog synthetic test only','No participant information','Testing only',NULL,NULL,'SYNTHETIC',?)",Timestamp.from(Instant.EPOCH));
  var builder=new ProcessBuilder("npm","run","test:collection:browser").directory(Path.of("../fe").toFile()).redirectErrorStream(true).redirectOutput(Path.of("/private/tmp/focus97-chrome-http.log").toFile());
  builder.environment().put("FE97_SERVER","http://127.0.0.1:"+port);builder.environment().put("FE97_OPERATOR_TOKEN",token);
  var child=builder.start();
  try{assertThat(child.waitFor(240,java.util.concurrent.TimeUnit.SECONDS)).isTrue();assertThat(child.exitValue()).as(Files.readString(Path.of("/private/tmp/focus97-chrome-http.log"))).isZero();}finally{if(child.isAlive())child.destroyForcibly();}
  assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collection_attempt WHERE source='SYNTHETIC'",Integer.class)).isEqualTo(1);
  String session=jdbc.queryForObject("SELECT session_id FROM collection_attempt",String.class);
  assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM page_visit WHERE session_id=?",Integer.class,session)).isEqualTo(10);
  assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM analysis_window WHERE session_id=?",Integer.class,session)).isEqualTo(8);
  if("1".equals(System.getenv("FE97_EXPECT_DRIFT_ALERT"))) {
   assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notification WHERE session_id=? AND shown_at IS NOT NULL",Integer.class,session)).isGreaterThanOrEqualTo(1);
   assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notification_response r JOIN notification n ON n.alert_id=r.alert_id WHERE n.session_id=?",Integer.class,session)).isGreaterThanOrEqualTo(1);
  }
  assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM work_session WHERE session_id=? AND privacy_status='QUARANTINED'",Integer.class,session)).isEqualTo(1);
 }
}
