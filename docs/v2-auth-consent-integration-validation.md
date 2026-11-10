# v2 인증·동의·소유권 및 운영 전 통합 검증 — Issue #95

**P1~P6 PROPOSED / P2 조기 전송·P6 실사용자 처리 BLOCKED. 운영 배포·운영 DB 접근·실사용자 수집·실제 모델 추론을 수행하지 않았다. QUARANTINED는 전체 삭제 완료가 아니다.**

## 1. 작업 전 Git과 요구사항

시작은 수정/미추적 파일 없는 detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`이었다. origin은 개인 Fork, upstream은 공식 저장소였다. 기존 Worktree/브랜치는 보존했다. 공식 원격 main을 직접 다시 조회·fetch한 결과는 `2c7a9bcf0bdf247f7111772569ba9fdcc3ecccfb`였다. 이 SHA에서 `feat/95/v2-auth-consent-integration`을 만들었다. main 직접 Commit/Push, reset/clean/강제 Push를 하지 않았다.

Issue #95 본문/댓글0, 선행 #79/#81/#83/#85/#87/#89/#91/#93와 병합된 PR #86/#88/#90/#92/#94를 확인했다. 작업 범위는 인증·세션 소유권·동의 영속화·전체 철회를 실제 수집/분석/표시 경계에 연결하는 것이다. 문서만으로 완료하지 않는다. 저장소 내부 AGENTS.md는 없었고 상위 `.codex/AGENTS.md`는 빈 파일이었다. PR 템플릿을 사용한다.

기준 명세·계약·Schema/Fixture, FE 수집/BE–AI/#93 회수 검증 보고, 실제 Controller/Service/Repository/Worker와 V1~V13을 대조했다. 5,000ms 유효화, 4,000ms 미만 재개, 최초300,000ms와 이탈·종료 PATCH, size3/stride1, 페이지 판단 AI/최종 판단 BE를 바꾸지 않았다.

## 2. 기존 인증·소유권 문제

기존 WorkSession에는 사용자 FK가 없었고 일반 세션 API는 sessionId만 받았다. #93 제품 회수 권한은 기본401이며 test 소스에만 Basic/임시 소유권 표가 있었다. FE v2는 synthetic-test entry, BE storage/dispatch는 기본false+정확한 test 프로필이었다. AI 회수 Route는 테스트 fixture만 설치했고 전체 삭제 증거가 없어 PURGED 전이가 없었다.

이 제한을 임의로 해결된 것으로 보지 않았다. 실제 사용자 등록·기관의 신뢰된 인증 발급 절차는 아직 연결되지 않았다. 이번 구현은 제품 코드의 **검증 가능한 서버 인증 경계와 실제 영속 모델**이며, 합성 테스트 자격정보로 그 경계를 실행했다.

## 3. 선택한 인증과 운영 미완료 경계

| 선택지 | 이 프로젝트에서의 판단 |
| --- | --- |
| Cookie 서버 Session | 기존 로그인/웹 호스트가 없고 Extension 흐름에 Cookie·CSRF·Origin 정책을 추가로 설계해야 함 |
| OIDC Authorization Code + PKCE | 승인된 issuer/client/redirect 등록이 준비되면 적합한 후속 연결 후보. 없는 Credential을 만들지 않음 |
| JWT | 현재 필요한 즉시 폐기·서버 확인에는 별도 상태가 필요하며 서명키/issuer 운영을 추가할 근거가 없음 |
| 불투명 Bearer + 서버 해시 저장 | 기존 JDBC/JPA로 검증·만료·폐기·소유권 연결 가능. 이를 구현하고 발급/등록은 외부 신뢰 경계로 닫아 둠 |

자격정보는 고엔트로피 임의 값이어야 한다. 합성 테스트는 SecureRandom 32바이트 또는 명시적으로 표시한 테스트 전용 값만 사용한다. 제품에는 발급/회원가입/비밀번호/임시 사용자 생성 Endpoint, 기본 Secret, 승인 정책 Seed가 없다. DB에는 SHA-256 해시만 저장한다. 인증 실패·위조·만료·폐기 시401이며 사용자 ID/UUID/sessionId/Cookie fallback이 없다. HTTPS를 요구하고 정확한 test+loopback HTTP만 예외다. 운영 issuer/enrollment·안전한 전달·회전·재인증 UX는 미완료다.

## 4. 사용자·참여자와 세션 소유권

`participant`는 가명 UUID, 고유한 외부 인증 참조 해시, 상태·생성/철회 시각만 둔다. `access_credential`은 해시→참여자 FK·만료/폐기를 분리한다. 원래 인증 제공자의 이름·이메일·실제 연구 참여자 연결표는 분석 Payload에 복제하지 않는다. 인증 참조 해시는 익명화 증명이 아니며 외부 신뢰된 등록과 관리 책임자를 대체하지 않는다.

새 세션에는 서버가 검증한 `owner_participant_id`, `consent_id`를 기록한다. 두 FK와 복합 FK/쌍 CHECK로 동의 주체 일치를 보강한다. 기존 행은 두 값 NULL 그대로이며 누구에게도 이관하지 않는다. 인증된 사용자도 해당 legacy 행은404다. 세션 생성 멱등 키는 주체별 SHA-256(owner:key)로 분리하여 다른 사용자의 목표/세션이 Replay되지 않는다.

## 5. API 접근 제어

공통 Filter는 데이터 없는 health/정적 API 문서를 제외한 요청을 인증하고, MVC Interceptor는 실제 매핑된 sessionId 변수로 DB 소유권을 검사한다. 잘못된 UUID는400, 타인/소유자 없음/미존재는 동일404다. 생성·조회·종료·Visit POST/PATCH/목록·분석 상태/목록/상세·Window 이력·알림 후보/이력/ACK/선택·개별 회수·동의/전체 철회가 대상이다.

Visit/Window/Analysis/Alert 소속도 서비스에서 확인한다. 다른 세션 visitId 재사용은 원문 충돌409 대신404로 숨긴다. ENDED도 소유권을 우회하지 않는다. HTTP 주체가 있는 서비스 호출은 주체/현재 credential의 DB 관계를 재확인한다. 비동기 작업은 세션의 영속 소유자·동의와 그 주체의 유효한 서버 Credential 존재를 확인한다. 사용자 Token을 작업 Snapshot이나 AI로 보내지 않는다.

별도 DTO/실패/멱등 계약은 [인증·동의 API](contracts/auth-consent-api.md)를 따른다. 기존 공통 Schema/Fixture는 바꾸지 않았다.

## 6. 동의 정책·동의 기록

정책은 ID/버전/적용 범위/목적/항목/이용 범위/보존·삭제 참조/승인 참조/상태/시작 시각을 저장한다. `DRAFT/SYNTHETIC/APPROVED/RETIRED`를 구분한다. 합성은 test 단일 프로필에서만 허용한다. APPROVED라도 참조가 빠지면 무효이며 실제 승인 정책은 삽입하지 않았다. 최신 정책의 초안/퇴역 또는 동일 시작 시각의 모호성은 fail-closed다. 최신 정책을 퇴역시켜도 과거 정책/동의를 자동 재활성화하지 않는다.

서버 인증 주체·정책 버전·명시적 accepted=true·서버 시각·requestId·철회 시각을 영속화한다. 같은 요청 Replay와 같은 정책의 중복 동의를 구분하고 첫 consentId/일시를 보존한다. `consent_event`에 수락/철회 이력을 남긴다. 클라이언트 주체 지정/추가/중복 JSON 필드를 거절한다. 정책 변경은 재동의를 요구하며 이미 바인딩한 세션의 동의를 자동 교체하지 않는다. 실제 동의 기록을 마이그레이션하거나 만들어 넣지 않았다.

## 7. 수집·분석·조회 Gate

새 세션 생성은 참여자 잠금에서 현재 동의를 확인한다. POST/PATCH, AI 구성/분석 Claim·결과 Commit, 상태 판단/결과·이력 조회, 후보 생성/조회·표시 ACK/선택은 세션 잠금과 소유권·현재 동의·격리 검사를 사용한다. AI Claim/새 결과 Commit은 ACTIVE도 요구한다. 종료 후 기존 최종 행동의 DB 재판단/소유자의 조회는 유지하며 새 AI 작업은 실행하지 않는다.

철회는 privacyRevision과 기존 Claim Token/Lease 검사를 재사용한다. 진행 중 HTTP 응답이 돌아와도 철회된 세션은 Commit하지 못한다. 원본 Replay보다 Tombstone/격리가 우선한다. 민감 콘텐츠 회수의 상태 조회는 기존 INVALIDATED/no-result projection을 유지하고, 참여자 동의 철회 후에는 분석 상태 자체도403으로 차단한다.

기존 storage/dispatch 기본false, 정확한 단일 test 프로필 제약을 제거하지 않았다. 합성 정책/동의/신뢰된 자격정보도 필요하므로 환경변수만으로 준비되지 않은 실제 사용자 수집을 열 수 없다.

## 8. FE 화면·인증·IndexedDB

별도 synthetic harness에 인증 필요/만료·정책 내용·목적/항목·미승인 보존 참조·명시적 체크·서버 동의·전체 철회/처리 상태·네트워크 오류를 표시한다. 합성 화면임을 명확히 표기하고 DRAFT를 실제 개인정보 처리방침으로 제시하지 않는다. 정책 내용은 React 텍스트로 렌더링한다. production v1 Popup 흐름에는 운영 등록/수집 비활성 안내만 추가했다. 제품 v2 수집 Entry는 만들지 않았다.

Token은 `chrome.storage.session`의 TRUSTED_CONTEXTS에만 저장하며 IndexedDB/local/sync·URL·알림·상태 응답에 넣지 않는다. Worker 재시작 시 서버를 다시 확인하고 브라우저 재시작/확장 Reload 후 재인증한다. 이는 [Chrome 공식 Storage 설명](https://developer.chrome.com/docs/extensions/reference/api/storage#storage-areas) 및 실제 브라우저 재시작 테스트와 일치한다.

v2 aggregate는 가명 owner/consent ID를 additive 저장한다. 기존 ownerless aggregate는 현재 사용자에게 귀속하지 않는다. 다른 계정은 기존 POST/PATCH/END/알림/회수 Queue를 보낼 수 없다. 인증 불확실 구간의 관측은 닫고 시간을 가산하지 않는다. 재인증 후 새 보호 관측에서 다시 시작한다. 인증 오류와 네트워크 오류를 구분하고 원본/END_PENDING/회수 요청을 보존한다.

이미 완료·drain된 세션만 기존 aggregate를 archive한 후 다른 계정의 새 세션을 만들 수 있다. 미완료 다른 계정 Queue는 보존·차단한다. 인증 주체가 다른 기존 owner의 전체 철회 의사를 대신 만들 수도 없다. 전체 철회 의사는 마지막 서버 검증 주체/credential 세대가 일치할 때만 로컬 영속화하고 실제 전송은 다시 인증한다. 이미 검증된 동일 주체의 offline 철회는 HTTP 전에 Queue를 남긴다.

## 9. 참여자 전체 철회와 #93 연결

인증 주체별 단일 부모 요청과 동의 철회 이력을 먼저 영속화한다. 참여자 잠금이 생성/동의/철회를 직렬화하고, 모든 소유 세션을 UUID 순서로 잠가 ACTIVE/ENDED/빈 세션도 즉시 격리한다. 새 POST·분석 Commit·표시와 경합하면 먼저 완료된 사실만 보존한 채 철회 후 새 처리는 막는다.

세션별 PENDING Inventory는 재시작 후 다시 찾는다. 안정된 Visit 목록을 열거해 결정적인 자식 회수 UUID v4와 `withdrawal_retraction` FK로 기존 #93 작업에 연결한다. Window/분석/Outbox/구성/미표시 알림은 무효화한다. 방문이 없는 세션에 가짜 visitId를 만들지 않는다. v1도 접근/늦은 분석은 차단하되 Payload 처리는 명시적으로 BLOCKED/검토 필요다.

Inventory 실패는 rollback·고정 코드/시도수로 기록하고 재처리한다. #93 작업별 Claim/Lease/Retry·삭제/AI 증거와 Tombstone을 재사용한다. AI/합성 삭제 실행은 여전히 제품 기본false이며 테스트 소스의 명시적 합성 정책만 허용한다. 일부 대상 실패/재시작/외부 미확인은 격리를 해제하지 않는다. 부모와 UI는 PURGED를 반환하지 않는다.

MySQL REPEATABLE READ 경합에서 철회가 먼저 만든 Snapshot이 직전 ACK의 shownAt을 null로 덮어쓰는 문제를 발견했다. 회수 대상 Window/분석/구성/Outbox/미표시 알림 조회를 세션 잠금 하의 최신 잠금 읽기로 수정했다. H2/MySQL에서 각각 반복 경합으로 ACK 사실 보존·철회 후 ACK 차단을 검사한다. 테스트를 완화하지 않았다.

## 10. V14 Migration

V1~V13 원문은 불변이다. V14는 participant/access_credential/consent_policy/consent_record/consent_event/consent_withdrawal/withdrawal_session/withdrawal_retraction 및 nullable 세션 FK/인덱스·UNIQUE·CHECK만 추가한다. 기존 ID/FK/내용·legacy 키는 유지한다. NULL 소유권이나 없는 동의를 backfill하지 않는다.

빈 DB의 V1~V14·Hibernate validate, V10→11→12→13→14의 실제 합성 행/PK/FK 보존, 재migrate0/validate, 타 주체의 consentId FK 거절을 H2/실제 MySQL에서 검증한다. MySQL CHECK 위반은 JDBC의 분류가 H2와 달라 정확한 제약 이름도 검사한다. H2 직접 연결 종료 시 CHECK 캐시 문제는 제품 연결 수명과 같은 열린 테스트 연결로 검증한다. 운영 DB에는 적용하지 않았다.

## 11. 보존·삭제 Inventory

| 대상/실제 위치 | 소유·관리 역할 | 적용/방법/증거와 미충족 |
| --- | --- | --- |
| BE MySQL work_session/page_visit·새 참여자/동의 표 | BE·등록 관리자 | 소유권/격리, #93 합성 Payload UPDATE 후 잔존 검사. 원본 행·FK·가명/감사 메타는 보존. 운영 보존기간 없음 |
| 구성 Snapshot/분석/상태 이력/알림 | BE | 부모 철회 즉시 무효화, 합성 삭제 대상과 증거 연결. ACK/선택 사실 유지. 전체 보안 소거 아님 |
| FE IndexedDB state/v2/v2-receipts/이전 session archive | FE·브라우저 사용자 | owner/동의 연계와 drain 차단, 원본 보존. 안전 폐기·보존기간·사용자 확인 절차 미구현, CLIENT_LOCAL_COPIES 미완료 |
| Extension session Credential | FE·인증 관리자 | 메모리성 trusted session 저장, 로그아웃/브라우저 재시작 제거. 다른 탐색 원문의 보존 정책을 대신하지 않음 |
| AI V2Service Registry/embedding LRU | AI | SQLite Journal/revision/generation, 결과 저장 전 재검사·로컬 무효화. 전 Worker 즉각 물리 삭제/GPU 메모리 소거 미검증 |
| AI Journal, BE 부모/자식/Tombstone/증거 메타 | BE·AI·정책 책임자 | 요청/실패/재시작 추적. 승인된 최소 감사 범위·보존기간 없음, 임의 삭제 안 함 |
| ai/data sessions/windows JSONL·입력 zip·Export/수신자 사본 | 데이터/연구 담당 | 제품 Export/완전한 사본 대장 없음. 위치·수신자와 삭제 확인 전 BLOCKED |
| ai/artifacts/context_cache.jsonl, classifier joblib/report | AI·학습 담당 | 완전한 Visit→학습/가중치 lineage·재학습/폐기 증거 없음. 기존 Artifact 변경/학습 안 함 |
| ai/models/saved_models, 배포 모델 볼륨 | AI·운영 | 이번 환경 실제 가중치 없음. 모델 영향 제거를 증명하지 않음 |
| 서버/클라이언트 로그·외부 복사본 | 운영·데이터 담당 | 새 Token/인증 오류 원문은 기록하지 않음. 과거 사본 탐색/삭제는 미검증 |
| MySQL 볼륨·백업/복원 | 운영·백업 담당 | 운영 접근 안 함. 최신 Tombstone 재적용·복원 후 차단 도구/훈련/삭제 증거 없음 |

승인된 보존기간은 어느 운영 대상에도 확정하지 않았다. 정책 참조와 작업 증거 구조만 추가했으며 보존기간 기반 자동 삭제 Scheduler는 없다. 기술 Retry/Lease 시간은 데이터 보존기간이 아니다. 모든 영향 범위를 확인하지 못해 항상 QUARANTINED다.

## 12. 운영 활성화 선결

| 선결 조건 | 현재 판정 |
| --- | --- |
| 인증 경계·DB 소유권·API 접근 통제 | 합성 기술 검증, 운영 issuer/enrollment 미연결 |
| 승인된 동의서·참여자의 실제 동의 | 미충족, 합성 정책/테스트 기록만 사용 |
| 보존기간·삭제/최소 감사 정책 | 미충족 |
| 전체 철회·회수 | 합성 v2 격리·전파/실패 복구 검증. FE/외부/v1 Payload 전체 처리 미완료 |
| Export·학습·모델·로그·백업 영향 | 미충족 |
| 학교·기관 절차·연구심의 적용/비적용 판단 근거 | 확인되지 않음. 임의 판단하지 않음 |
| 운영 승인 기록 | 없음 |
| 실제 Chrome/FE–BE–AI | 합성 실제 HTTP 검증. 실제 모델/실제 참여자 검증 아님 |
| 운영 모니터링·장애 대응·TLS/Secret 배포/교체 훈련 | 운영 환경 검증 미충족 |

프로필/flag만으로 승인 상태를 만들거나 UI로 운영 수집을 열지 않는다. PR 병합도 승인 근거가 아니다.

## 13. 실행 환경·명령

macOS arm64, Node25.9.0, Vite7.3.7/Vitest3.2.7, Gradle9.7.1, Java21 toolchain/Temurin25 launcher, Spring Boot4.1.1, Python3.11 테스트 venv, H2 MySQL mode, 새 `focus95-mysql-synthetic` MySQL8.4.9 loopback3393, Chrome for Testing151.0.7922.34. 기존 운영/다른 컨테이너는 사용하지 않았다.

```sh
npm ci --prefix fe
npm --prefix fe test -- --reporter=dot
npm --prefix fe run build
npm --prefix fe run build:synthetic
/private/tmp/focus87-ai/bin/python -m pytest ai/tests -q --tb=short
/private/tmp/focus87-ai/bin/python docs/contracts/v2/validate.py
/private/tmp/focus87-ai/bin/python ai/smoke_v2.py
# 새 합성 컨테이너/Schema만 사용; 운영·기존 볼륨을 연결하지 않는다.
docker run --name focus95-mysql-synthetic --detach \
  --publish 127.0.0.1:3393:3306 --env MYSQL_ROOT_PASSWORD=synthetic-test-only \
  --env MYSQL_DATABASE=focus95_finish mysql:8.4
