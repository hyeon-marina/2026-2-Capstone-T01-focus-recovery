# 수집 관리 API — Issue #97

기존 v2 수집/분석/회수 Wire와 별도인 운영 메타데이터 DTO다. `v2.schema.json`·Fixture는 변경하지 않는다. 모든 경로는 `/api/collection` 아래이며 #95의 Bearer/TLS Filter를 그대로 통과한다. Cookie/participantId/sessionId만으로 인증하지 않는다. 모든 응답은 `Cache-Control: no-store`다.

## 관리자 경계

`/admin/**`는 설정 `focus-recovery.collection.administration-enabled=true` **및** 현재 DB의 `collection_operator` 역할·미폐기 Credential·ACTIVE 참여자가 모두 필요하다. 기본 설정false, 역할/Token Seed0건, 역할 부여 HTTP API0건이다. 신뢰된 OS/DB 관리자의 non-web bootstrap만 최초 역할을 만든다. 정책 승인/수집 활성화 권한을 부여하지 않는다. 미인증401/권한부족403/입력400/상태충돌409이며 공통 오류는 `{code,message,fieldErrors}`다.

| Method / admin 경로 | 요청 | 성공 응답 |
| --- | --- | --- |
| POST `/participants` | `{identityReferenceHash,evidenceRef}` | 200 `{participantId}`. 같은 해시 등록 replay는 같은 주체 |
| POST `/participants/{participant}/credentials` | `{expiresAt,evidenceRef}` | 200 `{credentialId,participantId,credential,expiresAt}`. 평문1회, 이전Credential 원자 폐기 |
| POST `/credentials/{hash}/revoke` | `{evidenceRef}` | 204 |
| POST `/plan/initialize` | 빈 본문/`{}` | 200 Plan. 초기 DRAFT20/배정160/슬롯3 |
| GET `/plan` | 없음 | 200 Plan |
| PUT `/plan` | Plan | 200 revision+1의 Plan |
| GET `/progress` | 없음 | 200 Progress. 조회 감사 기록 |
| POST `/attempts/{attempt}/review` | `{status,reasonCode,evidenceRef}` | 204. status=FAILED/RECOLLECT_REQUIRED |
| GET `/audit` | 없음 | 200 최근500 감사 행. 조회 자체도 감사 |

`identityReferenceHash`는 별도 신뢰된 연결표 참조의64자 소문자 SHA-256이다. 실명/연락처/Token을 넣지 않는다. `evidenceRef`/authorityRef는1~255자의 원문 없는 참조 식별자(`[A-Za-z0-9:/._#-]`, 첫자영숫자)다. 서버가 기관 위임의 실제 존재를 자동 증명하지 않는다. 그 증거는 운영 책임자가 별도로 검증해야 한다.

Credential은 SecureRandom32bytes의URL-safe base64, DB에는 SHA-256만 저장한다. `credentialId`는 폐기·감사용 해시 식별자이고 인증 Token이 아니다. TTL은 현재부터 최대24시간의 기술 한도다. 철회/비활성 참여자에게 발급하지 않는다. API 응답/운영 콘솔·proxy의 body logging을 켜면 평문이 노출될 수 있으므로 발급 응답 로그를 금지한다.

## 배정·시도·출처

Plan:

- `revision`: 서버 낙관적 잠금값.
- `goals[20]`: `{goalId,description,status,evidenceRef}`. description=null은 미확정, CONFIRMED는5~150자 원문·근거가 필요하다.
- `assignments[160]`: `{plannedSessionId,goalId,scenarioType,repetition,slotId}`. 네유형×2회, 전체중복없음.
- `slots[3]`: `{slotId,participantId}`. A/B/C, 초기participantId=null. 동일 참여자 중복 슬롯 금지.

PLAN/goal/type/repetition은 고정 식별자다. 관리자는 미시작 배정의 slot만 수정할 수 있다. 실제 시도가 있으면 해당 목표·배정·슬롯의 참여자는 변경할 수 없다. 기존 시도는 삭제하지 않는다. stale revision은 `PLAN_REVISION_CONFLICT`, 실적변경은 `PLAN_HAS_ACTUALS`다.

