package com.focusrecovery.domain.storage;
import static org.assertj.core.api.Assertions.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
class V17MigrationTest {
 @Test void additiveExportMetadataPreservesV16RowsAndSeedsNoIdentityOrApproval(){
  String url="jdbc:h2:mem:migration101_"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
  verify(url,"sa","");
 }
 @Test @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named="FOCUS101_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:3311[123]/focus101.*")
 void actualMysqlV16ToV17PreservesRows(){
  String base=System.getenv("FOCUS101_MYSQL_URL"),password=System.getenv("FOCUS101_MYSQL_PASSWORD"),schema="focus101_migration_"+UUID.randomUUID().toString().replace("-","");
  var ds=new SingleConnectionDataSource(base,"root",password,true);new JdbcTemplate(ds).execute("CREATE DATABASE "+schema+" CHARACTER SET utf8mb4");ds.destroy();
  verify(base.replaceFirst("/focus101[^?]*","/"+schema),"root",password);
 }
 void verify(String url,String user,String password){
  new V16MigrationTest().verify(url,user,password);
  var ds=new SingleConnectionDataSource(url,user,password,true);var j=new JdbcTemplate(ds);
  var before=new LinkedHashMap<String,List<Map<String,Object>>>();
  for(String table:List.of("work_session","page_visit","participant","consent_record","privacy_retraction","collection_release"))before.put(table,new V2MigrationTest().normalize(j.queryForList("SELECT * FROM "+table)));
  var f=Flyway.configure().dataSource(ds).load();assertThat(f.migrate().migrationsExecuted).isEqualTo(1);
  before.forEach((table,rows)->assertThat(new V2MigrationTest().normalize(j.queryForList("SELECT * FROM "+table))).containsExactlyInAnyOrderElementsOf(rows));
  assertThat(j.queryForObject("SELECT COUNT(*) FROM collection_export_audit",Integer.class)).isZero();
  assertThat(j.queryForObject("SELECT COUNT(*) FROM collection_source_instance",Integer.class)).isZero();
  assertThat(f.migrate().migrationsExecuted).isZero();f.validate();ds.destroy();
 }
}
