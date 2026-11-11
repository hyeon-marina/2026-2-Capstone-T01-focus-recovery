package com.focusrecovery.domain.storage;
import static org.assertj.core.api.Assertions.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
class V16MigrationTest {
 @Test void h2PreservesV15AndSeedsNoApproval(){verify("jdbc:h2:mem:migration99_"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","sa","");}
 @Test @EnabledIfEnvironmentVariable(named="FOCUS97_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:3397/focus97.*")
 void actualMysqlV15ToV16() {
  String base=System.getenv("FOCUS97_MYSQL_URL"),password=System.getenv("FOCUS97_MYSQL_PASSWORD"),schema="focus97_issue99_"+UUID.randomUUID().toString().replace("-","");
  var ds=new SingleConnectionDataSource(base,"root",password,true);new JdbcTemplate(ds).execute("CREATE DATABASE "+schema+" CHARACTER SET utf8mb4");ds.destroy();
  verify(base.replaceFirst("/focus97[^?]*","/"+schema),"root",password);
 }
 void verify(String url,String user,String password){
  new V15MigrationTest().verify(url,user,password);
  var ds=new SingleConnectionDataSource(url,user,password,true);var j=new JdbcTemplate(ds);
  var before=new V2MigrationTest().normalize(j.queryForList("SELECT * FROM work_session"));
  var f=Flyway.configure().dataSource(ds).load();assertThat(f.migrate().migrationsExecuted).isEqualTo(1);
  assertThat(new V2MigrationTest().normalize(j.queryForList("SELECT * FROM work_session"))).containsExactlyInAnyOrderElementsOf(before);
  assertThat(j.queryForObject("SELECT COUNT(*) FROM collection_release",Integer.class)).isZero();
  assertThat(j.queryForObject("SELECT COUNT(*) FROM session_collection_scope",Integer.class)).isZero();
  assertThat(f.migrate().migrationsExecuted).isZero();f.validate();ds.destroy();
 }
}