# 컨테이너 준비 후 focus85_95finish/focus89_95finish/focus93_95finish도 생성
AI_V2_PROFILE=synthetic-test AI_V2_ENABLED=1 \
AI_V2_SERVICE_TOKEN=synthetic-internal-service-token-95-0123456789 \
/private/tmp/focus87-ai/bin/python be/src/test/python/v2_http_fixture.py \
  --port 8895 --retraction-journal /private/tmp/focus95-ai-journal.sqlite \
  --retraction-secret synthetic-service-only-secret-93-0123456789 --fail-first-retraction
# 별도 셸: 같은 fixture를 8893, 별도 Journal에서 실행(#89/#93 회귀)
# be 디렉터리, 각 URL은 이번 합성 컨테이너의 새 Schema를 지정
CHROMIUM_PATH='<Chrome for Testing executable>' \
FOCUS85_MYSQL_URL='jdbc:mysql://127.0.0.1:3393/focus85_95finish?serverTimezone=UTC' \
FOCUS89_MYSQL_URL='jdbc:mysql://127.0.0.1:3393/focus89_95finish?serverTimezone=UTC' \
FOCUS93_MYSQL_URL='jdbc:mysql://127.0.0.1:3393/focus93_95finish?serverTimezone=UTC' \
FOCUS95_MYSQL_URL='jdbc:mysql://127.0.0.1:3393/focus95_finish?serverTimezone=UTC' \
FOCUS89_AI_URL=http://127.0.0.1:8893 FOCUS93_AI_URL=http://127.0.0.1:8893 \
FOCUS95_AI_URL=http://127.0.0.1:8895 ./gradlew test bootJar --console=plain
# 독립 Chrome/Mock HTTP 및 기존 v1 Chrome 회귀, 루트 디렉터리
CHROMIUM_PATH='<Chrome executable>' npm --prefix fe run test:v2:browser
CHROMIUM_PATH='<Chrome executable>' npm --prefix fe run test:browser
/private/tmp/focus87-ai/bin/python be/src/test/python/validate_http_evidence.py
/private/tmp/focus87-ai/bin/python be/src/test/python/validate_retraction_evidence.py \
  /private/tmp/focus95-chrome-evidence/retractions.json
