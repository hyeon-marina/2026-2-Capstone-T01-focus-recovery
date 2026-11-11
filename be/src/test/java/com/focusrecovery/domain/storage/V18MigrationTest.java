package com.focusrecovery.domain.storage;
import static org.assertj.core.api.Assertions.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
class V18MigrationTest {
 @Test void preservesV17RowsAndDoesNotSeedOwnerPolicyOrCredential() {
  String url="jdbc:h2:mem:local103_"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
  new V17MigrationTest().verify(url,"sa","");
  var ds=new SingleConnectionDataSource(url,"sa","",true);var jdbc=new JdbcTemplate(ds);
  var before=new LinkedHashMap<String,List<Map<String,Object>>>();
  for(String table:List.of("participant","access_credential","consent_record","work_session","page_visit","collection_release","collection_plan"))before.put(table,new V2MigrationTest().normalize(jdbc.queryForList("SELECT * FROM "+table)));
  var flyway=Flyway.configure().dataSource(ds).load();assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
  before.forEach((table,rows)->assertThat(new V2MigrationTest().normalize(jdbc.queryForList("SELECT * FROM "+table))).containsExactlyInAnyOrderElementsOf(rows));
  assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM collection_local_owner",Integer.class)).isZero();
  assertThat(flyway.migrate().migrationsExecuted).isZero();flyway.validate();ds.destroy();
 }
}
