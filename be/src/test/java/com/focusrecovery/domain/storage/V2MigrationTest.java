package com.focusrecovery.domain.storage;

import static org.assertj.core.api.Assertions.*;
import java.sql.DriverManager;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class V2MigrationTest {
	@Test void emptyDatabaseAndV10UpgradePreserveLegacyRowsAndConstraints() throws Exception {
		verify("jdbc:h2:mem:migration85_"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","sa","");
	}
	@Test @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named="FOCUS85_MYSQL_URL",matches="jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/focus85.*")
	void realMySqlMigration() throws Exception {
		String base=System.getenv("FOCUS85_MYSQL_URL");
		String schema="focus85_migration_"+UUID.randomUUID().toString().replace("-","");
		try(var conn=DriverManager.getConnection(base,"root",System.getenv().getOrDefault("FOCUS85_MYSQL_PASSWORD","synthetic-test-only"));var stmt=conn.createStatement()) {
			stmt.execute("create database "+schema+" character set utf8mb4");
			try { verify(base.replaceFirst("/focus85[^?]*","/"+schema),"root",System.getenv().getOrDefault("FOCUS85_MYSQL_PASSWORD","synthetic-test-only")); }
			finally {stmt.execute("drop database "+schema);}
		}
	}
	void verify(String url,String user,String pass) {
		var ds=new DriverManagerDataSource(url,user,pass);var jdbc=new JdbcTemplate(ds);
		Flyway.configure().dataSource(ds).target("10").load().migrate();
		UUID session=UUID.randomUUID(),window=UUID.randomUUID(),analysis=UUID.randomUUID(),alert=UUID.randomUUID();
		jdbc.update("insert into work_session(session_id,goal_text,started_at,status,idempotency_key) values (?,?,CURRENT_TIMESTAMP,'ACTIVE',?)",session.toString(),"합성 기존 목표입니다",UUID.randomUUID().toString());
		List<UUID> ids=new ArrayList<>();
		for(int i=1;i<=5;i++) {
			UUID id=UUID.randomUUID();ids.add(id);
			jdbc.update("insert into page_visit(visit_id,session_id,sequence,browser_tab_key,normalized_url,domain,content,visited_at,active_duration_ms) values (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,1000)",id.toString(),session.toString(),i,"synthetic-tab","https://example.org/","example.org","합성 기존 본문");
		}
		jdbc.update("insert into analysis_window(window_id,session_id,window_index,window_size,start_visit_id,end_visit_id,created_at) values (?,?,1,5,?,?,CURRENT_TIMESTAMP)",window.toString(),session.toString(),ids.getFirst().toString(),ids.getLast().toString());
		for(int i=0;i<5;i++)jdbc.update("insert into window_visit(window_id,visit_id,position) values (?,?,?)",window.toString(),ids.get(i).toString(),i+1);
		jdbc.update("insert into analysis_result(analysis_id,window_id,processing_status,result,p_normal,p_transition,p_drift,input_snapshot,requested_at) values (?,?,'COMPLETED','DRIFT',0.1,0.1,0.8,'{\"synthetic\":true}',CURRENT_TIMESTAMP)",analysis.toString(),window.toString());
		jdbc.update("insert into notification(alert_id,session_id,analysis_id,alert_type,message,created_at) values (?,?,?,'AI','합성 기존 알림',CURRENT_TIMESTAMP)",alert.toString(),session.toString(),analysis.toString());
		jdbc.update("insert into alert_candidate_task(analysis_id,session_id,status,attempts,created_at,next_attempt_at) values (?,?,'PENDING',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",analysis.toString(),session.toString());
		jdbc.update("insert into notification_response(feedback_id,alert_id,action,selected_at) values (?,?,'RETURN_TO_GOAL',CURRENT_TIMESTAMP)",UUID.randomUUID().toString(),alert.toString());
		Map<String,List<Map<String,Object>>> before=new LinkedHashMap<>();
		for(String table:List.of("work_session","page_visit","analysis_window","window_visit","analysis_result","notification","alert_candidate_task","notification_response"))before.put(table,normalize(jdbc.queryForList("select * from "+table)));
		var flyway=Flyway.configure().dataSource(ds).target("11").load();assertThat(flyway.migrate().migrationsExecuted).isEqualTo(1);
		before.forEach((table,rows) -> {
			String columns=String.join(",",rows.getFirst().keySet());
			assertThat(normalize(jdbc.queryForList("select "+columns+" from "+table))).containsExactlyInAnyOrderElementsOf(rows);
		});
		assertThat(jdbc.queryForObject("select collection_spec_version from work_session where session_id=?",String.class,session.toString())).isEqualTo("1.0");
		assertThat(jdbc.queryForObject("select api_contract_version from analysis_result where analysis_id=?",Integer.class,analysis.toString())).isEqualTo(1);
		assertThat(flyway.migrate().migrationsExecuted).isZero();flyway.validate();
		assertThatThrownBy(() -> jdbc.update("insert into analysis_outbox(analysis_id,session_id,privacy_revision,processing_status,requested_at) values (?,?,0,'PENDING',CURRENT_TIMESTAMP)",UUID.randomUUID().toString(),session.toString())).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		jdbc.update("insert into analysis_outbox(analysis_id,session_id,privacy_revision,processing_status,requested_at) values (?,?,0,'PENDING',CURRENT_TIMESTAMP)",analysis.toString(),session.toString());
		assertThatThrownBy(() -> jdbc.update("insert into analysis_outbox(analysis_id,session_id,privacy_revision,processing_status,requested_at) values (?,?,0,'PENDING',CURRENT_TIMESTAMP)",analysis.toString(),session.toString())).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		String hash="a".repeat(64);
		jdbc.update("insert into window_state_history(window_id,state_version,analysis_id,rule_version,judged_at,final_state,behavior_snapshot,input_fingerprint) values (?,1,?,'synthetic',CURRENT_TIMESTAMP,'NORMAL','[]',?)",window.toString(),analysis.toString(),hash);
		assertThatThrownBy(() -> jdbc.update("insert into window_state_history(window_id,state_version,analysis_id,rule_version,judged_at,final_state,behavior_snapshot,input_fingerprint) values (?,2,?,'synthetic',CURRENT_TIMESTAMP,'NORMAL','[]',?)",window.toString(),analysis.toString(),hash)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		assertThatThrownBy(() -> jdbc.update("insert into window_state_history(window_id,state_version,analysis_id,rule_version,judged_at,final_state,behavior_snapshot,input_fingerprint) values (?,1,?,'synthetic',CURRENT_TIMESTAMP,'NORMAL','[]',?)",window.toString(),analysis.toString(),"b".repeat(64))).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		UUID otherWindow=UUID.randomUUID(),otherAnalysis=UUID.randomUUID();
		jdbc.update("insert into analysis_window(window_id,session_id,window_index,window_size,start_visit_id,end_visit_id,created_at) values (?,?,2,5,?,?,CURRENT_TIMESTAMP)",otherWindow.toString(),session.toString(),ids.getFirst().toString(),ids.get(3).toString());
		jdbc.update("insert into analysis_result(analysis_id,window_id,processing_status,requested_at) values (?,?,'COMPLETED',CURRENT_TIMESTAMP)",otherAnalysis.toString(),otherWindow.toString());
		assertThatThrownBy(() -> jdbc.update("insert into window_state_history(window_id,state_version,analysis_id,rule_version,judged_at,final_state,behavior_snapshot,input_fingerprint) values (?,2,?,'synthetic',CURRENT_TIMESTAMP,'NORMAL','[]',?)",window.toString(),otherAnalysis.toString(),"c".repeat(64))).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		UUID compose=UUID.randomUUID();
		jdbc.update("insert into compose_request(compose_request_id,session_id,active_session_id,after_sequence,composed_through_sequence,privacy_revision,input_fingerprint,input_snapshot,processing_status,requested_at) values (?,?,?,0,5,0,?,'{}','PENDING',CURRENT_TIMESTAMP)",compose.toString(),session.toString(),session.toString(),hash);
		assertThatThrownBy(() -> jdbc.update("insert into compose_request(compose_request_id,session_id,active_session_id,after_sequence,composed_through_sequence,privacy_revision,input_fingerprint,input_snapshot,processing_status,requested_at) values (?,?,?,0,5,0,?,'{}','PENDING',CURRENT_TIMESTAMP)",UUID.randomUUID().toString(),session.toString(),session.toString(),hash)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);

	}
	List<Map<String,Object>> normalize(List<Map<String,Object>> rows) {
		rows.forEach(row -> row.replaceAll((k,v) -> v instanceof byte[] bytes ? HexFormat.of().formatHex(bytes) : v));
		return rows;
	}

}
