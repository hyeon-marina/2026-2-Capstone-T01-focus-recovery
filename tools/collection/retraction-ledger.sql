-- Export separately from backups; protect and retain the newest ledger until restore validation.
-- Metadata only. No content, query, credential, name, or identity-reference hash.
SELECT JSON_OBJECT(
 'participants',COALESCE((SELECT JSON_ARRAYAGG(participant_id) FROM participant WHERE withdrawn_at IS NOT NULL),JSON_ARRAY()),
 'sessions',COALESCE((SELECT JSON_ARRAYAGG(session_id) FROM work_session WHERE privacy_status<>'CLEAR'),JSON_ARRAY()),
 'retractions',COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('retraction_id',retraction_id,'session_id',session_id,'visit_id',visit_id,'reason_code',reason_code,'observed_at',DATE_FORMAT(observed_at,'%Y-%m-%d %H:%i:%s.%f'),'requested_at',DATE_FORMAT(requested_at,'%Y-%m-%d %H:%i:%s.%f'),'input_fingerprint',input_fingerprint,'prerequisites',prerequisites)) FROM privacy_retraction),JSON_ARRAY())
) AS ledger;
