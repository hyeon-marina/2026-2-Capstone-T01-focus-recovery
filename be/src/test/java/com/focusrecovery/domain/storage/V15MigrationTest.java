package com.focusrecovery.domain.storage;

import static org.assertj.core.api.Assertions.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
class V15MigrationTest {
 @Test void h2AdditiveMigrationPreservesEveryV14Row(){verify("jdbc:h2:mem:migration97_"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","sa","");}
 @Test @EnabledIfEnvironmentVariable(named="FOCUS97_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus97.*")
 void actualMysqlV14ToV15AndIdempotentValidation(){
  String base=System.getenv("FOCUS97_MYSQL_URL"),password=System.getenv("FOCUS97_MYSQL_PASSWORD"),schema="focus97_migration_"+UUID.randomUUID().toString().replace("-","");
  var ds=new SingleConnectionDataSource(base,"root",password,true);var j=new JdbcTemplate(ds);j.execute("CREATE DATABASE "+schema+" CHARACTER SET utf8mb4");
  verify(base.replaceFirst("/focus97[^?]*","/"+schema),"root",password);ds.destroy();
 }
 void verify(String url,String user,String password){
  new V14MigrationTest().verify(url,user,password);
  var ds=new SingleConnectionDataSource(url,user,password,true);var j=new JdbcTemplate(ds);
  var before=new LinkedHashMap<String,List<Map<String,Object>>>();for(String t:List.of("work_session","page_visit","analysis_window","window_visit","analysis_result","notification","notification_response","participant","access_credential","consent_policy","consent_record","privacy_retraction","visit_tombstone","retraction_target"))before.put(t,new V2MigrationTest().normalize(j.queryForList("SELECT * FROM "+t)));
  var flyway=Flyway.configure().dataSource(ds).target("15").load();assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
  before.forEach((t,rows)->assertThat(new V2MigrationTest().normalize(j.queryForList("SELECT * FROM "+t))).containsExactlyInAnyOrderElementsOf(rows));
  assertThat(j.queryForObject("SELECT COUNT(*) FROM collection_operator",Integer.class)).isZero();assertThat(j.queryForObject("SELECT COUNT(*) FROM collection_attempt",Integer.class)).isZero();
  assertThat(flyway.migrate().migrationsExecuted).isZero();flyway.validate();ds.destroy();
 }
}
