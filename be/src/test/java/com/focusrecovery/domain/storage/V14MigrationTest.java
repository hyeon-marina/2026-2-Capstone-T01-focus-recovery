package com.focusrecovery.domain.storage;

import static org.assertj.core.api.Assertions.*;
import java.sql.DriverManager;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class V14MigrationTest {
    @Test void h2PreservesV13RowsAndNeverBackfillsOwnerOrConsent() {
        verify("jdbc:h2:mem:migration95_"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","sa","");
    }
    @Test @EnabledIfEnvironmentVariable(named="FOCUS95_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:3393/focus95.*")
    void actualMysqlPreservesLegacyPayloadAndEnforcesOwnershipConsentFk() throws Exception {
        String base=System.getenv("FOCUS95_MYSQL_URL"), schema="focus95_migration_"+UUID.randomUUID().toString().replace("-","");
        try(var conn=DriverManager.getConnection(base,"root","synthetic-test-only");var stmt=conn.createStatement()) {
            stmt.execute("CREATE DATABASE "+schema+" CHARACTER SET utf8mb4");
            try {verify(base.replaceFirst("/focus95[^?]*","/"+schema),"root","synthetic-test-only");}
            finally {stmt.execute("DROP DATABASE "+schema);}
        }
    }
    void verify(String url,String user,String password) {
        new V13MigrationTest().verify(url,user,password);
        var ds=new org.springframework.jdbc.datasource.SingleConnectionDataSource(url,user,password,true);var jdbc=new JdbcTemplate(ds);
        var before=new LinkedHashMap<String,List<Map<String,Object>>>();
        for(String table:List.of("work_session","page_visit","analysis_window","window_visit","analysis_result","notification","notification_response","privacy_retraction","retraction_target"))
            before.put(table,new V2MigrationTest().normalize(jdbc.queryForList("SELECT * FROM "+table)));
        var flyway=Flyway.configure().dataSource(ds).load();assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
        before.forEach((table,rows)->assertThat(new V2MigrationTest().normalize(jdbc.queryForList("SELECT "+String.join(",",rows.getFirst().keySet())+" FROM "+table))).containsExactlyInAnyOrderElementsOf(rows));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM work_session WHERE owner_participant_id IS NOT NULL OR consent_id IS NOT NULL",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM consent_policy",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM consent_record",Integer.class)).isZero();
        String session=jdbc.queryForObject("SELECT session_id FROM work_session",String.class);
        assertThatThrownBy(()->jdbc.update("UPDATE work_session SET owner_participant_id=? WHERE session_id=?",UUID.randomUUID().toString(),session)).isInstanceOf(org.springframework.dao.DataAccessException.class).hasMessageContaining("ck_session_owner_consent");
        com.focusrecovery.support.SyntheticIdentities.seed(jdbc);
        assertThatThrownBy(()->jdbc.update("UPDATE work_session SET owner_participant_id=?,consent_id=? WHERE session_id=?",com.focusrecovery.support.SyntheticIdentities.BOB.toString(),com.focusrecovery.support.SyntheticIdentities.CONSENT.toString(),session)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThat(flyway.migrate().migrationsExecuted).isZero();flyway.validate();ds.destroy();
    }
}
