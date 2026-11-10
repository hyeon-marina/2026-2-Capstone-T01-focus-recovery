package com.focusrecovery.domain.collection;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.focusrecovery.FocusRecoveryApplication;
import com.focusrecovery.domain.identity.AuthenticationService;
import tools.jackson.databind.json.JsonMapper;
class CollectionBootstrapTest {
 @TempDir Path directory;
 @Test void offlineProvisioningIsOwnerOnlyAuditedAndNeverOverwritesCredential() throws Exception {
  var mapper=JsonMapper.builder().build();Path out=directory.resolve("operator.json"),request=directory.resolve("request.json");
  String url="jdbc:h2:file:"+directory.resolve("bootstrap")+";MODE=MySQL;DATABASE_TO_LOWER=TRUE";
  Files.writeString(request,mapper.writeValueAsString(new CollectionOperatorBootstrap.Request(AuthenticationService.digest("synthetic-authority-bootstrap"),"synthetic-authority-97",out.toString())));
  var app=new SpringApplicationBuilder(FocusRecoveryApplication.class).profiles("test").web(WebApplicationType.NONE).run("--spring.datasource.url="+url,"--spring.main.web-application-type=none","--focus-recovery.collection.bootstrap-request="+request,"--logging.level.root=ERROR","--spring.main.banner-mode=off");
  app.close();
  var secret=mapper.readTree(Files.readString(out));var jdbc=new JdbcTemplate(new DriverManagerDataSource(url,"sa",""));
  assertThat(new AuthenticationService(jdbc,Clock.systemUTC()).authenticate("Bearer "+secret.path("credential").asText()).participantId().toString()).isEqualTo(secret.path("participantId").asText());
  assertThat(Files.getPosixFilePermissions(out)).isEqualTo(PosixFilePermissions.fromString("rw-------"));
  assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collection_operator",Integer.class)).isEqualTo(1);
  assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collection_audit WHERE action='BOOTSTRAP_OPERATOR'",Integer.class)).isEqualTo(1);
  String before=Files.readString(out);
  assertThatThrownBy(()->new SpringApplicationBuilder(FocusRecoveryApplication.class).profiles("test").web(WebApplicationType.NONE).run("--spring.datasource.url="+url,"--spring.main.web-application-type=none","--focus-recovery.collection.bootstrap-request="+request,"--logging.level.root=OFF","--spring.main.banner-mode=off")).isInstanceOf(Exception.class);
  assertThat(Files.readString(out)).isEqualTo(before);
 }
 @Test void bootstrapCannotRunInWebServer(){
  var env=new org.springframework.mock.env.MockEnvironment().withProperty("spring.main.web-application-type","servlet");
  var bootstrap=new CollectionOperatorBootstrap(null,org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class),env,null,null);
  assertThatThrownBy(()->bootstrap.run(null)).hasMessageContaining("Offline");
 }
}
