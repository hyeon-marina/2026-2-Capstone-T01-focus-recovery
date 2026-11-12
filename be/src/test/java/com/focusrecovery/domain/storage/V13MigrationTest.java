package com.focusrecovery.domain.storage;
import static org.assertj.core.api.Assertions.*;
import java.sql.DriverManager;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
class V13MigrationTest {
    @Test void h2V12UpgradePreservesPayloadAndAddsOnlyEvidenceMetadata() {
        verify("jdbc:h2:mem:migration93_" + UUID.randomUUID() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
    }
    @Test @EnabledIfEnvironmentVariable(named="FOCUS93_MYSQL_URL", matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus93.*")
    void mysqlV12UpgradePreservesPayloadAndConstraints() throws Exception {
        String base = System.getenv("FOCUS93_MYSQL_URL"), schema = "focus93_migration_" + UUID.randomUUID().toString().replace("-", "");
        try (var conn = DriverManager.getConnection(base, "root", System.getenv().getOrDefault("FOCUS93_MYSQL_PASSWORD","synthetic-test-only")); var stmt = conn.createStatement()) {
            stmt.execute("CREATE DATABASE " + schema + " CHARACTER SET utf8mb4");
            try { verify(base.replaceFirst("/focus93[^?]*", "/" + schema), "root", System.getenv().getOrDefault("FOCUS93_MYSQL_PASSWORD","synthetic-test-only")); }
            finally { stmt.execute("DROP DATABASE " + schema); }
        }
    }
    void verify(String url, String user, String password) {
        new V12MigrationTest().verify(url, user, password);
        var ds = new DriverManagerDataSource(url, user, password); var jdbc = new JdbcTemplate(ds);
        String session = jdbc.queryForObject("SELECT session_id FROM work_session", String.class), job = UUID.randomUUID().toString(), visit = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO privacy_retraction(retraction_id,session_id,visit_id,reason_code,observed_at,requested_at,input_fingerprint,processing_status,prerequisites) VALUES (?,?,?,'SENSITIVE_CONTENT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,'QUARANTINED','SYNTHETIC')", job, session, visit, "a".repeat(64));
        jdbc.update("INSERT INTO retraction_target(retraction_id,target_type,target_id,processing_status) VALUES (?,'PAGE_VISIT',?,'BLOCKED')", job, visit);
        var before = new LinkedHashMap<String,List<Map<String,Object>>>();
        for (String table : List.of("work_session", "page_visit", "analysis_window", "window_visit", "analysis_result", "notification", "notification_response", "privacy_retraction", "retraction_target")) before.put(table, new V2MigrationTest().normalize(jdbc.queryForList("SELECT * FROM " + table)));
        var flyway = Flyway.configure().dataSource(ds).target("13").load(); assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
        before.forEach((table, rows) -> assertThat(new V2MigrationTest().normalize(jdbc.queryForList("SELECT " + String.join(",", rows.getFirst().keySet()) + " FROM " + table))).containsExactlyInAnyOrderElementsOf(rows));
        assertThat(jdbc.queryForObject("SELECT owner_role FROM retraction_target WHERE retraction_id=?", String.class, job)).isEqualTo("UNASSIGNED");
        assertThat(flyway.migrate().migrationsExecuted).isZero(); flyway.validate();
    }
}
