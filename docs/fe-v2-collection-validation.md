# FE v2 수집·영속화 검증 — Issue #91

## 1. Git 기준과 범위

2026-11-10 KST. 시작은 detached HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`, tracked 수정/미추적 파일 0이었다. origin은 개인 Fork `hyeon-marina/2026-2-Capstone-T01-focus-recovery`, upstream은 공식 `SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery`다. 실제 fetch 및 ls-remote로 확인한 최신 공식 main은 `3f6e7d75d1a490b7515cc941828c295249a4c8ab`이며 여기서 `feat/91/fe-v2-collection-durability`를 생성했다. 기존 worktree·브랜치를 삭제하지 않았다.

#91 본문/댓글0, #89 본문/댓글0, 병합된 PR #90 및 실제 BE 코드를 확인했다. 별도 AGENTS/CONTRIBUTING/Git 가이드는 없었다. 프로젝트 계획 §GitHub의 develop 통합 설명보다 사용자가 지정한 공식 main 대상 PR을 따른다. PR 템플릿과 기존 한국어 `feat(#번호): ...` 커밋 형식을 따른다.

BE/AI 제품 코드와 Flyway 파일, 공통 Schema·Fixture는 변경하지 않았다. 기존 Migration은 합성 H2 서버 시작 시에만 적용됐다. 운영 DB·실사용자 방문·학습·모델 다운로드·전체 삭제·운영 활성화는 수행하지 않았다. **P1~P6 PROPOSED, P2/P6 BLOCKED를 유지한다.**

## 2. 요구사항과 기존 FE

v1 `Collector`는 후보를 먼저 만들고 활성 체류 1,000ms에서 valid로 바꾸지만, 후보 종료와 strict finalized-prefix를 통과한 뒤 sequence를 부여한다. Reload/탭 복귀는 기존 방문을 유지한다. `MAX_CANDIDATES=200`이면 중지한다. 이 기준은 이번 변경에서 유지했다.

기존 background는 직렬 실행기에서 상태를 바꾸고 `DurableRepository`의 aggregate Revision CAS로 저장한다. 실패하면 마지막 committed 복사본으로 복원하고 수집/HTTP를 중지한다. POST 원본은 `VisitDelivery`, POST ACK 이후 행동은 `BehaviorDelivery`, ACK drain 이후 종료는 `SessionEndDelivery`가 담당한다. Sending/ACK/동결 재시도·END_PENDING은 이미 구현되어 있었다. Content Script는 허용된 사이트에만 등록되며 원본 URL 보호·DOM 제외·Google/Naver 유기 결과·Unicode 길이를 검사한다. 권한 철회 시 v1의 기존 로컬 삭제 동작도 변경하지 않았다.

실제 main의 FE popup은 수집/전송/복구 UI다. BE에는 고정 주기·AI 알림·표시 ACK·선택이 있으나 기존 FE에 완성된 알림 표시 UI/HTTP client는 없었다. v1에 존재하지 않은 UI를 보존했다고 주장하지 않는다. 이번에는 별도 합성 harness의 최소 React 알림과 v2 상태 어댑터/표시·선택 영수증을 추가했다.

## 3. v1/v2 분리와 활성화 Gate

- production `vite.config.ts`/기존 popup·background·content 진입점은 v1이다. `VITE_V2_ENABLED=true` 같은 설정으로 v2를 추가할 수 없다.
- `vite.synthetic.config.ts`는 정확히 `synthetic-test` mode에서만 실행된다. API는 명시 포트가 있는 HTTP localhost/127.0.0.1 origin만 허용한다. Worker도 별도 빌드 상수와 loopback을 다시 검사한다. 기본 manifest는 변경하지 않았다.
- 합성 확장은 `127.0.0.1:8911/__focus_synthetic__/a~d`만 관측한다. 실제 DOM을 기존 추출기로 검사하고 고정 catalog와 내용/제목이 일치해야 한다. 전송은 catalog의 문자열만 사용하며, 임의 페이지 원문은 Worker에 보내지 않는다. URL이 먼저 바뀌고 이전 catalog 콘텐츠가 남으면 새 콘텐츠까지 기다린다. 알 수 없는 실제 내용·민감 DOM/권한 철회는 격리한다.
- 신규 v2 시작은 `{goalText, collectionSpecVersion:'2.0'}`와 영속 Idempotency-Key를 사용한다. START_PENDING에서 목표·버전·API origin을 고정한다. 응답이 v1이면 활성화하지 않으며 같은 키를 보존한다. 기존 버전 없는 세션은 v1 parser로만 수용한다.
- v2 종료 후 새 세션은 새 키/번호1로 시작하며, 이전 종료 aggregate를 같은 트랜잭션에서 `v2/session/{sessionId}`로 보존한다. 세션 중 버전/소속 변경은 거절한다.

이 구조는 운영 활성화 절차가 아니다. loopback에서 운영으로 프록시를 연결해 우회하는 사용을 승인하지 않는다. 제공 E2E의 프록시는 이 작업에서 직접 시작한 test/H2 BE로만 전달하는 계측기다.

## 4. 방문·콘텐츠·복귀

`src/v2/collector.ts`는 별도 후보/sequence 정책이다. 원본 보호·권한·DOM·본문/검색어 검증을 통과한 관측의 활성 누적이 5,000ms 이상일 때만 POST를 동결한다. 4,999ms는 POST가 없다. 일반 본문50~5000/검색 본문1~5000 code points, 검색어·유기 결과 조건을 검사한다. wire에는 `extractionStatus=SUCCESS`가 필수다. 추출실패·짧은 방문·정책 제외는 정상 POST로 바꾸지 않는다.

session/tabKey/원본 대상 hash/document generation/content generation/left/returned를 구분한다. 최초 left는 중복 이벤트로 바꾸지 않는다. 같은 세대의 복귀가 3,999ms면 같은 ID/누적, 4,000ms면 새 ID/0부터 측정한다. A→B→A도 최근 후보에서 해당 대상의 이탈 시각을 사용한다. 다른 탭·문서·콘텐츠 세대는 분리한다. Reload는 새 Chrome document generation이므로 보수적으로 새 방문이다. Worker 재시작도 증명할 수 없는 4초 간격을 합치지 않는다.

navigation/activation의 관측 Stamp를 추출 결과와 따로 보존한다. sender document/frame/lifecycle, 실제 현재 URL, navigation revision을 검사하여 이전 문서·route의 늦은 결과를 버린다. 원본 URL query는 URL 정규화 전에 기존 검사/검색어 추출이 수행된다. hash route는 별도 target hash에 포함한다. 같은 URL의 catalog 주요 본문 교체도 별도 콘텐츠 세대로 분리한다.

POST 뒤 title/content/query/visitedAt/sequence는 변경하지 않는다. 새 방문에 같은 검증된 콘텐츠를 사용할 수 있지만 ID/sequence를 재사용하지 않는다. 캐시 대용 성공 snapshot/catalog를 사용해도 매 관측의 실제 권한·원본 URL·DOM·콘텐츠 일치를 다시 확인한다. Content Script는 추출 전에 Worker의 수집 허용 상태를 조회하고 종료/격리/저장 실패이면 관측 timer와 추출을 중지한다. 새 세션 시작 때만 허용 fixture에 재활성화를 보낸다. 일반 사용자 사이트를 대상으로 하는 범용 v2 수집 진입점/캐시 활성화는 제공하지 않는다.

## 5. 활성시간·탭 전환

Worker마다 epoch와 `performance.now()`를 사용한다. wall은 최초 UTC 감사시각과 시계 불연속 검출용이다. 소수 ms 잔여를 보존하고 정수 ms만 floor한다. 같은 Stamp/중복 foreground는 이중 가산하지 않는다. 탭·창 이탈 시 cursor를 중지한다. 탭 전환은 onActivated의 실제 선택 이벤트를 이전 방문에 한 번 귀속하며 제외 대상 탭으로 이동해도 유지한다. 동일 탭 탐색·앱 포커스 이동은 탭 전환으로 세지 않는다.

합성 구현은 1초 보호 관측, 최대1,500ms 관측 간격, wall/mono 차이100ms 초과 또는 역행을 불연속으로 취급한다. 이 값은 **합성 실험 설정이며 P1/P3 승인값이 아니다**. 긴 이벤트 공백/절전·새 epoch는 소급 가산하지 않는다. 이를 모든 OS에서의 무오차/연속 활성 증명이라고 주장하지 않는다. 새 epoch에서는 기존 후보를 닫고 새 관측부터 새 방문으로 시작한다.

## 6. IndexedDB·Migration·sequence

DB `focus-recovery`를 version1→2로 additive upgrade한다. 기존 `state/current` format1/v1 값은 수정하지 않는다. `v2/current` format2와 `v2-receipts`만 추가한다. v1 저장기의 versionchange/실패 보호를 유지한다. 기존 테스트의 DB1 고정 reader만 현재 버전을 열도록 바꾸었고, unsupported-version 테스트는 DB_VERSION+1을 사용한다. v1 수집/전송 기대값은 바꾸지 않았다.

v2 상태에는 규격/세션/생명주기/시작 원본/nextSequence/후보·관측 세대/원본 POST/최신 행동/대기 PATCH/Sending·ACK/종료 요청·Receipt/격리·알림 영수증/revision이 있다. 단일 직렬 Writer가 유효화를 처리하고 revision CAS 트랜잭션이 nextSequence·visitId·sequence·POST snapshot을 함께 저장한다. transaction.complete 후에만 공개 committed 상태와 HTTP 가능 상태를 갱신한다. request.success는 Commit이 아니다.

먼저 시작했지만 추출이 늦은 A보다 B가 먼저 유효화되면 B가 작은 sequence를 받는다. 이미5초 측정한 A의 추출이 비활성 상태에서 늦게 완료되는 경우는 복귀 이벤트가 아니며, 동일 문서/대상/콘텐츠 세대를 재검증한 뒤 원래 A의 ID/visitedAt/측정값으로 뒤 sequence를 Commit한다. 4초 캐시가 만료됐다고 이 원본 후보를 버리지 않는다. visitedAt은 최초 대상 관측 시각이다. 중복 유효화는 같은 후보의 frozen POST를 재사용한다. abort는 번호/원본을 확정하지 않는다. 저장된 번호는 불변이고 sparse sequence는 허용한다. 다른 Worker의 오래된 revision과 이미 저장된 원본 변경·sequence 역행·종료/격리 되돌리기는 거절한다. 손상 상태를 임의 수정하지 않는다.

## 7. POST/PATCH·5분·재전송

기존 두 Delivery를 그대로 사용한다. POST 저장→Sending Commit→HTTP→응답 원본/행동 검증→ACK Commit 순서다. 다음 POST는 이전 ACK 뒤, PATCH는 해당 방문의 영속 POST ACK 뒤다. HTTP/ACK Commit 실패에서 원본을 삭제하지 않는다. ID·sequence·본문·행동 재시도 snapshot/version을 바꾸지 않는다. 자동 시도3회·1/2초 backoff는 기존 정책이며 alarm wake가 소진 예산을 자동 초기화하지 않는다. 수동 retry만 예산을 갱신한다.

매 관측에서 최신 누적 행동은 저장하지만 HTTP PATCH 대상은 최초 old<300000<=new, 이탈/탭 전환/종료다. 299,999와300,000을 구분한다. 매초 PATCH하지 않는다. POST가 이미5분 이상이면 첫 POST에 실제 누적을 담는다. 같은 snapshot 재시도는 같은 behaviorVersion이고, 실제 카운터 변경만 버전을 증가시킨다. 서버 최신 ACK는 기존 coversBehavior 규칙으로 검사하며 상충하면 값을 지어내지 않는다. FE가 AI 구성/분석/최종 판단을 호출하거나 다시 계산하지 않는다.

## 8. Compaction·Quota

최근 복귀 후보와 미확인 큐는 hot aggregate에 둔다. closed/복귀 간격 만료/POST ACK/PATCH ACK/최신 행동 포함/회수 없음인 완료 prefix만 정리한다. 원문 해시·visitId/sequence·POST/행동 ACK를 `v2-receipts`에 넣고 원문 제거와 watermark/count를 같은 트랜잭션으로 저장한다. 시작 번호를 되감지 않는다. 재시작 때 영수증 수·중복번호·최대번호·형식·ACK 포함관계를 검증한다. 영수증이 유실되면 성공을 합성하지 않고 손상으로 중지한다.

진행 중 후보, 미전송/미확인 POST/PATCH, 재시도 snapshot, 필요한 복귀 정보, END_PENDING, 격리/종료 영수증은 정리하지 않는다. POST 없는 제외/5초 미만 종료 후보는 건수 진단으로 정리한다. 5초 이상 측정했지만 추출을 기다리는 후보는 복귀 캐시 만료만으로 삭제하지 않는다. 200은 미정리 hot 후보의 backpressure 한도이며 세션 평생 한도가 아니다. 새 관측 전에 완료 자료를 정리하며 해결되지 않으면 마지막 committed 원본을 유지하고 수집/외부 전송을 중지한다. Quota/IDB 오류도 같은 fail-closed다. Fake IDB에서205개 방문과 완료 정리·재시작을 검사했다. 실제 디스크를 가득 채우는 테스트는 하지 않았다.

## 9. END_PENDING·개인정보

종료 intent는 queued 작업보다 먼저 신규 관측/알림을 차단한다. 마지막 행동을 동결하고 END_PENDING을 저장한다. 필수 POST/PATCH ACK가 durable하게 확인된 다음 `{}` END 요청을 동결하고 기존 종료 전송기를 사용한다. ENDED 원본 응답/첫 endedAt을 검증·저장한 뒤 생명주기가 ENDED가 된다. 활성 수집은 즉시 중지되며, 종료 실패가 수집 재개를 뜻하지 않는다. 재시작 Sending/응답유실은 같은 세션/요청으로 복구한다. SESSION_ENDED는 방문 ACK가 아니다.

민감 DOM/권한 철회·PRIVACY_RETRACTED는 즉시 전송 Gate를 닫고 세션 격리와 visit IDs/일시/원인/`RETRACTION_REQUIRED`를 영속 저장한다. 기존 원본/영수증을 보존하고 POST replay·PATCH·END drain·알림을 중지한다. 이미 나간 HTTP를 원격에서 취소/삭제했다고 가정하지 않는다. 외부 삭제/회수 API는 추가하지 않았으며 AI cache/Export/학습/백업까지 삭제/PURGED 완료라고 표시하지 않는다.

## 10. BE 계약·상태·알림

실제 WorkSessionController/Service, PageVisitService, V2StorageGate, V2AnalysisQueryService, V2AlertService, DTO, V11/V12를 대조했다. storage Gate는 정확히 test 단일 profile+명시 flag이며 기본false다. BE idempotency는 목표+버전을 비교하고, v2 watermark는 신규 sequence 증가를 요구하며 replay/개인정보 검사를 먼저 한다. POST 필수 extractionStatus, nullable 일반 query, UTC milliseconds, int32/safe integer·Unicode 길이, PATCH 버전/누적 충돌, END `{}`가 일치한다.

`V2StatusClient`는 actual status의 legacy 필드를 해석에 사용하지 않는다. currentDecision만 최신 기준으로 사용하고 lastSuccessfulState는 현재 상태를 대체하지 않는다. PENDING/FAILED/INVALIDATED AI 알림, 다른 Window/분석/버전, 오래된 HTTP 결과, 종료 intent/격리, 로컬 표시 완료 후보를 차단한다. BE 고정주기 후보의 null 참조를 구분한다. 합성 React harness는 검증된 후보만 표시하고 표시 시각/선택을 영속 보관한 후 기존 shown/responses API로 ACK한다. 실패 시 같은 시각과 선택으로 재시도한다.

계약 충돌/한계: Schema의 search-success fixture는 example.org 검색 페이지를 모양상 허용하지만 실제 FE 추출 허용 엔진은 Google/Naver다. wire 모양 검증과 로컬 추출 증거를 분리해 둘 다 보존했다. GET visits는 본문 없는 목록 요약이며 PageVisitAck가 아니다. actual POST 응답을 계측해 Schema로 검증했으며 요약에 가짜 본문을 채우지 않았다. BE 제품 코드 수정 필요 사항은 발견하지 않았다. 표시 허가와 실제 렌더 사이의 분산 race를 없애는 새 승인 token은 제공하지 않는다.

## 11. 실제 실행 명령과 결과

Baseline: `cd fe && npm ci && npm test -- --reporter=dot` → **28파일/787테스트 통과**. 설치 전 첫 실행은 vitest 미설치로 실패했으며 Baseline 성공과 구분한다.

```sh
npm --prefix fe run typecheck
npm --prefix fe test -- --reporter=dot
npm --prefix fe run build
npm --prefix fe run build:synthetic
# fe 디렉터리, 설치된 Chrome for Testing 실행 경로 지정
CHROMIUM_PATH='<Chrome for Testing executable>' npm run test:browser
CHROMIUM_PATH='<Chrome for Testing executable>' npm run test:v2:browser
FE91_REAL_BE_URL=http://127.0.0.1:8912 \
 FE91_EVIDENCE=/private/tmp/focus91-real-http-evidence \
 CHROMIUM_PATH='<Chrome for Testing executable>' npm run test:v2:browser
# 저장소 루트, 기존 계약 검증 venv 사용
/private/tmp/focus81-validator/bin/python docs/contracts/v2/validate.py
/private/tmp/focus81-validator/bin/python fe/scripts/validate-v2-evidence.py /private/tmp/focus91-mock-evidence
/private/tmp/focus81-validator/bin/python fe/scripts/validate-v2-evidence.py /private/tmp/focus91-real-http-evidence
git diff --check
```

FE 최종 unit 결과는 **34파일/877테스트 통과**(기존787+신규90), typecheck·production/synthetic build 통과다. 공유 Fixture 중 POST/PATCH35개와 버전 분리1개를 실제 FE validator로 검사했다. 공통 reference 도구는 Schema30정의/80사례/139시나리오/216규칙/κ4, Markdown10/링크177을 통과했다. 문서 추가 후 링크 수만 늘며 Schema/Fixture 기대값은 변경하지 않았다.

실제 BE는 소스를 바꾸지 않고 임시 Gradle init script의 JavaExec에 `sourceSets.test.runtimeClasspath`를 사용해 실행했다. main은 `com.focusrecovery.FocusRecoveryApplication`, 인자는 아래와 같다.

```text
--spring.profiles.active=test
--server.address=127.0.0.1 --server.port=8912
--focus-recovery.v2.storage.enabled=true
--focus-recovery.v2.dispatch.enabled=false
--spring.datasource.url=jdbc:h2:mem:synthetic91;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1
```

이 서버는 기존 test properties의 H2·AI loopback 차단을 사용했다. 합성 HTTP 계측 proxy는 실제 BE로 동일 요청을 전달하고 실제 응답을 보관한다. 합성 개인정보 없는 임시 산출물은 `/private/tmp/focus91-*-evidence`에만 있으며 Git에 포함하지 않는다.

초기 회귀 실행에서는 테스트 헬퍼의 DB1 hard-code 때문에 실패/timeout이 났다. reader를 수정한 뒤 전체 재실행이 통과했다. 알림 E2E의 첫 추가 실행은 재시작으로 복원된 이전 harness가 먼저 후보를 소비해 timeout이었다. 후보 제공 시점을 테스트가 제어하도록 바꾼 후 표시/ACK/선택을 확인했다. 명시적 SW 재기동 뒤 완료 원본이 합법적으로 정리되어 hot queue에 없었던 추가 실행은 테스트의 보존 위치 가정으로 실패했다. 재시작 검증을 hot ACK 또는 실제 compaction 영수증의 원본 hash/sequence/행동 ACK/high-water 검증으로 보완했다. 실패 실행을 PASS 수에 포함하지 않는다.

## 12. 증거의 구분과 남은 검증

| 구분 | 실행/검증한 범위 | 한계 |
| --- | --- | --- |
| Unit/Mock | 4999/5000,3999/4000,299999/300000, 탭/문서/세대, 지연 추출, 중복·벽시계·절전형 공백, version, ACK/replay/END_PENDING/격리 | 가짜 시간/전송 응답, 실제 OS 동작 아님 |
| Fake IndexedDB | revision 경합, 실제 request 성공 후 transaction.abort, ACK commit abort, quota 예외, 손상, v1 보존 upgrade,205방문/정리·영수증·새 세션 archive | 실제 디스크 quota/브라우저 upgrade 중 강제 kill 아님 |
| 실제 v1 Chrome | 기존 MV3/검색 합성/권한 적용/POST replay/Worker 복구/민감 제외/Popup 회귀 PASS | 실제 Google/Naver 서비스가 아닌 합성 HTML·API |
| 실제 v2 Chrome |151.0.7922.34 macOS arm64, MV3·Content Script·실제IDB·명시적 SW stop/restart·완전 프로세스 재시작·Reload·지연 SPA·동일URL 본문세대·탭 이동·drain/END | 임시 프로필, 사이트 권한 사전 부여, headless |
| 실제 알림 UI | 합성 BE 응답의 최신 DRIFT 후보를 React에 표시, shown/선택 ACK | Mock HTTP; 실제 BE의 분석 완료→실제 알림 전체 연결은 별도 |
| 실제 FE–BE HTTP | 실제 Chrome→계측 proxy→실제 Spring/H2, v2 생성/POST/PATCH/END·종료 상태 조회, 실제 wire Schema 검증 | dispatch=false, AI/Window 판단·MySQL·실제 모델은 실행하지 않음 |
| 개인정보 | Gate/민감 DOM·catalog 제한·격리/재시작/전송 중 차단 | 원격 회수·실삭제·전체 DLP 완료 아님 |

실제 최소화/앱 전환/네이티브 다중 창·권한 승인 dialog, OS sleep/시간 변경·디스크 full·Migration 중 process kill, Windows/Linux/Chrome Stable, 실제 장시간 수시간·수일 수집, 다중 기기/분산 Worker는 미검증이다. 실제 AI 분석 완료·실제 BE 알림/고정주기 생성·사용자 응답까지의 전체 HTTP E2E는 이 실행에 포함하지 않는다. 기존 #89 증거를 이번 FE 실행으로 대신하지 않는다.

## 13. 미구현·후속·제출

운영 일반 사이트 v2 활성화, 전체 개인정보 회수/삭제·인증/소유권 API, AI cache/Export/학습/백업 영향 제거·PURGED는 의도적으로 제공하지 않는다. 기관 절차/동의·보존기간/운영 측정값/정책 승인도 미완료다. 범용 v2 실사용 수집을 완료로 판정하거나 P2/P6를 해제할 수 없다.

후속 제안(자동 Issue 생성 없음): (1) 인증·소유권과 전체 회수 inventory/삭제 증거, (2) 기관/팀 P1~P6 승인, (3) 네이티브 초점·OS 절전·quota·Migration 장애 다중 플랫폼 파일럿, (4) 실제 BE/AI 완료 판단과 알림·최종 표시 race 검증, (5) 합성 heartbeat/보존·용량 수치의 실측과 승인. 승인 후에만 별도 운영 활성화 변경을 검토한다.

PR은 `.github/pull_request_template.md`로 공식 main에 요청하며 자동 merge하지 않는다. Commit/Push/PR의 확정 식별자는 최종 채팅 보고를 따른다.

## 14. 변경 파일

- `docs/contracts/v2/README.md`
- `docs/data-analysis-contract.md`
- `docs/data-collection-spec.md`
- `docs/data-contract-validation.md`
- `docs/fe-spec.md`
- `docs/fe-v2-collection-validation.md`
- `docs/v2-contract-approval.md`
- `fe/.gitignore`
- `fe/package.json`
- `fe/scripts/durable-test-utils.mjs`
- `fe/scripts/session-end-integration-test.mjs`
- `fe/scripts/v2-browser-test.mjs`
- `fe/scripts/validate-v2-evidence.py`
- `fe/src/api/behavior.ts`
- `fe/src/api/session-end.ts`
- `fe/src/api/session.ts`
- `fe/src/api/types.ts`
- `fe/src/api/visit.ts`
- `fe/src/background/durable-state.ts`
- `fe/src/shared/types.ts`
- `fe/src/v2/collector.ts`
- `fe/src/v2/contract.ts`
- `fe/src/v2/notifications.ts`
- `fe/src/v2/repository.ts`
- `fe/src/v2/runtime.ts`
- `fe/src/v2/state.ts`
- `fe/src/v2/status.ts`
- `fe/synthetic/background.ts`
- `fe/synthetic/catalog.ts`
- `fe/synthetic/content.ts`
- `fe/synthetic/harness.html`
- `fe/synthetic/harness.tsx`
- `fe/tests/durable-background.test.ts`
- `fe/tests/durable-state.test.ts`
- `fe/tests/session-end-background.test.ts`
- `fe/tests/v2-collector.test.ts`
- `fe/tests/v2-contract.test.ts`
- `fe/tests/v2-fixture.ts`
- `fe/tests/v2-gate.test.ts`
- `fe/tests/v2-notifications.test.ts`
- `fe/tests/v2-runtime.test.ts`
- `fe/tests/v2-status.test.ts`
- `fe/tsconfig.json`
- `fe/vite.synthetic.config.ts`
- `fe/vite.synthetic.content.config.ts`
