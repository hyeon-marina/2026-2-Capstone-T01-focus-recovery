package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import com.focusrecovery.FocusRecoveryApplication;
import com.focusrecovery.domain.identity.*;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
class CollectionRestartTest {
 @TempDir Path directory;
 ConfigurableApplicationContext open(String url,String password){
  Map<String,Object> p=new HashMap<>();p.put("spring.datasource.url",url);p.put("spring.datasource.username",url.startsWith("jdbc:h2")?"sa":"root");p.put("spring.datasource.password",password);
  p.put("focus-recovery.collection.administration-enabled",true);p.put("focus-recovery.v2.storage.enabled",true);p.put("focus-recovery.v2.dispatch.enabled",false);p.put("focus-recovery.v2.storage.recovery-interval","1h");p.put("focus-recovery.v2.withdrawal.interval","1h");p.put("focus-recovery.v2.retraction.interval","1h");p.put("logging.level.root","ERROR");p.put("spring.main.banner-mode","off");
  return new SpringApplicationBuilder(FocusRecoveryApplication.class).profiles("test").web(WebApplicationType.NONE).initializers(c->c.getEnvironment().getPropertySources().addFirst(new MapPropertySource("collection-restart-test",p))).run();
 }
 @Test void h2ProcessContextRestartKeepsRegistrationCredentialsAndPlan(){verify("jdbc:h2:file:"+directory.resolve("restart97")+";MODE=MySQL;DATABASE_TO_LOWER=TRUE","");}
 @Test @EnabledIfEnvironmentVariable(named="FOCUS97_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus97.*")
 void actualMysqlNewSpringContextKeepsOperationsMetadata(){verify(System.getenv("FOCUS97_MYSQL_URL"),System.getenv("FOCUS97_MYSQL_PASSWORD"));}
 void verify(String url,String password){
  String operator=UUID.randomUUID().toString(),token=Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.SecureRandom.getSeed(32));CollectionAdministration.IssuedCredential issued;
  CollectionPlanService.Plan before;
  try(var app=open(url,password)){
   var j=app.getBean(JdbcTemplate.class);j.update("INSERT INTO participant(participant_id,identity_reference_hash,status,created_at) VALUES(?,?,'ACTIVE',?)",operator,AuthenticationService.digest(UUID.randomUUID().toString()),Timestamp.from(Instant.now()));
   j.update("INSERT INTO access_credential VALUES(?,?,?,NULL)",AuthenticationService.digest(token),operator,Timestamp.from(Instant.now().plusSeconds(3600)));j.update("INSERT INTO collection_operator VALUES(?,'synthetic-restart-97',?,NULL)",operator,Timestamp.from(Instant.now()));
   AuthenticatedParticipant.bind(app.getBean(AuthenticationService.class).authenticate("Bearer "+token));
   var admin=app.getBean(CollectionAdministration.class);UUID participant=UUID.fromString((String)admin.enroll(new CollectionAdministration.Enrollment(AuthenticationService.digest(UUID.randomUUID().toString()),"synthetic-restart-97")).get("participantId"));
   issued=admin.issue(participant,new CollectionAdministration.Issue(Instant.now().plusSeconds(900),"synthetic-restart-issuance"));
   before=app.getBean(CollectionPlanService.class).initialize();
  }finally{AuthenticatedParticipant.clear();}
  try(var app=open(url,password)){
   assertThat(app.getBean(AuthenticationService.class).authenticate("Bearer "+issued.credential()).participantId().toString()).isEqualTo(issued.participantId());
   AuthenticatedParticipant.bind(app.getBean(AuthenticationService.class).authenticate("Bearer "+token));
   assertThat(app.getBean(CollectionPlanService.class).read()).isEqualTo(before);
   assertThat(app.getBean(CollectionAdministration.class).auditLog()).anyMatch(r->r.get("target_id").equals(issued.credentialId()));
  }finally{AuthenticatedParticipant.clear();}
 }
}