/private/tmp/focus87-ai/bin/python be/src/test/python/validate_auth_consent_evidence.py
git diff --check
```

`test` 밖에서는 신규 합성 정책을 쓸 수 없다. 실제 Token/운영 DB URL을 위 예시에 넣어 시험하지 않는다. 환경이 없는 MySQL/실제 HTTP 테스트는 JUnit 조건에 따라 skip되므로 기본 실행의 통과와 전체 통합 실행을 혼동하지 않는다.

## 14. 결과·Mock/실제 구분

| 검증 | 결과 | 범위 |
| --- | --- | --- |
| FE 전체 Unit | 901 passed / 외부 HTTP2 skipped | 기존886 포함, fake-indexeddb·Mock transport |
| FE typecheck / production·synthetic build | PASS | 제품 v1과 별도 v2 진입점 |
| AI 전체 | 241 passed, deprecation 경고1 | 기존233+서비스 인증8, Mock 모델 |
| BE 전체 | 996건, 실패0/오류0/skip0 | H2/MySQL·실제 HTTP·Chrome 포함 |
| 실제 Chrome + Mock HTTP | PASS | 실제 인증/체크 UI·알림 렌더/ACK·Worker/브라우저·IDB·회수 Replay |
| 실제 Chrome → 계측 proxy → Spring/H2 → FastAPI | PASS | 응답 Mock 없음. 인증·동의·5개 방문/Window·종료·전체 철회/AI 격리 |
| FE Runtime → Spring/H2 → FastAPI | PASS | fake-indexeddb/가상 시계, NORMAL→300000ms PATCH→DRIFT/상태 이력·알림 ACK/선택·종료·다중 세션 철회·ACK 유실/재시작 |
| 기존 #89/#93 실제 HTTP | PASS | 새 인증을 통과하는 실제 서버 회귀 |
| 실제 MySQL Migration·보안/경합 | PASS | V1~V14, FK·기존 행·반복 경합 |
| 공통 계약 | Schema30/80사례/reference139/규칙216/κ4, 문서10/링크204 PASS | Schema/Fixture 원문 불변 |
| 실제 Qwen 추론 | SKIPPED | torch/transformers/sentence-transformers·가중치 없음, modelLoaded=false/inferenceExecuted=false |

실제 Chrome 실행에서 네이티브 Extension/IndexedDB를 사용했다. 계측 proxy는 Authorization과 실제 JSON 요청/응답을 전달한다. Node Runtime 테스트의 5분 경계는 가상 시계이며 실제300초 대기 실측이 아니다. FastAPI 구성/Schema/Registry/PageAnalysisModel 경로는 실제 코드지만 Embedding/Context는 FakeEmbedding/FakeContext다. 모델 성능·품질·GPU 메모리 삭제를 검증하지 않았다.

실제 HTTP 증거는 `/private/tmp/focus95-http-evidence/flow.json`, Chrome 증거/화면은 `/private/tmp/focus95-chrome-http-evidence`, 독립 Mock Chrome은 `/private/tmp/focus95-chrome-evidence`, 전체 JUnit 보존본은 `/private/tmp/focus95-complete-junit`, 최신 실행 결과는 `be/build/test-results/test`다. 로그는 `/private/tmp/focus95-*`다. 합성 증거를 실제 개인정보 삭제 증빙으로 제출하지 않는다.

## 15. 실패·수정과 회귀

첫 BE 실행은 기존 무인증 Fixture 전제 때문에 실패했다. 인증을 비활성화하는 대신 실제 토큰 해시/정책/동의/세션 소유권을 만드는 명시적 test Fixture로 바꿨다. #93의 임시 Basic 권한 대체는 제거하고 제품 인증을 통과한다. 새 보안 테스트에는 기본 인증 Header Fixture가 없다. 기존 검증 로직을 통과시키기 위한 삭제/skip은 하지 않았다. 의도적으로 바뀐 인증401·타인404·주체별 키 해시 기대만 새 계약에 맞췄다.

새 테스트의 UUID/밀리초 입력·정책 이력 FK 정리·H2 연결 수명·MySQL CHECK 예외 분류와 실제 MySQL Snapshot/ACK 소실을 발견해 수정했다. FE는 인증/HTTP 오류의 기존 타입을 유지하고 서버401을 별도로 차단하며, 계정 불일치가 다른 주체의 철회 의사를 만들지 못하게 했다. 원본 보존/격리/검증 조건을 완화하지 않았다. 인증 로그 캡처로 실제 애플리케이션 로그의 Token/해시 부재도 H2/MySQL에서 검사했다. Chrome 통합은 이전 Window 완료와 최신 Visit의 미처리 구성을 혼동하지 않도록 마지막 Window index와 종료 후 최종 행동 재판단 완료를 함께 기다린다.

v1의 기존 수집/분석/알림 계약과 v2 수집·구성·상태·회수 테스트를 실행한다. v1 Chrome은 합성 Mock HTTP 회귀 PASS이며 운영 로그인 검증이 아니다. headless에서 네이티브 다중 창/최소화1건은 명시 skip이다. 회수용 잠금 읽기는 별도 Repository 메서드로 두어 기존 일반 조회의 트랜잭션 요구를 바꾸지 않았다. 공통 Schema/Fixture와 V1~V13 바이트 보존을 별도 검사한다.

## 16. 미구현·미검증 및 후속

운영 인증 issuer/enrollment·신뢰된 참여자 연결과 재인증/회전 UX, 실제 동의서/기관/보존·삭제/감사 정책, 실제 참여자 동의는 미완료다. 실제 사용자 계정을 만들어 수집하지 않았다. 다른 계정의 미완료 로컬 aggregate는 보존·차단하며 임의 이동/삭제 UI를 만들지 않았다.

FE 원문 안전 폐기, v1 Payload 회수/AI v1 캐시 전파, 다중 호스트 AI 조정·모든 Worker/메모리/GPU·학습/가중치 영향, 수신자/Export/로그/백업 삭제·복원 후 Tombstone 재적용, 실제 모델 품질/성능, OS kill/디스크 full/실 MySQL daemon 재시작, 네이티브 다중 플랫폼 동작은 별도 후속이다. 일부 #93 작업이 VERIFIED여도 이 범위를 완료로 간주하지 않는다.

## 17. Commit·Fork·PR

한국어 Commit으로 요청 브랜치에만 기록하고 개인 Fork origin에 일반 Push한다. 공식 main 대상 PR은 저장소 템플릿과 요청 제목을 사용한다. 자동 Merge하지 않는다. 자기 자신의 SHA를 보고서에 넣어 재귀 Commit을 만들지 않으며 확정 SHA/Push/PR URL은 최종 채팅 보고 및 PR head가 기준이다. 권한 문제 시 Compare URL/본문을 제공한다.

## 18. 변경 파일 전체

- `ai/main.py`
- `ai/tests/conftest.py`
- `ai/tests/test_v2_authorization.py`
- `ai/v2/authorization.py`
- `be/src/main/java/com/focusrecovery/domain/alert/repository/NotificationRepository.java`
- `be/src/main/java/com/focusrecovery/domain/alert/service/AlertService.java`
- `be/src/main/java/com/focusrecovery/domain/alert/service/V2AlertService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/client/V2AiClient.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/repository/AnalysisOutboxRepository.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/repository/AnalysisResultRepository.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisExecutor.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisQueryService.java`
- `be/src/main/java/com/focusrecovery/domain/analysis/service/V2AnalysisOutboxService.java`
- `be/src/main/java/com/focusrecovery/domain/composition/repository/ComposeRequestRepository.java`
- `be/src/main/java/com/focusrecovery/domain/composition/service/CompositionService.java`
- `be/src/main/java/com/focusrecovery/domain/consent/ConsentController.java`
- `be/src/main/java/com/focusrecovery/domain/consent/ConsentService.java`
- `be/src/main/java/com/focusrecovery/domain/consent/OwnedSessionService.java`
- `be/src/main/java/com/focusrecovery/domain/consent/WithdrawalDispatcher.java`
- `be/src/main/java/com/focusrecovery/domain/consent/WithdrawalService.java`
- `be/src/main/java/com/focusrecovery/domain/identity/AccessDenied.java`
- `be/src/main/java/com/focusrecovery/domain/identity/AuthenticatedParticipant.java`
- `be/src/main/java/com/focusrecovery/domain/identity/AuthenticationController.java`
- `be/src/main/java/com/focusrecovery/domain/identity/AuthenticationFilter.java`
- `be/src/main/java/com/focusrecovery/domain/identity/AuthenticationService.java`
- `be/src/main/java/com/focusrecovery/domain/identity/IdentitySecurityConfiguration.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/PrivacyRetractionService.java`
- `be/src/main/java/com/focusrecovery/domain/privacy/service/RetractionAuthorization.java`
- `be/src/main/java/com/focusrecovery/domain/session/entity/WorkSession.java`
- `be/src/main/java/com/focusrecovery/domain/session/service/WorkSessionService.java`
- `be/src/main/java/com/focusrecovery/domain/visit/service/PageVisitService.java`
- `be/src/main/java/com/focusrecovery/domain/window/repository/AnalysisWindowRepository.java`
- `be/src/main/java/com/focusrecovery/global/config/V2StorageGate.java`
- `be/src/main/java/com/focusrecovery/global/exception/GlobalExceptionHandler.java`
- `be/src/main/resources/application.properties`
- `be/src/main/resources/db/migration/V14__identity_consent_withdrawal.sql`
- `be/src/test/java/com/focusrecovery/domain/alert/AiAlertCandidateTest.java`
- `be/src/test/java/com/focusrecovery/domain/alert/AlertDisplayTest.java`
- `be/src/test/java/com/focusrecovery/domain/alert/AlertHistoryApiTest.java`
- `be/src/test/java/com/focusrecovery/domain/alert/AlertTaskRecoveryTest.java`
- `be/src/test/java/com/focusrecovery/domain/alert/FixedIntervalAlertTest.java`
- `be/src/test/java/com/focusrecovery/domain/analysis/AnalysisIntegrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/analysis/AnalysisQueryApiTest.java`
- `be/src/test/java/com/focusrecovery/domain/analysis/AnalysisRecoveryTest.java`
- `be/src/test/java/com/focusrecovery/domain/identity/AuthConsentLiveHttpTest.java`
- `be/src/test/java/com/focusrecovery/domain/identity/AuthConsentMySqlTest.java`
- `be/src/test/java/com/focusrecovery/domain/identity/AuthConsentTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2AiClientTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2DispatcherRestartTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2FixedIntervalTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2IntegrationContract.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2IntegrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2LiveHttpTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2MySqlIntegrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2RetractionContract.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2RetractionMySqlTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2RetractionTest.java`
- `be/src/test/java/com/focusrecovery/domain/privacy/RetractionLiveHttpTest.java`
- `be/src/test/java/com/focusrecovery/domain/privacy/RetractionRestartTest.java`
- `be/src/test/java/com/focusrecovery/domain/privacy/SyntheticRetractionConfiguration.java`
- `be/src/test/java/com/focusrecovery/domain/session/WorkSessionApiTest.java`
- `be/src/test/java/com/focusrecovery/domain/session/WorkSessionEndApiTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V13MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V14MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2DisabledTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2GateAndFingerprintTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2MySqlStorageTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2RestartTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2StorageContract.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2StorageTest.java`
- `be/src/test/java/com/focusrecovery/domain/visit/PageVisitApiTest.java`
- `be/src/test/java/com/focusrecovery/domain/window/AnalysisWindowTest.java`
- `be/src/test/java/com/focusrecovery/global/config/OpenApiDocsTest.java`
- `be/src/test/java/com/focusrecovery/global/health/HealthControllerTest.java`
- `be/src/test/java/com/focusrecovery/support/MockV2AiServer.java`
- `be/src/test/java/com/focusrecovery/support/SyntheticAuthenticated.java`
- `be/src/test/java/com/focusrecovery/support/SyntheticIdentities.java`
- `be/src/test/java/com/focusrecovery/support/SyntheticIdentityConfiguration.java`
- `be/src/test/java/com/focusrecovery/support/SyntheticIdentityListener.java`
- `be/src/test/python/v2_http_fixture.py`
- `be/src/test/python/validate_auth_consent_evidence.py`
- `be/src/test/python/validate_retraction_evidence.py`
- `be/src/test/resources/application-test.properties`
- `docs/ai-spec.md`
- `docs/be-spec.md`
- `docs/contracts/auth-consent-api.md`
- `docs/contracts/v2/README.md`
- `docs/data-analysis-contract.md`
- `docs/data-collection-spec.md`
- `docs/data-contract-validation.md`
- `docs/fe-spec.md`
- `docs/v2-auth-consent-integration-validation.md`
- `docs/v2-contract-approval.md`
- `docs/v2-contract-decisions.md`
- `fe/scripts/v2-browser-test.mjs`
- `fe/src/api/auth-fetch.ts`
- `fe/src/api/behavior.ts`
- `fe/src/api/client.ts`
- `fe/src/api/session-end.ts`
- `fe/src/api/visit.ts`
- `fe/src/popup/index.tsx`
- `fe/src/v2/AuthConsentPanel.tsx`
- `fe/src/v2/access.css`
- `fe/src/v2/access.ts`
- `fe/src/v2/notifications.ts`
- `fe/src/v2/repository.ts`
- `fe/src/v2/retractions.ts`
- `fe/src/v2/runtime.ts`
- `fe/src/v2/state.ts`
- `fe/src/v2/status.ts`
- `fe/synthetic/background.ts`
- `fe/synthetic/harness.tsx`
- `fe/tests/v2-access.test.ts`
- `fe/tests/v2-auth-http.test.ts`
- `fe/tests/v2-fixture.ts`
- `fe/tests/v2-retraction-http.test.ts`
- `fe/tests/v2-runtime.test.ts`
