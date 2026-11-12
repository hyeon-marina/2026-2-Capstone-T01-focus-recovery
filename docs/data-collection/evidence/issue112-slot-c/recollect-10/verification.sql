
SET TRANSACTION READ ONLY;
START TRANSACTION WITH CONSISTENT SNAPSHOT;
SELECT o.slot_id AS slot,LEFT(i.source_instance_id,8) AS source_prefix,p.revision,COUNT(a.planned_session_id) AS assignments
FROM collection_local_owner o JOIN collection_source_instance i ON i.instance_key=1 JOIN collection_plan p ON p.plan_id=1 JOIN collection_assignment a ON a.slot_id=o.slot_id GROUP BY o.slot_id,i.source_instance_id,p.revision;
SELECT LEFT(s.session_id,8) AS session_prefix,LEFT(t.attempt_id,8) AS attempt_prefix,t.planned_session_id AS plan,s.status,s.privacy_status AS privacy,t.review_status AS review,t.reason_code AS reason,
t.delivered_visit_count AS delivered,t.delivered_through_sequence AS through_seq,COUNT(v.visit_id) AS stored_visits,COUNT(DISTINCT v.visit_id) AS unique_ids,COUNT(DISTINCT v.sequence) AS unique_seq,MIN(v.active_duration_ms) AS min_ms
FROM work_session s JOIN collection_attempt t ON t.session_id=s.session_id LEFT JOIN page_visit v ON v.session_id=s.session_id GROUP BY s.session_id,t.attempt_id ORDER BY s.started_at;
SELECT LEFT(s.session_id,8) AS session_prefix,s.started_at AS started_utc,s.ended_at AS ended_utc,s.privacy_revision FROM work_session s ORDER BY s.started_at;
SELECT LEFT(v.session_id,8) AS session_prefix,v.sequence,v.domain,v.active_duration_ms AS active_ms,v.extraction_status AS extraction,CHAR_LENGTH(v.title) AS title_len,CHAR_LENGTH(v.content) AS content_len
FROM page_visit v JOIN work_session s ON s.session_id=v.session_id ORDER BY s.started_at,v.sequence;
SELECT (SELECT COUNT(*) FROM work_session) AS sessions,(SELECT COUNT(*) FROM page_visit) AS visits,(SELECT COUNT(*) FROM collection_attempt) AS attempts,
(SELECT COUNT(*) FROM consent_record) AS consents,(SELECT COUNT(*) FROM consent_event) AS consent_events,(SELECT COUNT(*) FROM consent_withdrawal) AS withdrawals,
(SELECT COUNT(*) FROM privacy_retraction) AS retractions,(SELECT COUNT(*) FROM visit_tombstone) AS tombstones,(SELECT COUNT(*) FROM analysis_window) AS ai_windows;
SELECT action,COUNT(*) AS events FROM collection_audit WHERE action='LOCAL_RECOLLECT' GROUP BY action;
COMMIT;