Attempt는 기존 `work_session`과 원자적으로 연결하고 `(session_id,participant_id)` 복합 FK로 귀속을 확인한다. 기존 Wire에 source나scenario를 추가하지 않는다. 서버가 현재 Gate·정책을 확인하여 source를 결정하며 현재는 SYNTHETIC만 생성한다. PARTICIPANT source는 활성화 경로가 없다. GPT/Mock/카탈로그 세션을 실제 160세션 실적에 포함할 수 없다.

## 참여자 경계

| Method / 경로 | 요청 | 성공 응답 |
| --- | --- | --- |
| GET `/assignments` | 없음 | 본인 `{plannedSessionId,goalId,goalText,goalStatus,scenarioType}[]` |
| POST `/assignments/{plannedId}/start` | `{}`, `Idempotency-Key`1~255 URL-safe문자 | 201 기존 WorkSessionResponse |
| GET `/progress` | 없음 | 본인 범위 Progress |
| GET `/attempts/current?workSession=<UUID>` | 없음 | 200 본인의 `{attemptId}`. 타인/없음404 |
| POST `/attempts/{attempt}/failures` | `{failureId,reasonCode,observedAt}` | 204. 같은ID/같은원본 replay, 충돌409 |
| POST `/attempts/{attempt}/delivered` | `{visitCount,lastSequence}` | 204. 본인의 CLEAR·ENDED 세션만 |

start는 서버 참여자 잠금 → 배정표 잠금 → 본인 배정/목표 확정/현재 동의 검사 → 기존 세션 생성 순서로 직렬화한다. `assignment:PLAN:key`로 기존 소유권 서비스의 멱등키를 분리한다. 동일 키의 다른 배정은409, 다른 사람 배정은404, 미확정 목표는409다. 미종료 또는 미검토 시도가 있으면 중복 수행을 막는다. 재수집은 기존 ENDED 시도의 검토 사유를 남긴 후 새 키를 사용한다. APPROVED 정책을 DB에 넣거나 환경 flag를 켜도 실제 PARTICIPANT 수집은 차단된다.

Failure는 v4/variant2 UUID, UTC 밀리초 시각, 고정 Enum `EXTRACTION_FAILED/SHORT_DURATION/POLICY`만 받는다. 페이지 본문·URL·검색어·임의 오류 원문은 받지 않는다. 개인정보 격리/철회 후 신규 진단 저장도 차단한다. 클라이언트는 ACK 전에 제외 후보를 정리하지 않으며 재시작 시 같은 ID를 재사용한다.

Delivered는 클라이언트의 종료 ACK 후 전송 영수증이다. 서버 행 수와 마지막 sequence를 독립 비교한다. 이 보고만으로 품질 완료를 만들지 않으며 부분 전송·다른 소유자·격리 세션은 통과하지 않는다.

## Progress 의미

최상위는 `planned,actualSessions,endedSessions,completed,syntheticSessions,syntheticQualityPassed,inProgress,failed,recollectRequired,quarantined,validVisits,validWindows,extractionFailures,analysisSuccess,analysisFailure,attempts,participants,goals,scenarios,actualCollectionBlocked`다.

전체 집계는 실제 source만 대상으로 한다. 중복 재시도는 PLAN별 최신 시도로 상태를 분류하고, `completed`는 고유 PLAN의 품질 통과 수다. 원래 시도와 실패 사유·실제 sessionId는 attempts에 계속 남는다. `validVisits/validWindows`는 품질을 통과한 최신 실제 시도만 포함한다. 분석 성공/실패·추출 실패 진단과 모든 원시 시도별 품질 수는 별도로 확인한다. 합성은 별도 두 카운터와 source로 표시한다.

`Quality={validVisits,expectedWindows,validWindows,analysisSuccess,analysisFailure,referencesValid,reasons[]}`이며 최소10 Visit·n−2 Window·ordered size3/stride1·참조·완료 AI·최신 dirty 아닌 상태 이력을 검사한다. 종료+품질+전송 확인+CLEAR+검토 상태로 `IN_PROGRESS/QUALITY_PASSED/FAILED/RECOLLECT_REQUIRED/QUARANTINED`를 판정한다. 개인정보 격리를 최우선한다. 사람 라벨·모델 품질·실제 운영 승인 판정은 아니다.

