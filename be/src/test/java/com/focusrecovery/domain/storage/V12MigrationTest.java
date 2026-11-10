package com.focusrecovery.domain.storage;

import static org.assertj.core.api.Assertions.*;
import java.sql.DriverManager;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class V12MigrationTest {
	@Test void h2UpgradePreservesAllV11RowsAndLegacyUnique() {
		verify("jdbc:h2:mem:migration89_" + UUID.randomUUID() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
	}
	@Test @EnabledIfEnvironmentVariable(named="FOCUS89_MYSQL_URL", matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus89.*")
	void mysqlUpgradePreservesAllV11RowsAndLegacyUnique() throws Exception {
		String base = System.getenv("FOCUS89_MYSQL_URL"), schema = "focus89_migration_" + UUID.randomUUID().toString().replace("-", "");
		try (var connection = DriverManager.getConnection(base, "root", "synthetic-test-only"); var statement = connection.createStatement()) {
			statement.execute("create database " + schema + " character set utf8mb4");
			try { verify(base.replaceFirst("/focus89[^?]*", "/" + schema), "root", "synthetic-test-only"); }
			finally { statement.execute("drop database " + schema); }
		}
	}
	void verify(String url, String user, String password) {
		new V2MigrationTest().verify(url, user, password); // Builds/validates the existing V10 -> V11 synthetic upgrade.
		var datasource = new DriverManagerDataSource(url, user, password); var jdbc = new JdbcTemplate(datasource);
		List<String> tables = List.of("work_session", "page_visit", "analysis_window", "window_visit", "analysis_result", "notification", "alert_candidate_task", "notification_response", "window_state_history", "analysis_outbox", "compose_request");
		Map<String, List<Map<String, Object>>> before = new LinkedHashMap<>();
		for (String table : tables) before.put(table, new V2MigrationTest().normalize(jdbc.queryForList("select * from " + table)));
		var flyway = Flyway.configure().dataSource(datasource).load(); assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
		before.forEach((table, rows) -> assertThat(new V2MigrationTest().normalize(jdbc.queryForList("select " + String.join(",", rows.getFirst().keySet()) + " from " + table))).containsExactlyInAnyOrderElementsOf(rows));
		assertThat(flyway.migrate().migrationsExecuted).isZero(); flyway.validate();
		String session = jdbc.queryForObject("select session_id from work_session", String.class);
		String window = jdbc.queryForObject("select window_id from window_state_history", String.class);
		String analysis = jdbc.queryForObject("select analysis_id from window_state_history", String.class);
		assertThatThrownBy(() -> jdbc.update("insert into notification(alert_id,session_id,analysis_id,alert_type,message,created_at) values (?,?,?,'AI','synthetic',CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), session, analysis)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		jdbc.update("insert into notification(alert_id,session_id,window_id,state_version,state_analysis_id,alert_type,message,created_at) values (?,?,?,1,?,'AI','synthetic',CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), session, window, analysis);
		assertThatThrownBy(() -> jdbc.update("insert into notification(alert_id,session_id,window_id,state_version,state_analysis_id,alert_type,message,created_at) values (?,?,?,1,?,'AI','synthetic',CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), session, window, analysis)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		assertThatThrownBy(() -> jdbc.update("insert into notification(alert_id,session_id,window_id,state_version,state_analysis_id,alert_type,message,created_at) values (?,?,?,2,?,'AI','synthetic',CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), session, window, UUID.randomUUID().toString())).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
	}
}
