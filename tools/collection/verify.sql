-- Read-only metadata. No URL, title, content, query, identity mapping or credential output.
SELECT COUNT(*) AS participants, SUM(withdrawn_at IS NOT NULL) AS withdrawn FROM participant;
SELECT t.source,t.participant_id,COUNT(*) AS started,SUM(s.status='ENDED') AS ended,
 SUM(s.privacy_status<>'CLEAR') AS quarantined
 FROM collection_attempt t JOIN work_session s ON s.session_id=t.session_id GROUP BY t.source,t.participant_id;
SELECT t.source,v.session_id,COUNT(*) AS visits,MIN(v.sequence) AS first_sequence,MAX(v.sequence) AS last_sequence,
 SUM(v.active_duration_ms>=5000 AND v.extraction_status='SUCCESS') AS valid_visits,
 COUNT(DISTINCT v.visit_id) AS distinct_ids,COUNT(DISTINCT v.sequence) AS distinct_sequences
 FROM page_visit v JOIN collection_attempt t ON t.session_id=v.session_id GROUP BY t.source,v.session_id;
SELECT t.source,w.session_id,COUNT(*) AS windows,SUM(w.window_size=3) AS size_three,
 SUM(w.invalidated) AS invalidated,SUM(w.decision_dirty) AS pending_decisions
 FROM analysis_window w JOIN collection_attempt t ON t.session_id=w.session_id GROUP BY t.source,w.session_id;
SELECT w.session_id,a.processing_status,COUNT(*) AS analyses FROM analysis_result a JOIN analysis_window w ON w.window_id=a.window_id GROUP BY w.session_id,a.processing_status;
SELECT w.session_id,COUNT(*) AS state_versions FROM window_state_history h JOIN analysis_window w ON w.window_id=h.window_id GROUP BY w.session_id;
SELECT t.source,f.reason_code,COUNT(*) AS failures FROM collection_failure f JOIN collection_attempt t ON t.attempt_id=f.attempt_id GROUP BY t.source,f.reason_code;
SELECT processing_status,COUNT(*) AS targets FROM retraction_target GROUP BY processing_status;
SELECT COUNT(*) AS tombstones FROM visit_tombstone;
SELECT policy_digest,build_id,revoked_at IS NOT NULL AS revoked FROM collection_release;
-- These must return no rows for CLEAR sessions.
SELECT v.session_id,v.sequence,COUNT(*) AS duplicate_sequence FROM page_visit v JOIN work_session s ON s.session_id=v.session_id WHERE s.privacy_status='CLEAR' GROUP BY v.session_id,v.sequence HAVING COUNT(*)>1;
SELECT w.window_id,COUNT(m.visit_id) AS members FROM analysis_window w LEFT JOIN window_visit m ON m.window_id=w.window_id WHERE w.window_size=3 AND NOT w.invalidated GROUP BY w.window_id HAVING COUNT(m.visit_id)<>3;