진행률은 고정 개수의 메타데이터 쿼리로 조회한다. 제목/본문/검색어/URL/rationale/Token을 응답하지 않는다. 관리 API가 다른 사용자에게 통계 권한을 부여하지 않으며 관리자에게 민감 원문을 보여주는 경로도 추가하지 않았다.


## #99 실제 사이트 배포

`GET /api/collection/site-policy`: 인증 필요. `{digest,buildId,policyId,policyVersion,status,expiresAt,sites:[{origin,pathPrefix}],metadataOnly}` 또는409 COLLECTION_POLICY_BLOCKED. `POST assignments/{plannedId}/start`의 실수집 경로는 X-Collection-Build를 추가 검증하고 현재 승인 동의·독립 DB release·정책 digest를 session scope에 묶습니다. SYNTHETIC 정책으로 PARTICIPANT 실적을 만들지 않으며 APPROVED 문자열만으로 exact-test를 운영으로 바꾸지 않습니다. `Progress.actualCollectionBlocked`는 배포/서버 구성 상태이며 실제 참여자 동의·파일럿·기관 승인 사실을 대신하지 않습니다. 후보 설명을 병합하는 prepare-plan.py는 CONFIRMED로 바꾸지 않습니다.


## #101 원본 품질·독립 로컬·Export API

기존 DTO 필드를 제거하지 않고 `Attempt.rawQuality={validVisits,theoreticalWindows,referencesValid,reasons}`, `rawStatus`, `analysisState=NOT_RUN/INCOMPLETE/COMPLETED`, `analysisWindowCount`를 추가합니다. rawStatus는 QUARANTINED/FAILED/RECOLLECT_REQUIRED/IN_PROGRESS/RAW_COLLECTED입니다. 원본 정상 종료·10유효 Visit·ID/sequence·서버 저장/전송 보고·현재 동의·privacy로 판정하며 AI를 요구하지 않습니다. 기존 QUALITY_PASSED/Progress.completed/quality는 기존 AI 포함 의미 그대로입니다.

Progress.raw는 `{completed,syntheticCompleted,validVisits,theoreticalWindows,generatedWindows,analysisCompletedWindows,participants,goals,scenarios}`입니다. 실제 source의 PLAN별 최신 Attempt를 집계하고 합성은 syntheticCompleted로 분리합니다. 배정 수정은 기존 잠금 검사를 유지하며 A54/B53/C53 분포를 깨뜨리면400입니다. delivered는 본인 확인 후 참여자 잠금과 현재 동의도 확인합니다.

| Method / 경로 | 권한·응답 |
| --- | --- |
| POST `/api/collection/exports` | 인증된 본인의 snapshot `{manifest,files}`. 현재 수집 Gate/동의 필요 |
| POST `/api/collection/admin/exports/{participant}` | 기존 현재 운영자 역할과 대상 동의/Gate 필요 |
| GET `/api/collection/admin/export-privacy/{participant}` | 기존 현재 운영자 역할. 철회 후에도 원문 없는 `{sourceInstanceId,participantId,observedAt,withdrawn,validConsentId,sessions,tombstones}` |

모든 API는 기존 TLS·Bearer Filter와 no-store를 사용합니다. Export는 REPEATABLE_READ + 참여자 잠금/감사이며 raw 본문을 응답하므로 proxy/body logging 금지입니다. privacy endpoint는 승인 Artifact 만료/철회 이후에도 운영자의 회수 확인을 위해 조회할 수 있습니다. snapshot JSON은 wire/실행용 포맷이며 전달용은 CLI가 `focus-raw-export/1` JSONL/Manifest/체크섬을 만들고 age로 암호화합니다. [실제 포맷·검증·통합](../data-collection/merge-guide.md)을 따릅니다.

`individual-local`은 real-collection과 동일한 승인 검증을 적용하는 정확한 단일 프로필이고 AI Dispatcher만 기본 false입니다. deploymentConfigured는 원본 저장 승인 경계이며 dispatch 활성화를 요구하지 않습니다. 실제 승인/동의·사이트는 이번 구현에서 생성하지 않았습니다.


## #103 individual-local 오프라인 소유자와 본인 API

정확한 단일 individual-local·non-web·loopback MySQL/focus_collection·로컬 TLS에서만 LocalCollectionSetup이 동작한다. HTTP 등록/역할 부여 API는 추가하지 않는다. V18의 단일 소유자 key hash/slot/participant와 OS owner-only 파일을 함께 확인한다. 운영자 역할을 만들지 않으며 이 Profile의 administration-enabled 기본값은 false다.

