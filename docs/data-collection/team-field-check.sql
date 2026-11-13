-- Field verification only: read-only metadata, never page text, URL, search query or credential.
SET TRANSACTION READ ONLY;
START TRANSACTION WITH CONSISTENT SNAPSHOT;
SELECT 'work_session' AS table_name, COUNT(*) AS row_count FROM work_session
UNION ALL SELECT 'collection_attempt', COUNT(*) FROM collection_attempt
UNION ALL SELECT 'page_visit', COUNT(*) FROM page_visit
UNION ALL SELECT 'consent_record', COUNT(*) FROM consent_record
UNION ALL SELECT 'consent_event', COUNT(*) FROM consent_event
UNION ALL SELECT 'consent_withdrawal', COUNT(*) FROM consent_withdrawal
UNION ALL SELECT 'privacy_retraction', COUNT(*) FROM privacy_retraction
UNION ALL SELECT 'visit_tombstone', COUNT(*) FROM visit_tombstone;
SELECT i.source_instance_id,o.slot_id,o.participant_id,o.policy_digest,p.revision,
 (SELECT COUNT(*) FROM collection_assignment a WHERE a.slot_id=o.slot_id) AS my_assignments
FROM collection_source_instance i CROSS JOIN collection_local_owner o CROSS JOIN collection_plan p
WHERE i.instance_key=1 AND o.owner_key=1 AND p.plan_id=1;
SELECT consent_id,participant_id,policy_id,policy_version,accepted_at,withdrawn_at
FROM consent_record ORDER BY accepted_at,consent_id;
SELECT event_id,consent_id,event_type,occurred_at FROM consent_event ORDER BY occurred_at,event_id;
SELECT s.session_id,s.owner_participant_id,s.consent_id,s.started_at,s.ended_at,s.status,s.privacy_status,s.privacy_revision,
 t.attempt_id,t.planned_session_id,t.created_at,t.review_status,t.reason_code,t.delivered_visit_count,t.delivered_through_sequence,
 COUNT(v.visit_id) AS stored_visits,COUNT(DISTINCT v.visit_id) AS distinct_visits,
 COUNT(DISTINCT v.sequence) AS distinct_sequences,MIN(v.sequence) AS first_sequence,MAX(v.sequence) AS last_sequence,
 SUM(CASE WHEN v.active_duration_ms>=5000 AND v.extraction_status='SUCCESS'
 AND v.title IS NOT NULL AND CHAR_LENGTH(v.title)>0 AND v.content IS NOT NULL AND CHAR_LENGTH(v.content)>0
 AND NOT EXISTS(SELECT 1 FROM visit_tombstone x WHERE x.session_id=v.session_id AND x.visit_id=v.visit_id)
 THEN 1 ELSE 0 END) AS valid_visits
FROM work_session s JOIN collection_attempt t ON t.session_id=s.session_id
LEFT JOIN page_visit v ON v.session_id=s.session_id
GROUP BY s.session_id,t.attempt_id ORDER BY s.started_at,t.created_at,t.attempt_id;
SELECT session_id,sequence,active_duration_ms,extraction_status FROM page_visit ORDER BY session_id,sequence;
SELECT session_id,sequence,COUNT(*) AS duplicates FROM page_visit GROUP BY session_id,sequence HAVING COUNT(*)>1;
COMMIT;