- `GET /api/auth/me`: `localMode` boolean 추가. 다른 모드는 false. 기존 필드 유지.
- `GET /api/collection/local-status`: individual-local 본인만. `{slot,policyDigest,blockers[],details,ready}`. details는 보존/민감 페이지/본문/검색어/변경/개시 범위이며 토큰/타인 정보 없음.
- `POST /api/collection/attempts/{attempt}/recollect`: individual-local 본인 소유의 ENDED·CLEAR 시도만. `{reasonCode: INSUFFICIENT_VISITS|DELIVERY_FAILED|USER_REQUEST}`, 204. 동의·소유자 잠금, 사유/감사·원래 시도 보존. 활성/타인/격리404. real-collection에는 이 경로 없음.
- `GET /api/collection/export-privacy`: 본인만, 기존 privacy DTO. 철회 후에도 조회 가능. 기존 `/admin/export-privacy/{participant}`는 운영자 검사를 유지.

`focus-local-policy/1` RAW_ONLY와 CONFIRMED 상태·실제 팀 근거/기관 판단·적용 기간·원문 정책·HTTPS 사이트·공통 확정 Plan을 검사한다. 원본에는 modelEvidenceRef를 요구하지 않는다. 전체 파일의 별도 신뢰 SHA-256 + 정렬 compact UTF-8 Plan checksum을 검증하고 DB Release를 설치한다. 내부 session_collection_scope와 빌드 digest 검증은 그대로다. 같은 policyId/version의 다른 bytes는 거절하며 변경 시 새 버전·재빌드·재동의가 필요하다. 기존 real-collection Artifact/독립 Release/AI 증거 계약은 변경하지 않는다.

blockers: LOCAL_SETUP_REQUIRED, LOCAL_POLICY_MISSING, LOCAL_POLICY_DRAFT, LOCAL_POLICY_EXPIRED, LOCAL_POLICY_MISMATCH, GOAL_UNCONFIRMED, CONSENT_REQUIRED, PRIVACY_WITHDRAWN. 인증 없음/만료/폐기는 기존401을 유지하며 존재 여부를 노출하지 않는다. Chrome은 네트워크와 TLS 실패를 동일 TypeError로 받을 수 있어 `status`와 인증서 확인을 함께 안내한다.

## #105 로컬 원본 메타데이터의 필드 의미

`focus-local-policy/1`의 site-policy 응답은 `metadataOnly=true`다. Extension은 동일 정책 bytes/build의 원문 URL을 허용 범위/민감정보 검사 후 세션별 HMAC 식별자로 대체한다. 저장·POST·Export의 normalizedUrl은 실제 접근 URL이 아닌 `origin + 승인 prefix(끝 / 제거) + /__focus_page__/ + 64hex`이며 Query/Fragment/인증정보를 포함하지 않는다. Backend는 exact origin/prefix·현재 Build/Session scope·식별자 형식을 다시 검증하며 원래 URL이나 HMAC 비밀키를 받지 않는다.

기존 v2/`focus-raw-export/1` 필드와 JSON Schema는 유지한다. title은 제한된 `Topic: ...` 분류, content는 `METADATA_ONLY: public browsing activity; page text, title and search terms were not collected.` 고정 표식, 검색 페이지의 searchQuery는 `[NOT_COLLECTED]`이고 나머지는 null이다. `extractionStatus=SUCCESS`는 이 모드의 메타데이터 생성 성공이며 본문/검색어 원문을 추출했다는 뜻이 아니다. Backend는 이 고정 tuple 밖의 원제목/본문/검색어를 거절한다. 과거 정책 Export·AI 활성 경로의 원문 필드 의미와 구분한다.

본문/검색결과/블로그 글·영상/자막/댓글/추천·입력값은 전송하지 않는다. 공개 페이지 제목은 로컬에서 고정 주제로 분류 후 폐기한다. `metadataOnly=false`인 기존 독립 real-collection Artifact/AI 활성/합성 계약은 보존한다. 현재 팀 정책은 DRAFT로 실제 수집은 계속 차단된다. [상세 정책](../data-collection/real-collection-policy.md)과 [검증](../data-collection/issue105-validation.md)을 참조한다.
