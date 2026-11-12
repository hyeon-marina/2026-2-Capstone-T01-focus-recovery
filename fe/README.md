# Focus Recovery Chrome Extension (Issue #51 포함)

Issue #64에서 사이트 권한 철회 후 동일 세션을 재개할 때 이미 발급한 방문 순서를 재사용하지 않도록 수정했습니다. 본문·전송 큐는 삭제하고 순서 상한만 보존합니다. [수정·회귀 검증 보고서](../docs/permission-regrant-sequence-fix-validation.md)를 참고하세요.

Issue #60에서 Naver 일반 웹 카드의 새 DOM 경계를 지원합니다. [수정·검증 보고서](../docs/naver-search-dom-fix-validation.md)에 실제 Chrome → 전용 BE/MySQL의 영어·한국어 저장 결과와 남은 검증 범위를 기록합니다. 사이트 권한은 테스트 manifest에 사전 부여했으므로 사용자 승인 dialog 검증과 구분합니다.

Issue #59의 [실제 검색·사이트 권한 검증 보고서](../docs/real-search-permission-e2e-validation.md)는 최초 실패와 #60/#64/#67 수정 후 결과를 구분합니다. 최신 main 반영 후 이 검증 브랜치의 FE 779개 테스트가 통과했고 실제 Naver 외부 문서 저장도 확인했습니다. #74 제품 수정은 별도 PR #76으로 분리했습니다. 검증 자료는 리뷰 대상이며 Google 접근 제한·블로그/뉴스 수집 등 파일럿 미완료 범위는 유지합니다. 합성·사전 권한 실행과 실제 네이티브 승인 결과를 구분해 기록합니다.

Manifest V3 개발용 수집기입니다. 서버 작업 세션 → 확정 방문 POST → POST ACK 이후 누적 행동 PATCH → 최종 ACK 이후 서버 종료와 END_PENDING 영속 복구를 연동합니다.

본문은 최대 **5,000 Unicode code points**까지 추출하고, IndexedDB 큐·전송·저장에서는 추출 원본을 유지합니다. Issue #56에서 BE 검증도 동일 기준으로 통일했습니다. [Unicode 계약 수정·회귀 검증](../docs/unicode-content-length-validation.md)에 원인·경계값·실제 Chrome → BE → MySQL 결과를 기록합니다. DB 스키마 변경은 없습니다.

Issue #55 당시 실행 결과와 체크리스트는 [FE 데이터 수집 E2E 검증](../docs/fe-collection-e2e-validation.md)을 참고하세요. 기존 테스트를 재사용해 7개 방문과 단계별 MySQL Window 검사를 보강했습니다. 당시 발견한 문자 단위 결함은 위 #56 보고서로 후속 검증하며, 실제 검색 서비스 검증의 미완료 범위는 그대로 남습니다.

## Issue #51 코드 리뷰 경계 검증·보완 (2026-10-19)

이번 리뷰 작업은 미커밋 변경 없는 `feat/51/session-end-pending-recovery`, HEAD `777355971e02f01611526cbc771ebc5d05d8207d`에서 시작했습니다. origin은 개인 fork, upstream은 공식 저장소이며 실제 fetch 후 upstream/main은 `05b8d46a40546fbe693d34f12acc96ef768b29d7`으로 동일했습니다. 차이는 upstream 쪽 0개/작업 브랜치 쪽 1개 커밋입니다. 브랜치 전환·병합·기존 변경 폐기는 하지 않았습니다. 아래 #51 최초 구현 절은 당시 기록이며 이번 리뷰 결과는 이 절을 따릅니다.

### A — 종료 ACK의 IndexedDB commit 실패

**미영속 ACK가 ENDED로 표시되거나 재사용되는 문제는 재현되지 않았습니다.** 제품의 `SessionEndDelivery`, Background, DurableRepository는 수정하지 않았습니다. 새 테스트는 실제 fake-indexeddb의 ACK put 성공 후 transaction abort, QuotaExceededError, 다른 repository의 선행 revision commit을 각각 주입합니다. POST/PATCH ACK가 모두 저장되고 검증된 ENDED 응답이 돌아온 뒤에만 실패시킵니다.

실패 직후 Worker를 유지한 채 status를 반복하고 retry-end/start/알람/content 이벤트를 실행했습니다. 메모리는 `storage.phase=failed`, END_PENDING, `ack/lastServer` 없음으로 복원되고 추가 HTTP는 0회였습니다. 마지막 정상 sending checkpoint의 `{}`·sessionId·시도 횟수·후보/방문/행동 ACK·생성 영수증은 보존됐습니다. 실패 전에 이미 직렬 실행기에 들어온 무해한 checkpoint 쓰기는 revision을 증가시킬 수 있지만, 저장 실패가 확인된 뒤 반복 status/wakeup에서는 aggregate와 revision이 변하지 않습니다.

근거는 `persist`가 save 실패를 잡아 `storageFailure`를 실행하고, 그 함수가 독립 복사된 마지막 `committed` aggregate로 `ending.restore` 및 Collector/전송 큐를 복원하는 기존 구조입니다. 공개 status와 다음 mutation은 같은 직렬 실행기 뒤에서 실행됩니다. HTTP는 실행기 밖에서 기다리므로 응답 보류 중 Popup/중지/삭제가 처리됩니다. 실패한 ACK의 옛 객체는 현재 checkpoint가 아니며 전송 가능 조건도 false입니다. Worker 재시작 후 같은 세션·`{}`로만 재전송되고 최초 서버 endedAt을 유지했습니다.

다른 Worker가 END 응답 도중 로컬 삭제를 commit한 경우도 새 테스트에서 검증했습니다. 늦은 ACK 쓰기는 revision 불일치로 거절되고 삭제된 sessionEnd를 재생성하지 않습니다. 재시작은 삭제 aggregate와 localMirror 이전 값 증거를 확인하며, 과거 ACTIVE 기록으로 수집을 되살리지 않습니다.

IDB commit 성공 뒤 `storage.local.set`만 실패하면 ACK는 유효합니다. 이 경우 ENDED와 `metadataSyncPending=true`, storage ready를 유지하며 END를 다시 보내지 않습니다. 사용자 status 요청이 동기화 실패를 알리는 `ok=false`를 반환할 수 있어도 그 안의 영속 ACK/ENDED를 저장 실패로 오인하지 않습니다. 현재 종료 ACK 경로는 역사적 `activeSession`/생성 영수증을 보존하기 위해 **set**을 사용하며 activeSession remove는 호출하지 않습니다. 없는 remove 경계를 만들기 위한 제품 수정은 하지 않았습니다.

### B — 종료 완료와 새 세션 생성 영수증

**검증한 B 경계에서 이전 ACTIVE 부활·새 세션과 이전 END 혼합은 재현되지 않았습니다.** localMirror/migrationParts 검증과 기존 생성 복구 코드를 유지했습니다.

| 경계 | 새 검증과 확인 결과 |
| --- | --- |
| B1 ACK commit 후 mirror 실패 | ACK commit 뒤에만 local set 실패를 주입. 같은 Worker/재시작에서 기존 ENDED·생성 영수증 유지, 추가 END 없음. ACK 경로의 activeSession remove 호출 없음도 확인. |
| B2 새 pending 저장 직후 중단 | 새 키 저장 성공 직후 중단을 모의. 이전 ENDED는 유지하며 재시작 후 같은 새 키로 생성 요청을 재시도. 이전 세션은 수집하지 않음. |
| B3 새 응답 저장/활성 commit 경계 | 새 응답 영수증 저장 직후, 새 활성 IDB transaction abort, 새 활성 commit 뒤 local mirror 실패를 각각 주입. 이전 acked END+새 pending 공존 또는 새 활성 checkpoint+이전 mirror 증거를 검증해 새 receipt의 키/세션으로 복구. 응답이 저장됐으면 추가 create HTTP 없음. |
| B4 실제 충돌 | 정상 형식이지만 sessionId·goalText·idempotencyKey가 IDB와 다른 local active 메타데이터를 각각 로드. 기존 증거로 입증되지 않는 충돌은 차단, 양쪽 원본 보존, start/clear 불가. |
| B5 v1/부분 migration | 기존 `sessionEnd` 없는 v1·과거 로컬 종료의 자동 승격 금지 회귀 유지. 새 draining/retry-wait/acked와 검증된 부분 legacy remainder 공존은 보존. 증명되지 않는 remainder는 원본 보존 및 충돌 거절. |
| B6 전체 재시작/reload | 실제 Chrome에서 이전 END ACK 뒤 새 서버 생성 응답은 local에 저장되고 새 활성 commit만 abort된 상태를 구성. 같은 프로필 완전 재시작/runtime.reload 후 동일 새 receipt로 복구하며 create 추가 호출·이전 세션 부활 없음. |

요청 스냅샷과 생성 영수증을 새로 조립하거나 ID를 바꾸지 않습니다. sessionId·멱등 키는 기존 request/response를 사용하며, A 실패 전후 후보·POST·PATCH checkpoint의 전체 동등성으로 visitId·sequence·behaviorVersion·누적값·ACK 보존을 검사했습니다. 새 세션만 새 생성 키/세션을 갖고 이전 후보를 이어받지 않습니다. Collector 미결 후보/sequence 판정, 자동 3회 상한·저장된 attempts/nextRetryAt·수동 예산 갱신, POST ACK 선행 및 END 전 최종 ACK 게이트는 기존 테스트와 실제 통합 시나리오로 유지합니다.

### C — 재현한 안내 부족과 최소 변경

수정 전 jsdom에서 실제 Popup을 렌더링한 새 테스트 **2개가 실패**했습니다. `SERVER_ENDED_UNCONFIRMED` 또는 POST/PATCH의 `SESSION_ENDED`가 있어도 일반적인 “확인 필요”/“종료 요청 전송 중·대기”로만 표시됐고, 운영자 불일치와 영구 유실 안내가 명시되지 않았습니다. 데이터 자동 ACK·삭제·새 세션 생성 문제 자체는 재현되지 않았습니다.

제품 변경은 `src/popup/index.tsx`의 **10줄 추가·2줄 변경**입니다. 미확인 POST/PATCH가 있고 기존 status의 오류 code/마지막 서버 ENDED 중 하나가 입증되면 별도의 **“서버 종료·로컬 데이터 불일치 (운영자 확인 필요)”** 안내를 표시합니다. 남은 POST/PATCH 수, 로컬 기록 보존, 담당자의 서버 상태 확인, 로컬 삭제 시 최종 데이터·종료 복구 정보 영구 유실 및 서버 삭제가 아님을 설명합니다. 이 상태에서는 종료 재시도와 새 시작 버튼을 차단합니다. 일반 retryable 네트워크 실패/재시도 대기는 기존 정책대로 구분합니다.

기존 Background status 필드만으로 판정할 수 있어 shared type·저장 모델·API·전송기는 변경하지 않았습니다. 강제 복구/자동 삭제/서버 변경 기능을 추가하지 않았으며 페이지 원문·서버 오류 원문을 메시지나 로그에 사용하지 않습니다.

### 변경 파일과 검증 구분

| 파일 | 변경 이유 |
| --- | --- |
| `src/popup/index.tsx` | 재현된 C 안내와 버튼 경계만 보완 |
| `tests/session-end-background.test.ts` | A/B의 같은 Worker 실패·삭제/revision 경합·새 receipt·충돌 보존 **12개 추가** |
| `tests/session-end-state.test.ts` | END와 부분 migrationParts/legacy remainder의 호환·거절 **4개 추가** |
| `tests/session-end-popup.test.ts` | 실제 React Popup의 불일치/네트워크·버튼/유실 안내 **5개 신규** |
| `scripts/session-end-integration-test.mjs` | 기존 실제 4개 시나리오 유지 + 리뷰 A 4개/B 2개/C 2개 추가. fault injection은 테스트 전용 |
| `README.md` | 재현/비재현 근거·명령 결과·운영 제약 기록 |

`session-end.ts`, `index.ts`, `durable-state.ts`, 종료/조회 API와 shared types 및 BE/DB/AI에는 제품 코드 변경이 없습니다. 기존 테스트 694개는 삭제하거나 기대값을 완화하지 않았습니다. 신규 21개로 전체 **25개 파일·715개 테스트**입니다. 모의 테스트의 저장 경계 중단은 의도적인 예외 주입이며 실제 브라우저 종료와 구분합니다.

### 리뷰 최종 실행 결과와 제약

| 실행 | 실제 결과 |
| --- | --- |
| 수정 전 기준 `npm test` | 기존 **24개 파일·694개 성공** |
| `cd fe && npm run typecheck` | 성공 |
| `cd fe && npm test` | **25개 파일·715개 성공** (기존 694개 + 신규 21개) |
| `cd fe && npm run build` | 성공, production MV3/콘텐츠 빌드 |
| `git diff --check` | 성공 (신규 Popup 테스트도 별도 whitespace 검사) |
| `CHROMIUM_PATH=ChromeForTesting npm run test:browser` | 실제 Chrome MV3·**합성 API** 기존 회귀 성공 |
| 실제 `session-end-integration-test.mjs` | 기존 4개 + 리뷰 A 4개/B 2개/C 2개 = **12개 시나리오 성공** |

실제 환경은 macOS, headless Chrome for Testing **151.0.7922.34**, Java **21.0.10**, Spring Boot **4.1.1**, 전용 임시 MySQL **8.4.9**입니다. BE는 기존 빌드 JAR을 실행했고 소스/스키마를 변경하지 않았습니다. 모든 페이지·목표는 합성 자료입니다.

- 기존 정상/Worker/완전 브라우저/reload 종료 회귀는 각각 실제 방문 **6개·Window 2개**, POST/PATCH 영속 ACK 전 END 0회, 응답 유실 후 `{}` 재전송·동일 endedAt, 종료 후 추가 FE 전송 없음과 실제 BE 409를 재확인했습니다.
- 리뷰 A는 실제 BE 종료 commit과 SQL ENDED를 확인한 뒤 응답을 보류하고 실제 MV3 Worker에 **테스트용** IDB abort/QuotaExceeded, 별도 revision commit 또는 local set 실패를 주입했습니다. IDB 실패 3종은 같은 Worker의 status/start/retry 차단·원본 유지 후 Worker/전체 Chrome/reload로 복구하며 동일 세션·요청·영수증·후보/POST/PATCH ACK와 최초 endedAt을 유지했습니다. mirror 실패는 이미 commit한 ENDED를 유지하고 추가 END가 없었습니다.
- 리뷰 B는 실제 서버가 새 세션을 생성하고 응답 영수증이 저장된 뒤 새 활성 checkpoint commit만 abort했습니다. 이전 END ACK와 새 pending receipt가 공존하는 상태에서 실제 Chrome PID SIGKILL/같은 프로필 재실행 및 실제 runtime.reload를 각각 수행했고, 같은 새 키·세션을 재사용하며 create HTTP 추가 호출이 없었습니다. 새 세션도 검증 후 정상 종료했습니다.
- 리뷰 C는 실제 BE를 먼저 종료시킨 후 POST/PATCH를 전송해 각각 실제 `409 SESSION_ENDED`, GET ENDED를 확인했습니다. POST 거절 시 **POST 1/PATCH 1 미확인**, PATCH 거절 시 **POST 0/PATCH 1 미확인**이 보존됐고, 정상 종료 ACK/자동 삭제/새 세션 생성/FE END 호출은 없었습니다. SQL은 각각 방문 0개/1개를 유지했습니다. 실제 Popup의 운영자 안내·건수·영구 유실 문구와 비활성 종료 재시도 버튼도 확인했습니다.

**실제 DB 결과와 실패 주입은 구분합니다.** 서버 ENDED/endedAt·방문/Window 수·409는 실제 BE/MySQL 결과입니다. proxy 응답 보류 및 Worker의 IDB/Quota/revision/local 오류는 의도적인 테스트 어댑터 주입이며 실제 디스크 고장/스토리지 용량 소진을 재현한 것이 아닙니다. B2/B3의 일부 중단·B4 충돌·B5 legacy/migration 및 일반 네트워크/3회 재시도 등은 fake-indexeddb/모의 Chrome·HTTP 또는 기존 API 테스트 범위입니다.

최초 실제 통합 실행은 mirror 실패에서도 공통 status 헬퍼가 `ok=true`만 허용해 중단됐습니다. 영속 ACK와 동기화 오류를 함께 반환하는 정상 `ok=false` 상태를 헬퍼에서 구분한 뒤 **제품 저장 코드 수정 없이 12개 전체 재실행을 통과**했습니다. 모의 A/B 테스트의 초기 revision/remove 호출 비교도 실패 전 idle commit·초기화 이력을 포함하지 않도록 관측 범위를 교정했으며, 이를 제품 ACK/영수증 결함으로 보고하지 않습니다.

검증 후 실제 SQL 누적(초기 중단 실행 포함)은 ENDED **22세션·59방문·16Window**, ACTIVE 0개였습니다. 테스트 BE와 전용 MySQL 컨테이너/익명 볼륨은 종료·제거했고, 각 실행의 임시 Chrome 프로필·확장·합성 HTTP 서버도 정리했습니다. 원래 DB/브라우저 프로필은 사용하지 않았습니다.

디스크 전원 상실·실제 저장소 퇴거/물리 손상, Windows Stable, HEADED native 다중 창/최소화, 실제 검색 사이트 DOM은 재검증하지 않았습니다. commit 전 이벤트나 중단 중 행동을 복원한다고 보장하지 않습니다. 운영자 확인이 필요한 서버 ENDED+미확인 데이터의 자동 복구, 미결 recoveryRequired 판정, 강제 서버 수정/삭제 기능은 추가하지 않았습니다. 후속 Issue 후보는 운영자 확인 절차/관측 도구, 사용자 동의가 포함된 미결 후보 처리 정책 및 Windows/native 환경 검증입니다.

종료 Git 상태는 같은 브랜치·같은 HEAD `7773559`에서 위 **6개 파일**만 미커밋 변경(기존 5개 수정·새 테스트 1개)으로 남았습니다. 이번 리뷰 작업에서는 commit·push·PR을 생성하지 않았습니다.

## 서버 세션 종료와 END_PENDING (Issue #51, 2026-10-19)

이 절이 현재 종료·복구 동작의 기준입니다. 아래 #48/#46/#43/#34 절은 당시 구현·검증 이력입니다. 과거의 “종료 API 미연동”, “END_PENDING 후속 작업”, “권한 철회 시 항상 모든 큐 삭제” 설명은 현재 Popup의 서버 종료 흐름에는 적용하지 않습니다.

### 확인한 기준과 BE 계약

작업 시작은 미커밋 변경 없는 detached HEAD `f73e08636892f22eca36f347c46cfe0a34e5612c`였습니다. origin은 `hyeon-marina/2026-2-Capstone-T01-focus-recovery`, upstream은 `SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery`입니다. 실제 `git fetch upstream main`으로 확인한 최신 기준은 `05b8d46a40546fbe693d34f12acc96ef768b29d7`이며, 존재하지 않던 `feat/51/session-end-pending-recovery` 브랜치를 그 커밋에서 생성했습니다. Issue #51 전체, 완료된 #34/#43/#46/#48, 관련 FE/BE 코드·테스트와 수집 명세 7·9장 및 FE/BE 명세를 확인했습니다. 커밋·push·PR은 만들지 않습니다.

- `POST /api/sessions/{UUID}/end`: 200, `status=ENDED`, UTC 밀리초 형식의 `endedAt`. 목표·시작 시각·세션 ID는 변하지 않습니다. 중복·동시 종료는 최초 endedAt을 유지합니다. 종료 요청에 별도 Idempotency-Key는 필요하지 않습니다.
- `GET /api/sessions/{UUID}`: 200, ACTIVE/ENDED 모두 조회 가능하며 동일 응답 DTO입니다. 경로 UUID 형식 오류는 400 `INVALID_REQUEST`, 없는 세션은 404 `SESSION_NOT_FOUND`입니다.
- 선택적 `finalBehaviors`는 생략/null/빈 배열을 지원합니다. 하나라도 실패하면 행동 갱신과 종료 모두 rollback합니다. 다른 세션/없는 방문은 404 `VISIT_NOT_FOUND`, 동일 버전·다른 값은 409 `BEHAVIOR_VERSION_CONFLICT`, 높은 버전의 누적값 감소는 409 `BEHAVIOR_COUNTER_DECREASED`입니다. 이미 ENDED이면 finalBehaviors를 적용하지 않고 최초 종료 결과를 반환합니다.
- 따라서 이번 전송기는 **모든 최종 PATCH ACK 뒤 `{}`만 고정하여 전송**합니다. API 클라이언트는 finalBehaviors DTO/검증을 지원하지만 종료 큐에서는 중복 행동 전달을 하지 않습니다. 최초 END 전 최종 행동 ACK가 없으면 종료하지 않습니다.
- 종료 후 **신규** POST와 모든 행동 PATCH는 409 `SESSION_ENDED`입니다. 동일 원본 방문 POST 재전송은 200으로 기존 방문을 반환할 수 있습니다. 이를 근거로 미확인 데이터를 자동 ACK하거나 버리지는 않습니다.
- `WorkSessionService.end`는 세션 배타 잠금·단일 트랜잭션을 사용하고 종료 시 아직 요청하지 않은 기존 Window 분석도 요청합니다. `WorkSessionEndApiTest`의 중복/동시 종료·최종 행동 원자성·종료 후 거절 테스트를 확인·실행했습니다. 일부 `fe-spec.md`/`be-spec.md`의 “상태/종료 순서 미확정” 및 “종료 이후 분석 요청 없음” 설명은 현재 구현보다 오래되었습니다. 이 작업은 실제 구현과 확정된 수집 명세를 기준으로 하며 BE/DB는 수정하지 않습니다.

### 세 차원의 상태와 저장 순서

| 차원 | 상태/의미 |
| --- | --- |
| 로컬 수집 | `collection.session` 존재 시 수집 중, null이면 중지. 서버 상태를 뜻하지 않습니다. |
| 사용자 종료 의사/ACK | 종료 checkpoint 없음 / `END_PENDING` / 종료 ACK를 IDB에 저장한 `ENDED` |
| 서버 확인 | 원래 생성 응답 ACTIVE / 마지막으로 검증한 `lastServer` / ENDED ACK의 최초 `endedAt` |

Popup의 **작업 세션 종료**는 `end-session` 메시지를 사용합니다. 선택 즉시 중복 클릭·새 Content 수집을 차단하고, Chrome 조회를 기다리던 메시지도 새 수집에 반영하지 않습니다. Collector의 기존 `stop` 정책대로 마지막 체류시간·전환·버전을 확정합니다. 복구로 분리된 유효 후보는 저장된 누적값으로만 확정하고, 미결 pending/복구 가능한 제외 후보는 그대로 보존합니다. 미결 후보 때문에 sequence가 보류되면 END도 보류합니다. 브라우저 중단 기간은 합산하지 않습니다.

1. 최종 Collector + POST/PATCH checkpoint + 사용자 종료 의사를 **하나의 strict IndexedDB 트랜잭션**으로 commit합니다. 저장 실패 시 HTTP를 보내지 않고 저장 오류를 표시합니다.
2. 기존 POST 전송기가 sequence 순서 및 앞 POST ACK 정책대로 전송합니다. 기존 PATCH 전송기는 **영속 POST ACK**가 있는 방문만 갱신합니다. HTTP는 직렬 실행기 밖에서 기다립니다.
3. 종료 전송기는 **마지막으로 commit한 aggregate**에서 모든 후보 판정 종료, 모든 readyVisit에 대한 POST/PATCH 항목 존재, 전체 POST ACK, 최종 행동값을 포함하는 PATCH ACK를 검사합니다. POST 응답 자체가 최종 행동을 확인하면 기존 전송기 정책대로 별도 PATCH는 생략할 수 있습니다.
4. 모든 조건을 충족한 뒤 종료 DTO `{}`·`sending`·증가한 attempts를 다시 commit한 후 HTTP를 보냅니다.
5. 응답의 UUID·목표·startedAt 일치, `status=ENDED`, 유효한 UTC 밀리초 endedAt 및 `endedAt >= startedAt`을 검증하고 ACK를 commit한 뒤에만 Popup에 ENDED를 표시합니다.

ENDED 후에는 신규 POST/PATCH/END를 재개하지 않습니다. 종료 완료 후 새 작업은 새 생성 키·세션·빈 큐로 시작합니다. 완료된 이전 종료 영수증과 새 미확인 시작 요청이 동시에 남아도 서로 다른 생성 요청으로 복구합니다.

기존 trusted Popup 메시지 `stop`은 #48 이전 로컬 전용 종료 호환 경로로 유지합니다. 현재 Popup 버튼은 이를 보내지 않습니다. 기존 v1에 로컬 종료만 남았거나 종료 checkpoint가 없으면 **자동 END_PENDING 승격이나 서버 종료 요청을 하지 않습니다.** 과거 기록에 새 종료 동의를 추정하지 않습니다.

### IndexedDB v1 모델과 복구

DB `focus-recovery`, store `state`, key `current`, `format=1`, DB version **1**을 유지합니다. 기존 aggregate에 선택적 `sessionEnd`를 추가하므로 기존 v1 및 legacy migrationParts/hash 영수증은 그대로 읽습니다. 필드 없는 기록은 기존 의미를 유지합니다. localMirror 이전 값 증거, revision 비교, 초기화 장벽 및 생성 멱등 키/응답 검증도 유지합니다.

`sessionEnd`는 API origin, 원래 ACTIVE 세션 스냅샷, 사용자 요청 시각, `draining / queued / sending / retry-wait / failed / acked`, 고정 request, attempts, nextRetryAt, 안전한 오류/code/retryable, lastServer, ack를 보관합니다. 전체 데이터·세션 ID·생성 영수증·최종 ACK 게이트·요청/ACK 상태의 정합성을 commit/hydrate에서 검증합니다. 손상·API origin 변경·세션 불일치는 원본을 초기화하지 않고 차단합니다. 방문이 0개여도 종료 대상 sessionId가 aggregate 소속 검증에 포함됩니다.

`activeSession`에는 **원래 생성 ACTIVE 응답과 생성 영수증을 역사적 증거로 보존**합니다. 이는 현재 BE 상태가 아닙니다. END_PENDING/ENDED의 수집 여부·서버 확인은 sessionEnd로 판단합니다. 이 증거는 명시적 삭제 또는 새 생성 성공 때 교체합니다. 오래된 ACTIVE local 메타데이터만으로 수집/시작을 재개하지 않습니다. `collection.session`은 종료 의사를 commit할 때부터 null입니다.

Worker/Chrome/reload 복구에서 `sending`은 같은 요청을 재확인할 수 있는 retry-wait로 복원하고 기존 attempts를 유지합니다. 응답 유실이나 ACK commit 실패에서도 같은 sessionId와 `{}`를 재전송합니다. BE의 멱등 종료가 최초 endedAt을 보존합니다. HTTP 전 시도 횟수를 저장하므로 실제 전송 직전 중단돼도 보수적으로 한 시도를 소비합니다. ACK 저장 실패는 ENDED로 표시하지 않으며 원본 sending checkpoint로 복구합니다.

POST/PATCH에서 `SESSION_ENDED`가 확인되면 GET으로 같은 세션 상태를 확인합니다. 이미 서버 ENDED인데 미확인 데이터가 남으면 `SERVER_ENDED_UNCONFIRMED`, ACK 없음, END_PENDING/확인 필요로 남기고 원본과 큐를 보존합니다. 수동 POST/PATCH 재시도로도 알려진 ENDED 서버에 재전송하지 않습니다. 정상 ACK가 모두 있는 경우에는 멱등 END로 완료할 수 있습니다. 임의 서버 수정·새 세션 생성·데이터 삭제·ACK 추정은 하지 않습니다.

### 재시도·오류·삭제·권한

network, 10초 timeout, 5xx, 408/429 및 읽을 수 없는 성공 JSON은 같은 요청으로 자동 확인합니다. 400/404/409 및 기타 영구 HTTP 오류, 다른 sessionId/목표/시작시각, 잘못된 ENDED/종료시각·잘못된 성공 상태는 자동 반복하지 않습니다. 오류 본문/메시지는 사용하지 않고 알려진 BE code만 whitelist합니다. URL·본문·검색어·목표·플랫폼 오류 원문을 로그로 출력하지 않습니다.

종료 확인도 기존 정책과 같은 **총 3회 자동 시도**(서버 불일치 확인 GET도 동일 예산), 실패 후 1초·2초 대기입니다. attempts/nextRetryAt을 저장하고 재시작은 예산을 초기화하지 않습니다. 3번째 sending 중단도 4번째 자동 요청을 만들지 않습니다. 일시 오류의 실패 상태에서 **같은 종료 요청 재시도**를 눌러야 예산을 갱신합니다. 영구 오류는 담당자의 서버 상태 확인 대상입니다. Worker 시작·Popup/실제 이벤트·기존 `durable-delivery` 알람에서 재개하며 타이머/알람의 정확한 실행 시각은 보장하지 않습니다.

Popup은 ACTIVE, END_PENDING(최종 데이터 대기/종료 전송/재시도 대기/확인 필요), ENDED를 구분하고 잔여 POST/PATCH·보류 후보·종료 시도/시각·수동 재시도 여부·서버 종료 시각을 표시합니다. END_PENDING/복구 보류에서는 신규 시작을 차단합니다. IDB 실패와 commit 후 storage.local mirror 실패, 서버/네트워크 오류는 구분합니다. IDB commit 뒤 localMirror 쓰기 실패는 성공한 의사/ACK를 되돌리지 않으며, 증거를 대조해 메타데이터 동기화를 재시도합니다.

명시적 로컬 삭제는 후보/POST/PATCH/종료 복구 정보를 함께 지웁니다. Popup은 미확인 정보가 있으면 유실 위험과 서버 삭제가 아님을 설명하고 확인 dialog를 거칩니다. 이미 발송한 HTTP는 서버에 반영될 수 있습니다. 삭제 후 지연 ACK는 checkpoint 객체 소속 검사로, 오래된 Worker 쓰기는 revision 검사로 차단합니다. END_PENDING/ENDED에서 사이트 권한을 철회해도 신규 수집은 이미 중단돼 있고 종료 복구 정보/확정 큐를 보존합니다. 샘플 삭제는 명시적 로컬 삭제로 수행합니다. 종료 의사가 없는 기존 권한 철회 경로는 기존 #48의 샘플 삭제·생성 영수증 보존 정책을 유지합니다.

### 변경 범위와 검증

- `src/api/session-end.ts`, `src/api/types.ts`: 종료/조회 DTO, UUID·스냅샷·서버 응답 검증과 안전한 오류 분류. 기존 생성/POST/PATCH API는 그대로 사용합니다.
- `src/background/session-end.ts`: 종료 의사·불변 요청·시도/재확인·ACK 전송기. `durable-state.ts`: 선택 필드·소속·게이트 검증. `index.ts`: 초기화/commit/이벤트와 전송기 연결, 즉시 수집 차단·시작 차단·삭제/권한 처리.
- `src/shared/types.ts`, `messages.ts`, `src/popup/index.tsx`: 종료 메시지·상태·재시도·위험 안내. Collector 기본 정책, serial 실행기, 기존 방문/행동 전송기 및 BE/DB 코드는 변경하지 않습니다.
- `tests/session-end-*.test.ts`: 계약, 실제 fake-indexeddb 트랜잭션 abort/revision/손상·마이그레이션 호환, 게이트·지연 응답·재시작·예산·종료 후 새 생성 테스트. 기존 609개 테스트는 삭제·수정하지 않았습니다.
- `scripts/session-end-integration-test.mjs`, `visit-test-proxy.mjs`: 실제 BE commit 후 END 응답만 보류하는 전용 통합 시나리오. `browser-test.mjs`: 새 Popup 종료 문구/버튼과 합성 종료/PATCH 응답을 추가하고 기존 회귀 검사를 유지합니다.

최종 실행 결과는 아래 검증 기록에 기재합니다. IndexedDB abort·revision 경합·localMirror 쓰기 실패·손상 영수증·3회 예산/수동 갱신·잘못된 JSON/세션·timeout·HTTP 오류는 **모의 어댑터/fake-indexeddb 테스트**이며 실제 디스크/DB 장애를 재현한 결과로 간주하지 않습니다.

재실행은 개인정보 없는 전용 MySQL DB에 BE를 연결한 뒤 `fe`에서 다음을 실행합니다. 이 스크립트는 전용 DB에서만 실행하며 검증 후 BE/DB를 종료·제거해야 합니다. 임시 확장·프로필·합성 HTTP 서버는 스크립트가 정리합니다.

```sh
INTEGRATION_API_BASE_URL=http://localhost:18051 \
INTEGRATION_MYSQL_CONTAINER=전용_임시_DB_컨테이너 \
CHROMIUM_PATH="/absolute/path/to/Chrome for Testing" \
node scripts/session-end-integration-test.mjs
```



### Issue #51 최종 검증 기록 (2026-10-19)

| 검사 | 결과 |
| --- | --- |
| `cd fe && npm run typecheck` | 성공 |
| `cd fe && npm test` | **24개 파일 / 694개 성공**, 기존 609개 수정·삭제 없이 신규 **85개** 추가 |
| `cd fe && npm run build` | 성공, production 확장/콘텐츠 빌드 |
| `git diff --check` | 성공 |
| `JAVA_HOME=Java21 ./gradlew --offline test --tests '*WorkSessionEndApiTest' bootJar` (be) | 기존 BE 종료 계약 **24개 성공**, BE 코드 수정 없음 |
| `CHROMIUM_PATH=ChromeForTesting npm run test:browser` | 실제 MV3 + **합성 API** 회귀 성공. 기존 생성·수집·POST·PATCH·저장 장애 복구·손상 영수증 차단과 새 Popup 종료 확인 |
| `session-end-integration-test.mjs` | **실제 Chrome → Spring Boot → 전용 MySQL, 4개 시나리오 성공** |

실제 통합 환경은 macOS, headless Chrome for Testing **151.0.7922.34**, Java **21.0.10**, Spring Boot **4.1.1**, MySQL **8.4.9**입니다. 초기 탐색 실행은 기본 Java 25.0.2였으며, 테스트 BE를 Java 21로 다시 시작하고 4개 시나리오를 모두 재실행했습니다. 테스트용 합성 공개 페이지와 별도 프로필/확장을 사용했습니다.

정상 종료, END DB commit 후 응답만 보류한 **Worker target 종료**, **전용 Chrome browser PID SIGKILL 후 같은 프로필 재실행**, 실제 **runtime.reload 및 storage.session 표식 소실**을 각각 검증했습니다. 각 시나리오에서 방문 **6개·Window 2개**, 실제 마지막 PATCH 저장 및 ACK, POST/PATCH ACK 보류 중 END **0회**, DB의 ENDED/ended_at을 확인했습니다. 정상은 END 1회, 중단 복구는 동일 `{}` END 2회이며 GET과 두 응답에서 최초 endedAt이 동일했습니다. 종료 후 신규 POST/PATCH의 **실제 BE 409 SESSION_ENDED**, 추가 탭 탐색 후 FE의 POST/PATCH/END **추가 요청 0회**, SQL 방문/Window 수와 endedAt 불변도 확인했습니다.

응답 보류는 전용 HTTP 프록시의 명시적 fault injection입니다. 보류 전에 실제 BE의 200 응답과 SQL commit을 확인하므로 **서버 저장은 실제 DB 결과이고 응답 유실은 테스트 주입**입니다. IDB transaction abort, localMirror 일부 쓰기 실패, revision 경합, 손상 영수증·API 응답·재시도/timeout 테스트는 모의 어댑터 결과입니다. 이를 실제 디스크 고장·MySQL 실패 재현으로 주장하지 않습니다. 검증 후 전용 BE 프로세스를 종료하고 MySQL 컨테이너/익명 볼륨 및 임시 Chrome 프로필을 제거했습니다. 반복 실행 누적 최종 SQL은 ENDED 12세션·72방문·24Window였으며 ACTIVE 세션은 없었습니다. 이 데이터는 전용 DB 제거와 함께 삭제했습니다.

미검증 한계는 실제 전원 상실·디스크 손상·브라우저 저장소 퇴거, Windows/Chrome 최소 버전, HEADED native 다중 창·최소화, 실제 검색 사이트 DOM 및 알림 UI입니다. commit 전 이벤트와 브라우저 중단 중 행동은 복구할 수 없습니다. 후속 과제는 미결 recoveryRequired 후보의 사용자 판정/운영자 복구, 장기 sequence 보류 해소, 서버 ENDED+미확인 데이터의 운영 절차, 오래된 FE/BE 명세 갱신과 알림/분석 UI의 종료 게이트 연계입니다. 정상 경로의 BE 종료 계약 결함은 발견되지 않았으며 BE/DB/AI는 변경하지 않았습니다.

## IndexedDB 영속 큐와 복구 (Issue #48, 2026-10-18)

이 절은 Issue #48 당시 저장·복구 구현 기록입니다. 현재 종료 동작과 END_PENDING 예외는 위 Issue #51 절을 따릅니다. 아래 Issue #46 이하의 기록은 해당 작업 당시의 구현·검증 이력이며, `storage.session`만 사용한다거나 IndexedDB가 후속 작업이라는 설명은 이번 절로 대체합니다.

### 코드 리뷰 후 보완 (기준 `427f9ad`, 2026-10-18)

이번 보완은 `feat/48/indexeddb-durable-queue`의 `427f9adfaefc48678836d91b925ec4125590da4b`에서 시작했습니다. 시작 시 미커밋·미추적 파일이 없었고 origin은 개인 fork, upstream은 공식 저장소였습니다. 최초 확인한 공식 main은 `6059729`였으며 마무리 재확인에서 `f23b2a729defb6039a4fa537160089b030e95491`(PR #49, Issue #44 알림 이력)이 확인됐습니다. 원격 참조만 fetch했으며 **병합·rebase·commit·push·PR 생성은 하지 않았습니다.** 최신 upstream과는 upstream 쪽 5개/작업 브랜치 쪽 1개 커밋 차이이며 공통 기준은 `6059729`입니다. 검증한 BE는 현재 작업 브랜치의 소스이며 새 알림 이력 변경을 합친 BE는 아닙니다.

#### 확인된 결함과 최소 수정

먼저 실패 테스트로 다음을 재현했습니다. local 메타데이터 갱신 실패가 성공한 IDB 활성 checkpoint를 중단 상태로 다시 기록했고, 로컬 종료 commit 후 local 삭제 실패는 완료된 종료를 복구 대기 상태로 다시 기록했습니다. IDB의 재개 commit 직후 중단하면 오래된 local `interrupted`와 남은 pending 영수증 때문에 다시 보류됐습니다. 반대로 종료된 IDB 옆의 다른 local 세션은 충돌 검사 없이 삭제됐습니다. 마이그레이션 키 일부만 남으면 전체 해시가 달라져 정상 정리 중단도 충돌로 처리했고, 키 정리 오류가 정상 IDB를 저장소 복구 실패로 표시했습니다.

DB **v1 / `state` / `current`**는 유지하고 두 선택 필드만 추가했습니다.

- `value.localMirror: { previous?: 활성 세션 메타데이터 }`: 다음 local 쓰기 직전에 관찰한 이전 값을 같은 IDB 집계에 commit합니다. 실제 local 값이 commit된 목표와 같거나 기록된 이전 값과 정확히 일치할 때만 늦어진 mirror 쓰기로 판단합니다. 시각이나 세션 ID 하나만으로 최신 상태를 선택하지 않습니다. 목표 및 이전 값과 일치하지 않는 다른 세션·영수증은 원본을 보존하고 전송을 차단합니다. 구버전에서 증명할 수 없는 불일치도 자동으로 덮어쓰지 않습니다.
- `migrationParts: { collection?: SHA256, visitDelivery?: SHA256, behaviorDelivery?: SHA256 }`: 검증한 이전 checkpoint의 키별 해시입니다. 기존 전체 `migrated` 해시는 유지합니다. 본문을 중복 저장하거나 새 Object Store를 만들지 않습니다.

Collector·POST·PATCH·activeSession·이전 mirror 증거는 기존 하나의 strict 트랜잭션/revision 비교로 저장합니다. transaction complete 후 local mirror를 갱신하며 HTTP는 DB 트랜잭션 밖에 있습니다. IDB 실패와 **commit 이후 local mirror 실패**를 별도 오류로 구분합니다. 후자는 완료된 종료·ACK를 다시 중단 상태로 덮어쓰지 않으며, delivery는 commit된 ACK를 그대로 사용할 수 있습니다. 사용자 작업에서 활성 mirror 갱신이 실패하면 그 실행의 수집을 보류하지만 디스크의 성공 checkpoint는 유지합니다. 다음 실행에서 증거를 대조해 복구합니다. 종료 commit의 목표가 없는 세션이면 수집을 되살리지 않고 local 삭제만 재시도합니다. 미확인 POST/PATCH가 남으면 신규 시작은 계속 차단합니다.

`pendingSessionStart`는 HTTP 전에 키를 저장하고 응답 영수증도 활성 집계 commit 전에 기록하는 순서를 유지합니다. 응답 영수증 저장 실패 후에도 이전 키로 같은 요청을 재시도합니다. IDB에 같은 키·목표·서버 주소·서버 응답의 활성 완료 영수증이 있고 Collector 세션도 일치할 때만 남은 pending 키를 완료 후 정리 잔여물로 판단합니다. 손상·다른 응답·다른 키·서버 변경은 이 경로로 우회하지 않습니다. 영속화에 실패한 HTTP ACK는 여전히 미확인이며 메모리 ACK로 PATCH를 허용하지 않습니다.

#### 마이그레이션 중단·재실행

- commit 전 abort: 완료 표식과 집계 모두 기록되지 않으므로 원본으로 재시도합니다.
- commit 후 정리 전 중단: 전체 해시/키별 해시가 일치하는 원본은 다시 적용하지 않습니다. 현재 IDB가 이미 진전했어도 원래 스냅샷·ACK·시도 횟수를 되돌리지 않습니다.
- 일부 키만 남음: 남아 있는 각 키의 해시가 이전에 commit한 receipt와 일치해야 정리 잔여물로 인정합니다. receipt 없는 불완전 초기 입력이나 달라진 세션·API·ACK는 보존하고 차단합니다.
- 구버전 전체 해시만 있음: 현재의 완전한 세 checkpoint로 원래 해시를 재구성할 수 있거나 완전한 이전 원본이 남아 있을 때만 키별 receipt를 복원합니다. 복원한 receipt는 **키 삭제 전에 먼저 commit**합니다. 이미 IDB가 진전했고 일부 legacy 키만 남아 원래 해시를 재구성할 수 없으면 보수적으로 차단합니다.
- 전체 legacy 본문과 IDB 본문을 별도로 검증합니다. 해시 일치만으로 손상된 집계를 승인하지 않습니다. 정리 오류 자체는 `legacyCleanupPending`으로 표시하며 정상 IDB를 손상으로 처리하지 않습니다. 다음 Worker 초기화에서 정리를 다시 시도합니다.

#### Collector 정책과 Popup

`docs/data-collection-spec.md` §6의 확정 prefix 정책을 변경하지 않았습니다. 앞선 `recoveryRequired` 후보가 미확정이면 이후 정상 B도 `sequence:null`이며 POST가 지연됩니다. 이 동작은 결함으로 수정하지 않았습니다. 유효했던 분리 A는 명시적 로컬 종료에서 마지막 영속 활성시간·버전·ID로 확정하여 A/B 순서를 풀 수 있습니다. 본문 없는 pending 및 복구 가능한 `unavailable-content` 후보는 종료 후에도 임의 판정하지 않습니다. 이미 확정된 방문은 ID·sequence를 유지하며 중복 POST를 만들지 않습니다.

Popup은 확인 필요 후보 수, 순서 미확정 유효 방문 수와 대기 이유, 종료로 해결 가능한 유효 후보 수, 종료로 해결되지 않는 후보 수를 표시합니다. 로컬 삭제 시 대기 방문·미확인 요청도 버려지고 서버 데이터는 지워지지 않음을 설명합니다. local mirror 동기화 대기와 legacy 정리 대기는 IDB 저장 실패/서버 HTTP 실패와 구분합니다. 원문 URL·본문·검색어를 일반 화면에 추가하지 않았습니다.

#### 이번 보완 검증

- 기준 **20개 파일 / 581개** 유지, `durable-state.test.ts` **15개**, `durable-background.test.ts` **13개** 추가: 최종 **20개 파일 / 609개** 통과. 기존 테스트를 삭제하거나 완화하지 않았습니다. A-1 local set 실패, A-2 local remove 실패, A-3 commit 직후 중단, A-4 응답 영수증 실패, POST ACK와 PATCH 스냅샷 보존, 부분 legacy 정리·반복 이전·충돌·손상, 네 종류 Collector prefix 정책을 검증했습니다.
- local 실패, commit 중 abort/quota, 마이그레이션 중단은 **제어된 Chrome 어댑터 + fake-indexeddb** 검증입니다. 실제 디스크 고갈이나 Chrome 저장소 장애 실험으로 표현하지 않습니다.
- `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` 통과. BE는 `./gradlew test --rerun-tasks`로 **13 suite / 328개**를 실제 재실행해 통과했고 `bootJar`도 성공했습니다. BE 소스·스키마는 수정하지 않았습니다.
- 실제 Chrome for Testing **151.0.7922.34**의 기존 `test:browser` 통과. 이 스크립트의 API/검색 페이지는 합성 fixture이며 native 다중 창·최소화는 headless에서 SKIP입니다.
- 실제 Chrome → Spring Boot **4.1.1** → 전용 임시 MySQL **8.4.9**에서 기존 visit 통합 전체 통과: 6개 방문/2개 Window, 중복 200 및 SQL 불변, 세션 A/B 분리, 서버 저장 후 응답 보류·Worker 종료·같은 요청 재전송, 로컬 종료 후 미전송 유지, 3회 소진·수동 재시도, 지연 ACK 삭제 경합, 본문 길이 계약.
- behavior 통합은 기존 전체 시나리오와 추가 REVIEW-C를 실행했습니다. 실제 POST/PATCH 저장 후 응답만 보류한 Worker/브라우저 재시작 및 reload, 동일 요청·ID·버전·시도 복원, 재시도 3회·수동 예산, SQL 중복/최신값 보호를 확인했습니다. 브라우저 종료는 전용 browser PID SIGKILL 후 같은 프로필 재실행이며 Worker 중단으로 대체하지 않았습니다. reload는 실제 `runtime.reload()`와 session 표식 소실을 확인했습니다. 503 오류는 테스트 프록시의 명시적 주입이며 BE 오류와 구분합니다.
- 추가 실제 Collector 검증: 브라우저 재시작 후 pending A 뒤의 새 유효 B를 수집해 sequence/POST 보류 및 Popup 설명을 확인했습니다. 별도로 유효 A를 저장한 뒤 완전 재시작, 새 B 수집, 명시적 종료에서 원래 ID/저장 누적값과 sequence 1·2를 유지하며 실제 SQL/ACK에 도달함을 확인했습니다. 정상 경로의 IDB/local 메타데이터도 대조했습니다.
- 추가 통합 초기 실행에서는 강제 종료 후 테스트 프로필 개발자 모드가 소실되어 후속 reload가 실패했습니다. 재실행 시 `getProfileConfiguration()`으로 꺼진 것을 확인했습니다. 스크립트가 매 브라우저 실행에서 전용 프로필의 개발자 모드를 확인·설정하도록 고쳤으며 reload 확인 조건은 유지했습니다. 이 실패를 제품 복구 성공으로 세지 않습니다.

검증용 BE PID·전용 MySQL 컨테이너와 연결된 익명 볼륨·각 Chrome 임시 프로필은 종료 후 정리했습니다. 기존 사용자 DB/프로필은 변경하지 않았습니다.

미검증 범위는 실제 local/IDB 디스크 장애·전원 상실, Windows/Chrome 최소 버전, native 다중 창·OS 포커스, 새 upstream 알림 이력 변경을 합친 BE입니다. 중단 직전 commit되지 않은 이벤트·중단 중 행동은 복구할 수 없습니다. 구버전 receipt만으로 원본을 증명할 수 없는 충돌의 운영자 복구, 미결 후보 판정/재연결과 장기간 sequence 대기는 후속 정책 협의가 필요합니다. 서버 종료 API·END_PENDING은 구현하지 않았으며 후속 종료 작업은 미확인 POST/PATCH와 후보 보류를 먼저 고려해야 합니다.


### Git 기준과 기존 저장 흐름

시작 상태는 detached HEAD `f73e08636892f22eca36f347c46cfe0a34e5612c`, 미커밋·미추적 파일 없음입니다. `origin`은 `hyeon-marina` fork, `upstream`은 `SKHU-AI-Projects-Archive` 공식 저장소입니다. fetch한 `upstream/main`은 `6059729ca837135a2ab84164fb261165118d5645`이며 PR #47 병합 및 실제 Issue #48을 확인했습니다. 이 커밋에서 `feat/48/indexeddb-durable-queue`를 생성했습니다. 저장소에 별도 AGENTS/브랜치 규칙 문서는 없었으며 기존 `feat/이슈번호/설명`, `feat(#번호): ...` 이력을 참고했습니다. 최초 구현·검증 단계에서는 커밋·푸시·PR을 생성하지 않았습니다.

기존 `Collector`는 후보 생성 순서, 방문 ID, 유효·제외·보류 판정, sequence 확정, 활성시간과 전환 횟수·행동 버전을 메모리에서 관리했습니다. Background는 Collector와 POST/PATCH checkpoint를 한 번의 `chrome.storage.session.set`에 기록했습니다. `storage.local`은 세션 생성 멱등 키·응답인 `pendingSessionStart` 및 `activeSession/startRequest/interrupted`만 보존했습니다. 순차 전송과 HTTP 전에 저장을 기다리는 구조는 이미 있었지만 브라우저 재시작·확장 reload에서 session 저장이 사라지고, ACK 저장 실패 후 메모리에 남은 ACK가 잘못 사용될 위험이 있었습니다.

| 정보 | 이전 저장소 | 현재 역할 |
| --- | --- | --- |
| 활성 서버 세션·세션 생성 요청 키·응답·중단 기록 | local | local 프로토콜 유지; 활성 세션 메타데이터는 IDB 집계에도 함께 기록·대조 |
| 후보·확정 방문·판정·탭 연결·ID·sequence 할당 상태 | session | IndexedDB `collection` |
| 최초 POST 스냅샷·단계·시도·시각·오류·ACK·서버 baseline | session | IndexedDB `visitDelivery` |
| 최초/최신 행동값·마지막 ACK·불변 PATCH 스냅샷·행동 버전·재시도 | session | IndexedDB `behaviorDelivery` |
| 권한 철회·로컬 삭제 | 메모리와 session 정리 | 세 큐를 함께 비우는 IDB commit; 최소 revision/이전 표식만 유지 |
| Chrome session 저장소 | Worker 복구 checkpoint | 구버전 데이터 읽기·이전·정리만 수행. 새 checkpoint는 쓰지 않음 |

### 데이터 모델과 세션 격리

DB 이름 `focus-recovery`, 버전 **1**, Object Store **`state` 하나**, Out-of-line key **`current` 하나**입니다.

```text
current = {
  format: 1, revision, sessionId: UUID | null,
  migrated?: SHA256(기존 collection/POST/PATCH의 canonical JSON),
  migrationParts?: { collection?: SHA256, visitDelivery?: SHA256, behaviorDelivery?: SHA256 },
  value: { collection, visitDelivery?, behaviorDelivery?, activeSession?, localMirror?: { previous? } }
}
```

Collector의 전체 bounded 상태(기존 최대 200개 후보)를 집계로 저장하므로 후보 확정과 sequence 할당이 부분 기록되지 않습니다. POST에는 최초 `visit`, 단계·attempts·nextRetryAt·error/code·retryable·`serverBehavior`를, PATCH에는 `initial/latest/ack/request`, 버전·단계·재시도 정보를 보존합니다. URL·본문은 별도 로그에 기록하지 않습니다.

여러 세션의 큐를 섞거나 임의로 최신 세션을 선택하지 않습니다. 루트 `sessionId`, Collector, 후보, POST, PATCH 및 세션 메타데이터를 대조합니다. sequence는 유효한 확정 prefix에서 연속적이어야 하고, POST 원본의 불변 필드·초기 행동값이 Collector와 일치해야 합니다. 확정 방문이 있는데 POST checkpoint가 없거나, POST가 있는데 PATCH checkpoint/항목이 빠졌으면 빈 큐로 추정하지 않고 차단합니다. 이전 세션에 미확인 POST/PATCH 또는 확인 필요 후보가 있으면 신규 세션을 차단합니다. 정상 완료 후 명시적인 다음 세션 시작에서만 전체 집계를 새 세션으로 교체하므로 이전 완료 세션의 본문·ACK가 무한히 누적되지 않습니다.

`format`과 DB 버전을 검증하고 `versionchange`에서 연결을 닫습니다. 현재 정의된 스키마는 v1뿐입니다. 알 수 없는 미래 DB/레코드 버전을 삭제하거나 빈 상태로 덮어쓰지 않습니다. 후속 v2는 별도의 명시적인 업그레이드 변환과 테스트가 필요합니다.

### 트랜잭션과 HTTP 경계

`DurableRepository`가 단일 집계 레코드 전체를 짧은 `readwrite` 트랜잭션으로 기록합니다. `durability: 'strict'`를 요청하고 **request의 success가 아닌 transaction complete**를 기다립니다. 같은 트랜잭션에서 이전 revision을 읽어 비교하므로 삭제·세션 교체 전 상태를 가진 오래된 Worker의 쓰기는 abort됩니다. HTTP를 트랜잭션에 넣지 않습니다.

- POST: 확정 방문 → 최초 스냅샷 등록 → `sending/attempts`와 Collector·PATCH 상태 commit → HTTP → 기존 201/200 계약 검증 → POST ACK·서버 행동 baseline·PATCH baseline을 함께 commit → 다음 sequence.
- PATCH: **commit된 POST ACK 집합** 확인 → 최신 Collector 비교 → 최초 `request`/버전과 `sending/attempts` commit → HTTP → 기존 `applied=true/false` 검증 → 행동 ACK commit → 후속 변경이 있으면 다음 스냅샷.
- 저장 실패 시 마지막 commit 집계로 메모리를 되돌리고 수집·전송을 차단합니다. 저장하지 못한 ACK를 복구된 ACK로 표시하거나 PATCH 허용에 사용하지 않습니다. raw 오류 메시지는 UI/로그에 노출하지 않습니다.
- 서버 저장과 로컬 ACK commit은 원자적일 수 없습니다. 서버 저장 후 ACK 유실 또는 commit 실패 시, 디스크의 `sending`과 동일 ID·sequence·스냅샷·버전으로 재전송합니다. 재전송이 실제 서버 저장을 중복 적용하지 않는 것은 기존 BE 멱등 계약으로 확인합니다.

기존 `serialExecutor`로 초기화 후 이벤트·상태 변경·commit만 직렬화합니다. POST/PATCH HTTP 응답 대기는 이 실행기 밖이므로 느린 요청 중에도 수집·종료·삭제 이벤트가 처리됩니다. 초기화 중 Popup·Content Script·탭 이벤트는 준비 Promise 뒤에서 처리되고, Popup은 응답 전 초기화 중으로 표시합니다.

### Collector 복구

Worker 시작 시 전체 후보·판정·확정 여부·ID·sequence·누적 행동값과 버전을 복원합니다. 모든 `activeSince`를 해제하여 중단 기간을 더하지 않고, Chrome `webNavigation.getFrame`의 실제 문서 ID와 URL 식별자·권한을 저장된 탭 연결과 대조합니다. 같은 tabId나 URL만으로 동일 문서라고 간주하지 않습니다.

동일 문서가 확인되면 기존 후보에 다시 연결하고 실제 foreground 이벤트/조회 이후부터 측정합니다. `onInstalled`(unpacked reload 포함)와 `onStartup`에서 활성 세션의 허용 사이트 스크립트를 다시 등록·주입합니다. Extension reload가 무효화한 기존 isolated world만 믿고 수집이 멈추는 일을 막으며, 살아 있는 문서는 기존 후보로 연결합니다. 확인되지 않으면 탭 연결을 해제하고 열린 후보에 `recoveryRequired`를 표시합니다. **복구 자체는 visitId나 이미 확정된 sequence를 변경하지 않으며, 순서가 미확정인 후보도 그대로 둡니다.** 제외된 후보를 유효 방문으로 승격하지 않습니다.

사용자의 명시적 로컬 수집 종료에서는 이미 유효했던 분리 후보를 저장된 누적값 그대로 확정할 수 있습니다. 이는 기존 종료 시 유효 방문을 확정하는 정책의 복구 적용입니다. 판정 미완료·복구 가능한 제외 후보는 임의로 유효/최종 제외 처리하지 않고 보존하며 뒤 후보의 sequence를 막습니다. 이 상태에서는 신규 세션을 만들 수 없고 확인 후 명시적으로 로컬 데이터를 삭제해야 합니다. 수동으로 임의 탭에 재연결하거나 부족한 체류시간을 추정하는 UI는 제공하지 않습니다.

### 이전 저장소 마이그레이션

1. local 요청 키·세션 메타데이터와 session의 세 checkpoint를 읽습니다. IndexedDB가 비었으면 Collector·ID·sequence·POST/PATCH 관계·API 주소·메타데이터를 검증한 후 데이터와 이전 원본 해시를 한 번에 commit합니다.
2. 검증·복구가 정상인 경우에만 이전 session 키 세 개를 제거합니다. local의 미확인 세션 생성 요청은 기존 성공 checkpoint/metadata 저장 절차가 끝난 뒤에만 정리합니다.
3. 이전 commit 전 중단이면 원본이 남고, commit 후 정리 전 중단이면 원본 해시가 완료 표식이므로 다시 가져오지 않습니다. 이후 IDB가 진전해도 동일 이전 원본은 재적용하지 않습니다.
4. 양쪽이 같은 값이면 기존 IDB를 사용합니다. 값이 다르고 완료 표식도 없다면 timestamp만으로 최신성을 추정하지 않습니다. IDB가 오래되었거나 legacy가 더 최신일 가능성, 서로 다른 세션, 손상 데이터는 양쪽 원본을 보존하고 복구·HTTP를 차단합니다.
5. IDB가 정상이고 session 저장만 사라졌으면 IDB를 사용합니다. 아직 IDB로 이전하지 않은 구버전 session 데이터가 이미 브라우저 종료/reload로 사라진 경우에는 이를 복원할 수 없습니다. local 세션 생성 영수증은 보존해 새 키로 중복 생성하지 않습니다.

local과 IDB는 서로 다른 저장소이므로 하나의 트랜잭션이 아닙니다. commit된 IDB 활성 메타데이터를 기준으로 같은 요청 키·세션임을 대조하며, local 값이 commit된 목표/이전 mirror 증거와 일치하는지 대조합니다. 증거로 이전 값임을 확인할 수 없는 같은 세션의 local `interrupted` 표식은 보수적으로 중단/동일 요청 재개에 반영합니다. 반대로 IDB의 명시적 종료 commit 뒤 남은 이전 local 메타데이터가 수집을 되살리지 않습니다. 두 저장소 모두 쓰기 불가능한 동안의 중단 사실은 영속 기록할 수 없으며 다음 시작은 마지막 성공 checkpoint와 실제 Chrome 상태로 판단합니다.

### 재시작과 재시도

저장된 `sending`만 `queued`로 복구하며 스냅샷·버전·attempts는 유지합니다. `retry-wait`는 저장된 `nextRetryAt`과 현재 시각을 비교합니다. 최초 포함 자동 최대 **3회**이며 Worker·브라우저 재시작/reload로 예산을 초기화하지 않습니다. 소진 시 마지막 요청이 서버에 반영되었을 수 있음을 표시하고 실패·수동 재시도 상태로 보존합니다. 명시적인 같은 요청 재시도만 기존 스냅샷에 새 예산을 허용합니다. ACK가 commit된 후 생기는 새로운 행동 요청은 별도 예산입니다.

Manifest에 `alarms` 권한을 추가했습니다. 매 Worker 시작 시 1분 반복 알람을 다시 생성하고, `onAlarm`, `onStartup`, `onInstalled` 및 일반 확장 이벤트에서 저장 상태를 확인합니다. 정상 초기화 후에는 Popup 없이도 기존 큐를 깨웁니다. 메모리 타이머는 Worker가 살아 있는 동안 짧은 backoff만 지원합니다. [Chrome alarms 문서](https://developer.chrome.com/docs/extensions/reference/api/alarms)에 따라 알람은 지연될 수 있고 장치 절전에서 기기를 깨우지 않습니다. 구버전 Chrome에서는 재시작 때 소실될 수 있어 시작 때 재생성합니다. 실시간 재개·정확한 1분 실행을 보장하지 않습니다.

### 삭제·오류·보존과 개인정보

로컬 수집 종료는 미전송 데이터와 ACK를 디스크에 남깁니다. session 저장과 달리 브라우저 종료/reload로 자동 삭제되지 않습니다. 임의의 장기 보존 기간은 도입하지 않았습니다. 명시적 로컬 기록 삭제 또는 사이트 권한 철회에서 Collector·POST·PATCH를 함께 비우고 commit합니다. 삭제된 항목의 객체 소속 검사와 revision 비교로 지연된 ACK나 오래된 쓰기가 원본을 재생성하지 못합니다. 이미 발송된 HTTP는 서버에 저장될 수 있으며 로컬 삭제는 서버 기록을 삭제하지 않습니다. 미확인 세션 생성 요청 키/영수증은 중복 생성을 막기 위한 기존 정책에 따라 샘플 삭제와 별도로 보존합니다.

열기 실패·quota·transaction abort·손상·마이그레이션 충돌·세션 불일치·API 주소 변경은 빈 정상 상태로 대체하지 않습니다. Popup은 영속 저장/복구 실패를 서버 HTTP 실패와 구분해 표시하고 신규 시작·수동 전송을 차단합니다. 원본을 유지한 채 Worker/서버 설정을 확인해야 하며, 손상된 요청 영수증을 삭제로 우회하는 기능은 제공하지 않습니다. 디스크 삭제 commit 자체가 실패하면 삭제 완료로 표시하지 않으며 재시작 후 이전 원본이 남을 수 있습니다.

일반 Popup에는 건수·단계·시도·버전·확인 필요 상태만 표시하고 URL·본문·검색어 원문은 기존 명시적인 개발용 데이터 표시 선택에서만 보여줍니다. 방문 원문·검색어는 IDB 디스크와 설정된 BE에 보존되므로 실제 개인정보가 있는 사이트는 권한과 삭제 정책을 확인해야 합니다. 오류 로그에는 이 원문과 플랫폼 오류 원문을 남기지 않습니다. 삭제 후에도 브라우저/OS의 물리적 디스크 영역에 대한 보안 삭제까지 보장하는 것은 아닙니다.

### 변경 파일과 검증 방법

- `src/background/durable-state.ts`: v1 저장 어댑터, 집계 검증, commit 대기, revision 비교, 이전 표식과 충돌 차단.
- `src/background/index.ts`: 초기화 장벽, IDB commit 연결, commit된 POST ACK 허용, 실제 문서 대조, local 영수증 정합성, 삭제와 alarms 이벤트.
- `src/background/collector.ts`, `src/shared/types.ts`: 확인 필요 후보와 명시적 종료에서의 유효 분리 후보 처리, Popup 저장 상태 타입.
- `src/background/visit-delivery.ts`, `behavior-delivery.ts`: 기존 전송·재시도 구현 유지; 폐기된 session-only 주석만 제거.
- `src/popup/index.tsx`, `public/manifest.json`: 복구/저장 오류/보류 표시와 작업 차단, alarms 권한.
- `tests/durable-state.test.ts`, `durable-background.test.ts`: 실제 fake-indexeddb transaction/abort 및 실제 Background+IDB 연결 테스트. quota는 DOMException 주입이며 실제 디스크 고갈 시험이 아닙니다.
- `tests/background.test.ts`: 기존 Chrome adapter 회귀 133개 유지, 저장소 모의 경계만 Repository로 옮겼습니다. 영속 저장 실패 뒤 재시작이 필요한 정책 및 실제 문서 조회 모의를 반영했습니다. 이 파일 단독으로 실제 IDB 검증을 주장하지 않습니다.
- `scripts/durable-test-utils.mjs`, 기존 browser/visit/behavior/live-search 스크립트: session mirror 대신 commit된 IDB 읽기, 실제 transaction abort 주입, 브라우저 전체 종료/동일 프로필 재실행 및 extension reload 검증.
- `package.json`, `package-lock.json`: 테스트 전용 `fake-indexeddb` 추가. 런타임 의존성은 추가하지 않았습니다.

```sh
cd fe
npm run typecheck
npm test
npm run build
git diff --check
CHROMIUM_PATH="/absolute/path/to/Chrome for Testing" npm run test:browser
INTEGRATION_API_BASE_URL=http://localhost:18048 \
INTEGRATION_MYSQL_CONTAINER=전용임시MySQL \
CHROMIUM_PATH="/absolute/path/to/Chrome for Testing" \
node scripts/behavior-integration-test.mjs
# 같은 환경으로 node scripts/visit-integration-test.mjs
```

통합 스크립트는 비밀번호 없는 root로 접근 가능한 **개인정보 없는 전용 임시 DB**만 대상으로 합니다. 기존 운영/개발 DB를 사용하지 마세요. `behavior-integration-test.mjs`는 전용 Chrome 임시 프로필에서만 개발자 모드를 활성화하고 실제 `runtime.reload()`와 session 표식 소실을 검증합니다. CLI로 로드한 unpacked 확장은 개발자 모드가 꺼져 있으면 최초 실행은 되더라도 reload 때 `unsupportedDeveloperExtension`으로 비활성화될 수 있습니다. 프록시는 실제 BE가 저장한 응답만 보류하며, 명시적으로 주입한 503 횟수를 실제 BE 오류와 구분합니다.

### 이번 실행 결과와 남은 범위

- 변경 전 **18개 파일 / 535개**, 최종 **20개 파일 / 581개** 성공. 기존 535개 회귀를 유지하고 Repository 31개·실제 Background+IDB 15개, 총 46개를 추가했습니다. 타입 검사·production build·`git diff --check`도 통과했습니다. 저장 전 HTTP 차단, POST/PATCH ACK commit 실패와 동일 스냅샷 복구, quota/abort, 버전 거부, 중복 초기화, 원본 보존·이전 재실행·충돌, 문서 식별자 불일치, 재시도 시각/alarm, 삭제·권한 철회 경합을 검증했습니다.
- 변경하지 않은 BE는 Java **21.0.10**, Spring Boot **4.1.1**에서 Gradle **13개 suite / 328개 테스트** 및 bootJar 빌드 성공. 임시 MySQL의 실제 버전은 **8.4.9**입니다.
- macOS Chrome for Testing **151.0.7922.34**에서 기존 `browser-test.mjs` 회귀 성공. 합성 API·Google/Naver fixture이며 실제 서비스 증거와 구분합니다. checkpoint 오류는 실제 IDB `put` 성공 뒤 transaction abort를 주입했습니다. native 다중 창/최소화 경로는 기본 headless 실행에서 `SKIP`이며 성공으로 세지 않습니다.
- 기존 `visit-integration-test.mjs` 실제 Chrome → Spring Boot → MySQL 회귀 성공. 6개 방문과 2개 Window 구성·중복 방지, A/B 세션 분리, 전송 중 종료/삭제, POST 응답 유실·동일 재전송 200, 3회 재시도 소진·수동 재시도, 본문 길이 경계를 확인했습니다. 프록시 503은 합성 주입이며 실제 BE 장애로 보고하지 않습니다.
- 확장한 `behavior-integration-test.mjs` 전체 성공. B-1 정상/보류 POST ACK, B-2 세 번째 PATCH 중단, B-3 반복 Worker 중단과 예산 소진·명시적 재시도, D-1 실제 Chrome 전체 프로세스 종료/동일 프로필 재실행, D-2 실제 extension reload, D-3 브라우저 반복 재실행 후 예산 3회 유지까지 통과했습니다. 실제 PATCH `applied=true` 저장 뒤 응답만 보류하고 재전송 `applied=false`, MySQL 계수·버전·`updated_at` 불변 및 실제 409 계약을 검증했습니다.
- D-POST-browser/reload: 실제 BE의 방문 저장 완료 뒤 201 응답만 보류 → 브라우저 전체 종료 또는 extension reload → 동일 ID·sequence·본문·초기 행동 스냅샷과 attempts 복구 → 200 멱등 응답 → SQL 방문 행 1개를 확인했습니다. POST ACK 전 PATCH 대기도 확인했습니다.
- D-LIVE: 실제 extension reload 후 살아 있는 동일 문서에 Content Script가 다시 연결되고, 원래 visitId가 1개로 유지되며 이후 실제 SPA 콘텐츠 변경이 새 방문으로 수집·ACK되는 것을 확인했습니다.
- D-COLLECTOR: 열린 짧은 후보와 그 뒤의 유효하지만 sequence 미확정인 후보를 만들고, 실제 reload와 브라우저 전체 종료를 수행했습니다. 원래 후보 순서·ID·sequence·버전·활성시간을 보존하고 문서 불일치 후보를 확인 필요로 유지하며 신규 시작 차단·명시적 디스크 삭제를 확인했습니다. 테스트가 새 Popup 탭을 여는 과정의 추가 URL-policy 제외 후보는 원래 후보와 구분해 검증합니다.
- 브라우저 전체 종료의 최종 검증은 CDP로 **테스트가 만든 전용 browser PID만 확인하여 SIGKILL**한 뒤 같은 임시 프로필로 재실행했습니다. Worker만 재시작한 결과로 대체하지 않았습니다. 초기 graceful close 실험에서는 종료 직전 탭 이벤트가 commit되어 마지막 사전 snapshot과 달라질 수 있었습니다. 최종 시험은 이 flush를 배제한 강제 종료로 후보 checkpoint 보존을 확인했습니다. Extension reload는 실제 `runtime.reload()` 후 `storage.session`의 시험 표식이 사라졌는지 검사했습니다.
- 검증용 BE·MySQL 컨테이너·Chrome 프로필은 테스트 종료 후 정리했습니다. 실제 사용자 데이터나 기존 DB/Chrome 프로필은 사용하지 않았습니다.

Windows 11 Chrome Stable, 최소 지원 Chrome 106, 실제 Google/Naver 서비스 DOM, native 창 최소화/OS 포커스 경계, 실제 디스크 용량 고갈·전원 상실·디스크 손상은 이번에 실행 검증하지 않았습니다. quota는 주입 오류 시험입니다. 브라우저/OS의 저장소 삭제·확장 제거 이후 데이터 복원은 제공하지 않습니다. **종료 직전 commit되지 않은 이벤트와 마지막 성공 checkpoint 뒤 실제 행동·중단 중 사용자 행동은 복구할 수 없습니다.** 알람의 정확한 실행 시각과 장치 절전 중 즉시 전송도 보장하지 않습니다. 로컬·IDB에 충돌한 원본을 자동 병합하는 운영자 복구 UI와 미확인 후보의 수동 재연결은 후속 검토입니다.

서버 세션 종료 API·END_PENDING 전체 처리, AI/목표 복귀 알림·내보내기/라벨링은 구현하지 않았습니다. 후속 서버 종료 Issue는 이 영속 큐의 미확인 POST/PATCH와 확인 필요 후보가 해결되기 전 서버 종료를 완료로 처리하지 않아야 하며, 서버 ACK와 로컬 종료 commit을 구분해 END_PENDING 복구를 설계해야 합니다. 기존 활성 10초 분석 시점·본문 길이 FE code point/BE UTF-16 차이는 이번 저장소 변경으로 해결되지 않으며 기존 방문 판정 자체는 변경하지 않습니다.

---

# Focus Recovery Chrome Extension (Issue #9·21·32·34·43·46 / FE-001·002·004~007)

Manifest V3 기반 개발용 페이지 수집기입니다. React popup의 목표로 Background Service Worker가 Spring Boot `POST /api/sessions`를 호출하고, 검증된 서버 세션으로 수집을 시작합니다. 확정된 유효 방문·본문·초기 행동 정보는 `POST /api/sessions/{sessionId}/visits`로 저장하고 응답을 검증합니다. POST ACK 이후 달라진 누적 행동 정보는 행동 PATCH로 갱신합니다. AI 결과 조회는 아직 구현하지 않습니다. **로컬 수집 종료는 서버 종료가 아니며 서버 세션은 ACTIVE로 남을 수 있습니다.**

## 행동 갱신 PATCH 및 ACK (Issue #46)

작업 시작 상태는 detached HEAD `f73e08636892f22eca36f347c46cfe0a34e5612c`, 미커밋/미추적 파일 없음이었습니다. `origin`은 `hyeon-marina` fork, `upstream`은 공식 `SKHU-AI-Projects-Archive` 저장소입니다. fetch로 확인한 최신 `upstream/main` 및 PR #45 병합 커밋 `2b13e0533c9a4d70f40b566345e375224f091136`에서 `feat/46/visit-behavior-api-integration`을 생성했습니다. #32·#34·#43 구현을 포함합니다.

### 전체 흐름과 변경 파일

`Collector.readyVisits` → `VisitDelivery` 최초 POST 스냅샷 등록 → 순차 POST → 응답 검증 → POST ACK와 서버 행동 baseline 저장 → `BehaviorDelivery`의 최신 누적값 비교 → PATCH 스냅샷 checkpoint 저장 → HTTP → 응답 검증 → 행동 ACK 저장입니다. Content Script는 API에 접근하지 않습니다.

- `src/api/types.ts`, `src/api/behavior.ts`: BE `UpdateVisitBehaviorRequest`/`VisitBehaviorResponse` 계약과 검증. PATCH는 경로에 세션·방문 ID를 넣고, 본문에는 `activeDurationMs`, `tabSwitchCount`, `behaviorVersion`만 허용합니다. 원본 URL·본문·검색어·세션 생성용 멱등 키는 넣지 않습니다. 공통 API 주소·10초 timeout·안전한 방문 오류 타입·UTC 검증을 재사용합니다. 기존 세션 POST 클라이언트는 바꾸지 않습니다.
- `src/background/visit-delivery.ts`: 원본 `visit`은 유지하고 검증된 POST 응답의 `serverBehavior`만 별도 저장합니다. 재전송 200에서 이미 높은 서버 버전이 돌아와도 그 실제 값을 baseline으로 사용합니다. 기존 checkpoint의 이 필드가 없으면 POST 초기값을 baseline으로 사용하며, 다음 PATCH 응답에서 현재 서버값을 검증합니다.
- `src/background/behavior-delivery.ts`: 최초값 `initial`, 최신 Collector 값 `latest`, 마지막 서버 확인 `ack`, 변경 불가능한 요청 `request`, 전송 단계·시도·오류·재시도 시각을 별도로 관리합니다. POST와 별도 `behaviorDelivery` checkpoint이며 본문은 중복 저장하지 않습니다.
- `src/background/index.ts`: 같은 직렬 실행기로 상태 수집·checkpoint 쓰기만 처리합니다. POST/PATCH HTTP 대기는 실행기 밖이므로 느린 네트워크가 Collector 이벤트를 막지 않습니다. POST ACK의 저장 완료 후 PATCH를 깨우고, 실제 전송 직전에도 POST ACK·세션 복구 상태를 재확인합니다. Collector·active-time·serial의 측정/순서 정책은 수정하지 않습니다.
- `src/shared/types.ts`, `src/shared/messages.ts`, `src/popup/index.tsx`: POST 저장과 행동 갱신 건수·미확인 단계·버전·안전한 오류·재시도 가능 여부를 구분하고 `retry-behaviors` 명시적 재시도를 제공합니다. 일반 화면에 방문 원문은 노출하지 않습니다.
- `tests/behavior-api.test.ts`, `tests/behavior-delivery.test.ts`, `tests/background.test.ts`: API 계약, 순서·동시 변경·재시도·복원·종료·삭제를 검증합니다. 기존 종료/복원 테스트는 Collector 전체 동일성 검증을 유지하고 새 비동기 행동 상태는 별도 ACK 검증을 추가했습니다. storage mock은 실제 Chrome처럼 배열 키 삭제도 지원하도록 보완했습니다.
- `scripts/visit-test-proxy.mjs`, `scripts/behavior-integration-test.mjs`: 실제 BE 저장 후 PATCH 응답만 보류할 수 있는 전용 테스트 전송기와 Chrome/SQL 시나리오입니다. 기존 POST 통합 스크립트는 변경된 Popup 삭제 경고 문구만 맞췄습니다.

### 전송 시점·병합·버전 정합성

새 동기화 주기나 반복 타이머는 추가하지 않습니다. 기존 Collector의 탐색·탭 닫기·전환·포커스·상태 정산·로컬 종료 이벤트에서 확정된 `readyVisits` 누적값을 읽습니다. 값이 POST baseline 또는 ACK와 같으면 PATCH하지 않습니다. 아직 요청을 시작하지 않은 변경은 최신값으로 합칩니다. 전송 중 변경은 `latest`만 바꾸고 기존 `request`는 유지하며, 현재 요청 ACK 후 최신값으로 후속 PATCH를 만듭니다. PATCH 전송기는 전체에서 한 HTTP 요청씩 처리하므로 동일 방문의 동시 PATCH나 응답 역전이 없습니다. 한 방문의 실패/재시도 대기는 다른 방문의 준비된 갱신을 막지 않습니다.

버전은 Collector가 양의 시간 정산/전환 횟수 증가마다 올린 값 그대로 사용합니다. 전송 계층은 버전을 생성하거나 값을 보정하지 않습니다. ACK는 응답이 요청과 동일하거나, 더 높은 버전이면서 두 누적값 모두 크거나 같은 경우에만 인정합니다. 마지막 ACK보다 낮은 응답으로 ACK를 후퇴시키지 않습니다. 최신 Collector가 ACK보다 낮은 버전이어도 서버값이 두 누적값을 모두 포함하면 이미 대체된 상태입니다. 같은 버전의 다른 값, 높은 버전의 감소값 또는 낮은 버전인데 큰 누적값 등 호환되지 않는 상태는 확인 필요로 남기고 자동 보정하지 않습니다.

기존 수집 정책상 **열린 방문은 POST하지 않으며 방문 확정 뒤 활성시간도 증가하지 않습니다.** 실제 현재 정책에서 POST 뒤 변경되는 대표 경로는 탭 닫기로 방문이 확정된 후 대체 탭 활성화가 늦게 도착해 해당 방문의 전환 횟수·버전이 증가하는 경우입니다. 활성시간을 포함한 여러 누적값 변경 병합은 전송기/모의 어댑터 테스트로 검증하며, 열린 방문의 체류시간을 주기 PATCH하기 위해 Collector 확정 정책을 변경하지 않습니다.

### 응답·실패·재시도

| 서버 결과 | 처리 |
| --- | --- |
| 200, `applied=true` | visitId·세 안전한 정수 누적값/버전이 요청과 정확히 일치하고 `updatedAt`이 유효한 UTC 밀리초 시각일 때만 ACK. null·필드 누락은 거부 |
| 200, `applied=false`, 같은 버전 | 세 값이 모두 같아야 멱등 ACK. `updatedAt`은 null 또는 유효한 UTC 밀리초 시각 |
| 200, `applied=false`, 높은 버전 | 두 누적값이 요청 이상이어야 더 최신 상태로 대체된 ACK. 최초 POST의 높은 버전을 반환할 수 있으므로 `updatedAt`은 null도 허용하며 누락은 거부. flag만 보고 완료 처리하지 않음 |
| 낮은 응답 버전·동일 버전의 다른 값·더 최신 응답의 감소값·누락/잘못된 필드 | 미확인 실패, 자동/버튼 재시도 없음 |
| 400 `INVALID_REQUEST` | 형식/정수 범위 확인 필요 |
| 404 `SESSION_NOT_FOUND` / `VISIT_NOT_FOUND` | 기존 서버 세션/방문 확인 필요, 새 ID 발급 없음 |
| 409 `BEHAVIOR_VERSION_CONFLICT` / `BEHAVIOR_COUNTER_DECREASED` / `SESSION_ENDED` | 원인 코드 보존, 원본 값·버전 그대로 실패, 보정/재시도 없음 |
| network·10초 timeout·5xx·408·429·성공 JSON 파싱 실패 | POST와 동일하게 최초 포함 최대 3회, 실패 후 1초/2초 대기. 소진 후 버튼으로 동일 스냅샷 재시도 |
| checkpoint 손상/API 주소·POST 의존 관계 불일치/저장 실패 | 완료로 간주하지 않고 차단. 손상된 저장 원본을 정상 빈 checkpoint로 자동 교체하지 않음 |

서버 message/fieldErrors 및 예외 원문은 표시하거나 기록하지 않고 허용한 코드와 정해진 안전한 메시지만 사용합니다. 재시도 중 새 행동이 들어와도 먼저 실패한 요청의 동일 visitId·버전·누적값으로 결과를 확인합니다.

### Worker 복구·로컬 종료·데이터 유실 방지

Collector, POST checkpoint, 행동 checkpoint는 같은 `chrome.storage.session.set`에 보존합니다. HTTP 전에 `sending`과 고정 `request`를 저장합니다. Worker 재시작 시 POST checkpoint와 행동 checkpoint의 방문/세션/순서/초기값/단계/버전을 검증하고 `sending`만 `queued`로 바꿔 동일 요청을 재실행합니다. `retry-wait`의 대기 시각·시도와 `failed`는 유지하며 ACK 완료 요청은 다시 보내지 않습니다. 리뷰 보완 후에는 POST·PATCH 모두 HTTP 시작 전에 저장된 시도 횟수를 확인합니다. Worker 수명과 무관하게 같은 스냅샷의 자동 예산은 최초 포함 3회입니다. `attempts<3`이면 동일 요청으로 남은 예산을 사용하고, `attempts>=3`이면 횟수와 원본을 보존한 `failed`·수동 재시도 가능 상태로 멈춥니다. 요청이 서버에 반영되었을 가능성을 안내하며, 중단 사실만으로 ACK하지 않습니다. 명시적 수동 재시도만 횟수를 0으로 초기화해 같은 스냅샷으로 새 예산을 허용합니다. 실제 ACK 후 새 행동 스냅샷에는 별도 예산이 적용됩니다. 전송 직전 checkpoint에 시도를 먼저 기록하므로 HTTP 발송 직전에 중단되어도 예산이 보수적으로 소모될 수 있습니다.

로컬 종료는 기존 `collector.stop()`으로 활성시간 정산·열린 후보 확정 후 수집만 멈춥니다. 남은 POST는 계속 순차 전송하고 ACK된 방문의 변경값은 PATCH하며 성공 또는 실패를 기록합니다. 종료 응답은 네트워크를 기다리지 않습니다. Popup에서 종료 후에도 상태를 조회·재시도할 수 있고 POST 또는 행동 미확인이 있으면 신규 세션을 차단합니다. 저장 오류가 있으면 화면의 개별 ACK 건수와 별개로 차단 안내가 우선입니다.

명시적 로컬 기록 삭제와 사이트 권한 철회는 두 큐를 함께 지웁니다. 지연된 ACK가 이전 항목을 재생성하지 않도록 현재 큐의 객체 소속을 확인합니다. 이미 발송된 요청은 서버에서 저장될 수 있습니다. 삭제 경고는 최종 행동값 복구 불가 및 서버 데이터 유지도 안내합니다.

`storage.session`은 같은 브라우저 세션의 Worker 중단만 복구합니다. 브라우저 재시작·확장 reload/업데이트·저장 전 종료·저장소 용량 초과의 완전 복구, 장기 자동 깨우기는 보장하지 않습니다. IndexedDB 영속 큐, BE 세션 종료 및 END_PENDING, AI 상태/결과·알림·응답, 데이터셋/라벨링은 후속 작업입니다. BE와 DB 스키마는 변경하지 않았습니다.

### BE 구현과 명세 비교

BE DTO·Service는 누적값/버전과 위 200/400/404/409 규칙을 구현하며, ENDED 세션의 PATCH는 거절합니다. `docs/be-spec.md`·`docs/fe-spec.md`에는 API 경로, 버전 처리, ID 발급 주체 등 일부 항목이 여전히 미확정/미착수로 남아 있습니다. 이번 구현은 Issue #46과 실제 BE 계약을 따르고 공통 명세를 임의 확정하지 않습니다.

`docs/data-collection-spec.md`의 IndexedDB·브라우저 재시작 복구·서버 종료·END_PENDING 요구는 이번 범위에서 미충족입니다. 열린 후보의 순서 확정과 활성 10초 분석 시점 조정도 미해결입니다. BE `AnalysisRequestService`는 10초 미만 페이지 이탈을 식별할 필드가 없어 세션 종료 때 분석을 요청한다고 명시합니다. PATCH를 보낸 사실만으로 10초 미만 이탈 분석이 완료됐다고 볼 수 없습니다. 원본 본문 길이의 FE code point/BE UTF-16 차이도 그대로 남기며 400을 보정하지 않습니다.

### Issue #46 검증 절차

개인정보 없는 전용 임시 MySQL과 변경하지 않은 BE만 사용합니다. 예: MySQL 8.4를 `127.0.0.1:33346`에 새로 만들고 `focus_recovery` 스키마를 지정한 후 Java 21로 BE를 `18046`에서 실행합니다. 기존 DB로 실행하지 마세요.

```sh
# fe 디렉터리
npm run typecheck
npm test
npm run build
git diff --check
CHROMIUM_PATH="/absolute/path/to/Chrome for Testing" npm run test:browser
INTEGRATION_API_BASE_URL=http://localhost:18046 \
INTEGRATION_MYSQL_CONTAINER=전용임시컨테이너 \
CHROMIUM_PATH="/absolute/path/to/Chrome for Testing" \
node scripts/behavior-integration-test.mjs
```

행동 통합 스크립트는 비밀번호 없는 전용 테스트 root의 SQL 접근이 필요합니다. 요청 성공은 실제 BE에 전달하고 PATCH 저장 뒤 응답만 보류합니다. Worker target을 실제 종료하고 재기동한 뒤 동일 PATCH 재전송, `applied=false`, MySQL의 계수·버전·updated_at 불변, 로컬 종료 후 최종 ACK, 오래된 버전 재전송과 실제 409 코드를 확인합니다. 생성 세션은 ACTIVE로 남으므로 검증 후 테스트 BE와 임시 DB를 제거해야 합니다.

### Issue #46 실행 결과 (2026-10-18)

- `npm run typecheck`, `npm test`: **18개 파일 / 516개 성공**(기존 432개 유지, 84개 추가). `npm run build`, `git diff --check`도 통과했습니다. PATCH 계약 49개, 전송기 29개, Background 6개를 추가했습니다.
- macOS Chrome for Testing **151.0.7922.34** 합성 API 브라우저 회귀 테스트 통과. 실제 BE 결과와 구분합니다. Playwright가 기대하는 새 바이너리는 없어 초기 실행이 실패했고 이미 설치된 Chrome 경로를 명시해 실행했습니다.
- Java **21.0.10**, Spring Boot **4.1.1**, 전용 MySQL **8.4.9**, Chrome의 실제 세션 생성→1.5초 이상 활성 체류→탭 닫기→대체 탭 활성화→확정 방문 POST→PATCH→SQL 경로 통과. HTTP 응답을 정상 전달하는 경우와 POST 저장 뒤 ACK를 보류하는 경우를 각각 검증했습니다. 후자의 변경 발생 시 PATCH가 아직 0건임을 확인하고 POST ACK를 전달한 뒤에만 PATCH를 받았습니다.
- 두 경우 모두 실제 PATCH 200·`applied=true` 저장 후 FE 응답만 보류했습니다. SQL의 체류시간·전환 횟수·버전을 요청과 대조하고, 로컬 종료·신규 시작 차단→실제 Worker target 종료→동일 스냅샷 재전송 200·`applied=false`→최종 ACK 일치를 확인했습니다. 중복/오래된 버전 직접 PATCH 뒤에도 SQL 계수·버전·`updated_at`이 불변이었고, 실제 409 `BEHAVIOR_VERSION_CONFLICT`와 `BEHAVIOR_COUNTER_DECREASED` 및 ACK 이후 Worker 복구를 확인했습니다.
- 기존 `visit-integration-test.mjs` 실제 BE/SQL 회귀도 통과했습니다. 6개 방문·2개 Window의 구성/중복 방지, A/B 세션 분리, 프록시 503 제한 재시도, POST 저장 후 응답 유실·Worker 복구, 전송 중 종료·삭제, 한글/영문/이모지 길이 경계를 재검증했습니다. 프록시 503은 실제 BE 장애가 아닌 주입 오류입니다.
- 활성시간은 방문 확정 시 POST에 담긴 실제 누적값이며 이후 PATCH에서는 지연된 전환 횟수·버전이 증가했습니다. **POST 이후 활성시간 증가**와 여러 후속 변경 병합은 현재 Collector 정책에서 자연 발생하지 않으므로 전송기 단위/모의 Chrome 테스트로 검증했습니다. 실제 Chrome에서 이 경로까지 검증했다고 주장하지 않습니다.
- 최초 최소화·다중 창 시나리오는 기대한 foreground-null/지연 전환 경계를 만들지 못해 실패했습니다(headless와 headed 각각 시도). 성공 판정에 포함하지 않았으며, 최종 스크립트는 실제 탭 닫기·대체 활성화 경로를 검증합니다. native 최소화 시 측정 경계와 이벤트 순서는 별도 재현 점검이 필요합니다. Windows Chrome Stable·실제 Google/Naver DOM·브라우저 재시작 영속 복구도 이번 실제 검증 범위가 아닙니다. 검증에 생성한 임시 BE와 MySQL 컨테이너는 종료·제거했습니다.

### Issue #46 코드 리뷰 보완 (기준 `16cd82c`, 2026-10-18)

시작 브랜치는 `feat/46/visit-behavior-api-integration`, HEAD는 `16cd82cd6e14350d9d09d6905367d8372116ca4e`, 미커밋 변경은 없었습니다. fetch한 최신 `upstream/main`은 `2b13e05`이며 차이는 Issue #46 커밋 1개뿐입니다. 다른 작업을 병합하지 않았습니다.

BE 계약을 Controller → Service → Entity → Response DTO 순서로 확인했습니다. `applyBehavior()`가 true이면 `Instant.now().truncatedTo(MILLIS)`를 Entity에 저장하고 `VisitBehaviorResponse.of()`가 그 값을 반환합니다. 따라서 `applied=true`의 null은 정상이 아닙니다. false는 값을 바꾸지 않습니다. POST 초기 `updatedAt`은 null이고 최초 POST의 버전 자체가 0보다 클 수 있으므로, 동일 버전 재전송뿐 아니라 낮은 요청에 더 높은 서버 버전을 반환하는 경우도 null이 정상입니다. FE는 이 nullable 계약은 유지하고 true일 때만 시각을 필수로 했습니다. 날짜·UTC `Z`·소수점 정확히 3자리·필드 존재 검증 및 누적값/버전 검증은 유지합니다. `src/api/visit.ts`의 POST 응답 계약과 BE는 수정하지 않았습니다.

수정 전 실패 재현 테스트에서 true+null을 잘못 ACK하고, POST·PATCH가 `sending/attempts=3` 복구 후 4번째 자동 요청을 보내는 것을 확인했습니다. 기존 코드에는 HTTP 시작 시 예산 검사가 없어, 매번 응답 전에 Worker가 중단되면 다음 복구도 같은 방식으로 상한을 넘길 수 있었습니다. 복구 시 attempts를 0으로 초기화하는 문제는 아니었습니다.

변경 범위는 다음과 같습니다.

- `src/api/behavior.ts`: `applied=true`에만 non-null UTC 밀리초 시각 필수.
- `src/background/delivery-retry.ts`, `visit-delivery.ts`, `behavior-delivery.ts`: 공통 3회 예산 검사와 소진 시 안전한 오류/수동 재시도 상태. HTTP 시작 전과 마지막 일시 실패 시 적용합니다. POST·PATCH의 예산·대기·불확실성 안내는 같습니다. POST 실패는 후속 방문과 그 방문의 PATCH를 막고, PATCH 실패는 다른 ACK된 방문의 갱신을 막지 않는 기존 차이는 유지합니다.
- `tests/behavior-api.test.ts`, `behavior-delivery.test.ts`, `visit-delivery.test.ts`, `background.test.ts`: 시각 계약, 실제 두 번 실패 후 세 번째 중단, 반복 복원, 레거시 4회 checkpoint 보존, 신규 세션 차단, 수동 재시도, 잘못된 시각의 ACK 금지를 검증합니다. 기존 516개 테스트를 삭제하지 않았습니다. 기존 POST의 “4번째 자동 전송 허용” 테스트 1개는 새 정책에 맞춰 “자동 전송 없음·원본/횟수 보존·수동 재시도” 검증으로 강화했습니다.
- `scripts/visit-test-proxy.mjs`, `behavior-integration-test.mjs`: 테스트 프록시에 제한 횟수 PATCH 503 주입을 추가하고, 실제 Worker target 종료 B-1/B-2/B-3를 검증합니다. 주입 오류는 실제 BE 장애와 구분합니다.

복구/종료 시 완료 판단은 바뀌지 않습니다. POST ACK 전 PATCH 금지, 저장된 PATCH ACK의 재전송 생략, 누적값/버전 검사, 이전 ACK의 후퇴 방지, 종료 후 큐 유지 및 미확인 요청의 새 세션 차단을 유지합니다. 예산 소진은 서버 미저장을 뜻하지 않습니다. Popup에는 실패·시도 횟수·서버 반영 가능성·같은 요청 재시도 가능 여부가 표시되고, 수동 재시도 시 기존 visitId/버전/누적값으로 멱등 확인합니다. 명시적 삭제/권한 철회 후 지연 ACK의 무시도 유지합니다.

보완 검증 결과 (2026-10-18):

- 수정 전 기준 테스트 **18개 파일 / 516개 통과**를 확인했습니다. 먼저 추가/강화한 테스트에서 true+null ACK 1건과 POST/PATCH 예산 초과 4건, 총 5건의 실패를 확인한 후 수정했습니다. 최종 **18개 파일 / 535개 통과**(기존 516개 유지, 신규 19개: API 7·PATCH 전송 7·POST 전송 2·Background 3)이며 타입 검사·production build·`git diff --check`도 통과했습니다.
- 모의 HTTP/Chrome 검증: 재시작 전후 attempts 보존, 두 번 실패 뒤 세 번째 중단, 반복 복구의 3회 상한, 레거시 4회 값의 보존, 수동 재시도에만 새 예산 부여, 다른 방문의 PATCH 진행, 복구된 POST HTTP 200 ACK 이후 PATCH 재개, true+null ACK 금지 및 신규 세션 차단을 확인했습니다. 기존 종료/삭제/권한 철회/지연 ACK·버전/누적값 검증도 유지됩니다.
- macOS Chrome for Testing **151.0.7922.34**의 기존 합성 API MV3 브라우저 회귀 테스트 통과. 이 결과는 실제 BE·DB 검증과 구분합니다.
- Java **21.0.10**·Spring Boot **4.1.1**·전용 임시 MySQL **8.4.9**·위 Chrome에서 실제 B-1을 POST ACK 정상 전달/보류 두 경우로 실행했습니다. PATCH 저장 후 응답만 보류하고 Worker target을 종료해 동일 요청이 attempts **1→2**로 재전송·ACK되는 것을 확인했습니다. POST ACK 보류 중 PATCH는 0건이었고, 최초 POST 상태에서 동일/낮은 버전 직접 PATCH의 `applied=false, updatedAt=null`도 실제 BE로 확인했습니다.
- 실제 B-2: **프록시가 주입한** 503 두 번 후 세 번째 PATCH가 실제 DB에 저장된 상태에서 응답만 보류하고 Worker 종료. 복구 상태는 `failed/attempts=3/retryable=true`이며 4번째 자동 요청 없음. 두 번 더 Worker를 종료/복구해도 추가 요청 없음. Popup의 서버 반영 가능성 안내·재시도 버튼 활성·신규 세션 차단을 확인한 뒤 **실제 버튼 클릭**으로 동일 스냅샷을 재전송해 `applied=false` ACK를 받았습니다. 주입 503을 실제 BE 장애로 보고하지 않습니다.
- 실제 B-3: 같은 PATCH의 첫째·둘째·셋째 요청 각각에서 실제 DB 응답을 보류하고 Worker를 세 번 종료했습니다. attempts는 **1→2→3**으로 유지되고 이후 `failed/3`에서 멈췄습니다. 추가 두 번 재시작에서도 자동 전송이 없었으며 수동 버튼 클릭 후에만 네 번째 요청이 실행됐습니다. 최초 요청만 `applied=true`, 나머지는 false였고 모든 요청의 visitId·버전·누적값, SQL 값 및 `updated_at` 불변을 확인했습니다. 로컬 종료 뒤 최종 ACK와 ACK 이후 복구, 낮은 버전 재전송, 실제 409 두 코드도 통과했습니다.
- 기존 #43 실제 POST 통합 회귀도 통과했습니다. 방문 6개·Window 2개 구성 및 중복 방지, POST 201/200·순차 ACK, 세션 분리, 503 제한 재시도/명시적 재시도, 실제 저장 후 응답 유실·첫 시도 Worker 복구, 종료/삭제, Unicode 경계를 확인했습니다. **POST의 세 번째/반복 중단 상한 자체는 단위·모의 Background 테스트 범위**이며 해당 경우를 실제 Chrome·DB로 재현했다고 주장하지 않습니다.
- 검증에 직접 생성한 임시 BE와 MySQL 컨테이너는 종료·제거했습니다. 이번 브라우저 실행은 headless입니다. native 다중 창 포커스/최소화는 `HEADED=1` 전용 시나리오라 SKIP했고, Windows Stable·실제 검색 사이트 DOM·브라우저 재시작 영속 복구는 재검증하지 않았습니다. 기존 최소화 경계·10초 분석 조정·FE code point/BE UTF-16 길이 차이도 이번 수정 대상이 아닙니다.

현재 범위에서는 브라우저 세션 내 checkpoint를 통한 Worker 복구만 다룹니다. 저장 전/저장소 장애/브라우저 재시작/reload의 무손실 복구는 보장하지 않습니다. IndexedDB·장기 스케줄러·서버 종료/END_PENDING·Collector 정책은 변경하지 않았습니다.

## 방문 기록 저장 및 ACK (Issue #43)

`src/api/visit.ts`는 세션 생성용 `postJson()`과 분리된 방문 클라이언트입니다. Content Script는 서버에 직접 접근하지 않고 Background만 호출합니다. `sessionId`는 경로에만 넣고, DTO의 `visitId`, `sequence`, `browserTabKey`, `normalizedUrl`, `domain`, `title`, `content`, `searchQuery`, `isSearchResultPage`, `visitedAt`, `activeDurationMs`, `tabSwitchCount`, `behaviorVersion`을 명시적으로 선택합니다. 세션 생성의 `Idempotency-Key`를 방문 요청에 보내지 않습니다. FE의 UUID·sequence·URL·본문·검색어는 다시 생성하거나 정규화·절단하지 않습니다. `visitedAt`은 Collector의 `toISOString()` UTC 밀리초 문자열을 그대로 보내며 이 형식이 아니면 전송하지 않습니다.

전송 시점은 기존 판정 정책을 따릅니다. 새 문서/SPA 방문으로 교체, 탭 닫기, 로컬 수집 종료, 수집 한도 도달 등으로 후보가 종료되고 앞선 후보가 모두 확정되어 `readyVisits`에 포함된 방문만 큐에 추가합니다. `pending`, `excluded`, `sequence: null`은 전송하지 않습니다. 앞선 열린 탭이 있으면 뒤 방문도 기다립니다. 연속 sequence를 그대로 사용하며 BE가 허용하는 번호 공백 정책에 맞추기 위해 재번호를 매기지 않습니다.

`src/background/visit-delivery.ts`는 큐에 처음 추가할 때 평탄한 `PageVisit` 복사본을 고정합니다. 이후 Collector의 체류시간·전환 횟수·버전 변화는 이 요청에 반영하지 않습니다. 큐 상태와 최초 요청은 HTTP 전에 trusted `storage.session`에 저장합니다. 기존 직렬 실행기는 Collector 처리·스냅샷·저장·전송 상태 반영만 수행하며, **fetch와 응답 대기는 직렬 실행기 밖**에서 수행합니다. 이벤트 도착 순서를 유지하고 HTTP 중에도 수집과 로컬 종료를 처리합니다.

한 번에 한 요청만 실행하고 sequence 오름차순으로 보냅니다. 복원 시 Collector/저장된 세션 생성 응답의 세션 ID와 큐 세션을 비교하고, ACK가 앞에서부터 연속된 상태인지 확인합니다. 세션 불일치나 앞 미확인·뒤 ACK 상태는 원본을 수정하지 않고 보류합니다. 성공 응답의 검증이 끝나 `acked`가 된 뒤에만 다음 방문을 보냅니다. 새 이벤트는 동일 ID를 다시 큐에 넣지 않습니다. Worker 재기동 뒤 첫 확장 이벤트에서 checkpoint를 읽고 `sending`을 동일 스냅샷의 재시도로 복구합니다. 리뷰 보완 후 예산이 이미 소진된 요청은 전송 전에 `failed`로 멈추며, 원본과 시도 횟수를 유지한 채 수동 재시도 또는 서버 확인을 기다립니다. ACK가 있으면 재전송하지 않습니다. 서버 저장 후 응답만 유실되면 같은 ID·원본으로 POST하여 BE의 200 재전송 응답을 받습니다. 중복 행·Window 방지는 BE의 기존 원본 비교·유일성 제약과 이 순차 ACK 정책을 함께 사용합니다.

| 응답/실패 | 처리 |
| --- | --- |
| 201 | sessionId와 모든 원본 필드 일치, UTC 밀리초 시각, 초기 행동 값 일치, `updatedAt=null` 확인 후 ACK |
| 200 | sessionId와 모든 원본 필드 일치 확인 후 ACK. 서버 행동 값은 안전한 정수이며 초기 값보다 작지 않아야 하고 `updatedAt`은 null 또는 UTC 밀리초 시각이어야 함 |
| 400 | 요청 확인 필요 상태로 유지, 자동·버튼 재시도 없음 |
| 404 | 세션/리소스 확인 필요 상태, 자동 새 세션 생성 없음 |
| 409 | `SESSION_ENDED`, `VISIT_ID_CONFLICT`, `VISIT_SEQUENCE_CONFLICT`, `VISIT_SEQUENCE_OUT_OF_ORDER` 코드 보존, 재시도/ID·순서 교체 없이 보류 |
| network·10초 timeout·5xx·408·429·읽을 수 없는 성공 JSON | 정상 연속 실행에서 최초 포함 최대 3회, 첫/둘째 실패 후 1초/2초 대기. 소진 후 명시적 **같은 방문 재시도**로 같은 스냅샷을 최대 3회 다시 시도 |
| 원본과 다른 성공 응답·알 수 없는 거절 | ACK하지 않고 확인 필요 상태로 유지 |
| 전송 checkpoint 손상·API 주소 변경·저장 실패 | 원본 checkpoint를 자동 덮어쓰지 않고 전송 보류. Worker/저장소 및 기존 서버 확인 필요 |

어떤 실패든 앞 방문이 미확인인 동안 후속 방문은 보내지 않습니다. Popup의 **서버 저장 확인**은 검증된 ACK 건수이며 유효 방문 수와 구분합니다. `queued`/`sending`/`retry-wait`/`failed`와 시도 횟수·안전한 오류·409 코드를 **상태 새로고침**으로 확인합니다. 서버 오류 메시지·필드 오류 원문과 수집 본문을 로그에 출력하지 않습니다.

로컬 수집 종료는 남은 후보를 확정하고 전송을 계속하지만, 서버 세션 종료는 호출하지 않습니다. 미확인 방문이 있으면 신규 세션 시작을 막아 원본이 사라지지 않게 합니다. 일시 실패는 같은 방문 재시도, 영구 실패는 서버 확인이 필요합니다. 사용자가 종료 후 **로컬 기록 삭제**를 선택하면 미확인 요청도 삭제됩니다. 권한 철회도 수집과 남은 큐를 지우며, 늦게 도착한 ACK가 기록을 재생성하지 않습니다. 이미 전송 중인 요청은 서버에 저장될 수 있고 로컬 삭제·권한 철회는 서버 삭제가 아닙니다.

`storage.session` checkpoint는 IndexedDB 영속 큐가 아닙니다. **브라우저 재시작·확장 reload/업데이트 시 미전송 방문·ACK가 유실될 수 있습니다.** 저장 전에 Worker가 종료되거나 저장소 쓰기가 실패한 구간도 복구를 보장하지 않습니다. 재시도 타이머가 Worker를 계속 살려두거나 자동으로 깨우는 보장도 없으며 다음 이벤트에서 재개합니다. 기존 세션 생성 키·응답의 local 복구 정책은 유지합니다. 전송 스냅샷은 본문 저장량을 늘리므로 `storage.session` 용량 초과 시 수집/전송 상태 확인이 필요합니다. 브라우저 재시작 복구·서버 종료·END_PENDING·AI 호출은 후속 Issue 범위입니다. 행동 PATCH와 최종 행동 ACK는 위 Issue #46 구현을 참고하세요.

명세 차이: FE 본문 제한은 5,000 Unicode code point이고 현재 BE `@Size(max=5000)`는 Java UTF-16 길이입니다. 이모지 등 비 BMP 문자가 많으면 FE 제한 내 본문도 400이 될 수 있습니다. 원본을 자르거나 BE·명세를 변경하지 않고 요청 오류로 남깁니다. 문자 단위 통일은 팀 확인이 필요합니다. 기존 명세의 활성 10초 분석 시점과 열린 앞선 탭에 의한 전송 지연, 영구 실패 후 운영 복구 정책도 별도 협의 대상입니다. 문서의 IndexedDB 전체 복구 요구는 이번 구현에서 충족하지 않습니다.

### 실제 FE–BE–MySQL 검증 절차

1. 개인정보가 없는 **전용 테스트 DB**에 기존 BE를 연결하고 실행합니다. 예: 별도 MySQL 8.4의 `focus_recovery`, Java 21, `DB_URL`과 BE 포트 지정. 기존 데이터베이스에 테스트를 실행하지 마세요.
2. `fe`에서 아래 명령을 실행합니다. 스크립트는 임시 확장/프로필에 합성 문서 호스트 권한을 부여하고, 실제 Popup → 세션 API → Collector → 방문 API를 사용합니다. 성공 요청은 테스트 전용 HTTP 프록시(`scripts/visit-test-proxy.mjs`)를 거쳐 실제 BE에 전달합니다. BE가 실제 저장을 마친 뒤 응답만 보류할 수 있습니다. A-2/A-3의 실패 구간만 프록시가 503을 주입하며, 이를 실제 BE 오류 검증으로 간주하지 않습니다. `CHROMIUM_PATH`는 설치한 Chrome for Testing 실행 파일입니다.

```sh
INTEGRATION_API_BASE_URL=http://localhost:18043 \
CHROMIUM_PATH="/absolute/path/to/Chrome for Testing" \
node scripts/visit-integration-test.mjs
```

3. 비밀번호 없는 root를 쓰는 **전용 임시** MySQL 컨테이너라면 `INTEGRATION_MYSQL_CONTAINER=컨테이너명`을 함께 지정하면 실제 SQL로 방문·Window 수와 구성도 검사합니다. 이 옵션이 없으면 DB 검사는 명시적으로 SKIP합니다. 비밀정보를 인자·문서에 넣지 마세요. 스크립트는 방문 6개/sequence 1~6, ACK, 실제 서버 GET 결과, 각 방문의 동일 POST 200 재전송, 재전송 전후 실제 SQL의 방문 6개·Window 2개와 `[1,2,3,4,5]`, `[2,3,4,5,6]` 구성, Worker 재기동의 ACK 복구를 확인합니다. 추가로 A/B 연속 세션, 미확인 방문의 신규 시작 차단과 명시적 재시도, BE 저장 직후 ACK 유실+실제 Worker target 종료, 전송 중 로컬 종료/삭제, Unicode 경계를 검사합니다. 임시 브라우저 파일은 자동 삭제합니다. 생성된 서버 세션은 ACTIVE로 남으므로 검증 후 전용 BE/DB 컨테이너를 정리하세요.
4. `CHROMIUM_PATH="…" npm run test:browser`는 별도 합성 API 회귀 테스트입니다. 세션 응답 유실/동일 키 복구, 방문 응답 유실/동일 ID 재전송 200, 검색·SPA·탭·Worker·제외 정책을 검사합니다. 실제 BE 검증과 구분합니다.

### Issue #43 실행 결과 (2026-10-18)

- `npm run typecheck`, `npm test` **16개 파일 / 405개 성공**, `npm run build`, `git diff --check`: 성공. 기존 338개 검증을 유지하고 방문 API·전송기·Background 검증 67개를 추가했습니다.
- macOS Chrome for Testing **151.0.7922.34**, 합성 API MV3 테스트: 성공. 방문 응답 유실 후 동일 ID 재시도, 200 ACK, 순서 및 Worker 복구를 포함합니다. 기본 Playwright 바이너리는 설치되어 있지 않아 첫 실행은 실패했고, 기존 설치 바이너리를 명시해 통과했습니다. native 다중 창 포커스/최소화는 `HEADED=1` 미실행으로 SKIP했습니다.
- 실제 Java **21.0.10**, Spring Boot **4.1.1**, 전용 MySQL **8.4.9**, 위 Chrome의 실제 6개 수집 방문 저장·ACK·6개 중복 POST 200·목록 불변·Worker ACK 복구를 검증했습니다. 실제 SQL에서 재전송 전후 모두 중복 없는 방문 6개·Window 2개, Window 1=[1,2,3,4,5], Window 2=[2,3,4,5,6]를 확인했습니다. 임시 BE와 테스트 컨테이너는 검증 후 정리했습니다.
- Windows 11 Chrome Stable, 실제 사이트의 새 Google/Naver DOM, 화면 기반 권한 dialog는 이번 작업에서 검증하지 않았습니다. 행동 PATCH·브라우저 재시작의 방문 복원은 구현하지 않았습니다.

### Issue #43 리뷰 후 보완 검증 (2026-10-18)

작업 기준은 `feat/43/page-visit-api-integration`의 `d9e0e72`, 미커밋 변경 없음입니다. 최신 `upstream/main`은 `b9f6de5`이며 별도 알림 기능의 6개 커밋은 병합하지 않았습니다. 이 검증은 현재 작업 브랜치의 BE/Flyway V1~V8로 수행했습니다.

정상 세션 혼합은 재현되지 않았습니다. 기능 수정은 두 재현 테스트로 확인한 복원 검증 누락에 한정합니다. 기존 큐의 내부 세션 ID가 일치해도 Collector와 다른 세션이면 차단하며, 앞 방문이 미확인인데 뒤 방문이 ACK인 불가능한 순서도 차단합니다. 두 경우 모두 원본 checkpoint를 자동 덮어쓰거나 ID/sequence를 고치지 않습니다. 정상 세션 전환, Collector·Popup·API 클라이언트 정책은 변경하지 않았습니다.

| 항목 | 실제 검증 및 결과 |
| --- | --- |
| A-1 연속 세션 | A의 방문 6개를 모두 ACK한 뒤 로컬 종료하고 명시적 기록 삭제 없이 B 생성. B의 2개 방문은 새 세션과 sequence 1·2로 저장. Worker 재기동 후 A 재전송·중복·복원 충돌 없음. 실제 세션별 SQL/GET 확인 |
| A-2 미확인 방문 | 프록시 503을 3회 주입. 새 세션 API 호출 차단, 오류 표시, 원본 스냅샷·ID·sequence 보존. 이 실패 자체는 주입된 전송 오류이며 실제 BE 장애가 아님 |
| A-3 명시적 재시도 | 503 주입 해제 후 같은 요청이 실제 BE에 저장·ACK됨. 이후 새 세션에서 2개 방문 정상 저장 |
| B 저장 직후 Worker 중단 | 실제 BE의 5번째 방문 201과 첫 Window SQL 저장 확인 후 응답 보류. FE checkpoint는 `sending`, 6번째 방문은 `queued`. CDP `Target.closeTarget`과 기존 target 소멸 확인 뒤 재기동. 같은 5번 원본 POST가 실제 BE의 200으로 ACK되고, 저장된 ACK를 확인한 뒤에만 6번 요청 도착 |
| Window 일관성 | 중단 전 실제 SQL에 방문 5개·Window 1개, 복구 후 방문 6개·Window 2개. 각 방문 ID·sequence와 Window index·끝 방문 중복 없음. 구성 [1,2,3,4,5], [2,3,4,5,6] 유지 |
| C-1 전송 중 로컬 종료 | 5번 응답 보류 중 로컬 종료가 즉시 처리되고 6번 후보 확정. 복구 후 두 요청이 순차 저장되며 로컬 종료 상태 유지. Worker 중단 없는 종료 흐름도 Background 회귀 테스트로 확인 |
| C-2 전송 중 로컬 삭제 | 실제 BE가 1번을 저장하고 응답을 보류한 동안 로컬 종료·명시적 삭제. 늦은 실제 201 수신 후에도 checkpoint·후보는 비어 있고 2번 미전송. 서버의 1번 기록은 유지. Popup의 서버 저장 가능성·서버 삭제 아님 안내 확인 |
| C-3 실패 후 삭제 | 실제 Unicode 400 원본이 Worker 재기동·허용되지 않는 재시도 뒤에도 보존됨. 명시적 기록 삭제 후에만 로컬 제거. 삭제 전 경고 표시 확인 |
| Unicode | 실제 Collector 추출→BE 전송. 한글 5,000자·영문 5,000자·이모지 2,500개(UTF-16 5,000)는 201. 이모지 2,501개(code point 2,501 / UTF-16 5,002)는 실제 400, DB 0건. 요청 원본을 절단·보정하거나 새 ID로 보내지 않음 |

`queued`·`sending`·`retry-wait`·`failed`·`acked`의 각 복원은 단위 테스트와 실제 Background 모듈을 재로드하는 모의 Chrome/HTTP adapter 테스트에서 모두 확인했습니다. `sending`은 같은 원본으로 재시도, `acked`는 중복 전송 없음, `retry-wait`는 대기 시각 유지, `failed`는 자동 재시도 없이 유지합니다. 실제 Chrome·BE 테스트에서는 `sending`+`queued`, `failed`, `acked` 복구를 확인했으며 `retry-wait` 상태 자체에서의 실제 Chrome 강제 종료는 별도로 실행하지 않았습니다. 손상·세션 불일치·ACK 역전·API Base URL 변경의 차단과 원본 보존은 모의 adapter/단위 테스트 범위입니다.

Issue #43 당시에는 정상 연속 실행에서 최초 포함 최대 3회(1초/2초 대기), 이후 명시적 재시도였습니다. 당시 테스트는 마지막 시도 중 중단 후 4번째 복구 전송을 허용하고 실패하면 멈추는 동작을 확인했습니다. 이 과거 검증 결과는 유지하지만, **Issue #46 리뷰 보완으로 이 정책을 변경했습니다.** 현재는 POST·PATCH 모두 Worker 재시작 전후 동일 스냅샷의 자동 예산을 3회로 제한하고, 소진 시 서버 반영 여부 미확인을 알린 뒤 명시적 재시도를 기다립니다. 장기 스케줄러나 영속 큐를 추가한 변경은 아닙니다.

로컬 종료는 수집만 끝내고 확정 방문 전송을 계속합니다. 미확인 방문이 있으면 새 세션을 차단하며, 사용자의 명시적 로컬 삭제는 복구용 스냅샷까지 제거합니다. 이미 전송 중이거나 저장된 서버 데이터는 삭제되지 않습니다. 늦은 ACK는 삭제된 로컬 큐를 재생성하지 않습니다. 기존 Popup 안내를 유지했고 자동 초기화는 추가하지 않았습니다.

검증 환경은 macOS Chrome for Testing 151.0.7922.34, Java 21.0.10, Spring Boot 4.1.1, 전용 임시 MySQL 8.4.9입니다. 초기 Playwright Worker `close` 이벤트 대기는 timeout이 발생해, 확장 Worker의 CDP target 종료 및 소멸을 직접 확인하는 방식으로 변경했습니다. 성공 응답과 SQL은 실제 BE/DB 결과이며 본문·개인정보·비밀정보는 출력하지 않습니다.

- 자동 테스트: 기존 **405개 유지 + 신규 27개 = 432개**. 전송기 복원 14개, Background 세션/복원/삭제 9개, API Unicode 4개. 기존 검증 삭제·완화 없음.
- `npm run typecheck`, `npm test`(16개 파일 / 432개), `npm run build`, `git diff --check`: 최종 실행 성공. 기존 합성 API MV3 브라우저 테스트도 성공했으며 native 다중 창 검사는 SKIP했습니다.
- 새 실제 통합 시나리오 A-1/A-2/A-3/B/C-1/C-2/C-3/E와 SQL 검사: 최종 재실행 성공. 테스트 서버와 전용 MySQL 컨테이너/데이터는 검증 후 정리했습니다. A-2/A-3의 503 구간은 명시적으로 프록시 주입 오류로 구분합니다.
- Windows 11 Chrome Stable, native 다중 창 포커스/최소화(`HEADED=1`), 화면 기반 권한 dialog, 실제 Google/Naver DOM 재검증은 미실행입니다. BE 단위 테스트 전체는 이번 FE 보완 작업에서 실행하지 않았습니다.

현재 구현은 통제된 파일럿 수집에 사용할 수 있습니다. `storage.session`은 같은 브라우저 세션의 Worker 재기동 복구를 지원하지만 브라우저 재시작·확장 reload/업데이트·저장 전 종료·저장소 장애·명시적 삭제에서 미전송 데이터가 유실될 수 있습니다. 타이머는 Worker를 자동으로 깨우거나 장기간 유지하지 않으며 다음 확장 이벤트가 필요할 수 있습니다. 장기 무손실 수집에는 IndexedDB 영속 큐와 복구 정책이 필요합니다. 이는 이번 보완에서 구현하지 않았습니다.

BE의 UTF-16 제한과 FE의 code point 제한을 통일할지 팀 협의가 필요합니다. 현재는 원본을 유지하고 400으로 멈추므로 후속 방문 전송도 보류됩니다. 열린 탭에 의한 전송 지연과 활성 10초 분석 시점, 영구 실패 시 운영 복구 방식도 후속 협의 대상입니다. 행동 PATCH·서버 종료·END_PENDING·AI·장기 alarms 스케줄러·DB 스키마 변경은 포함하지 않았습니다.

## 개발 환경 및 명령

- Node.js 22.12 이상, npm (lockfile 포함)
- TypeScript, React 19, Vite 7, Chrome API 타입
- Vitest + jsdom: 순수 정책, 상태 관리, Chrome API adapter 테스트
- Playwright: 격리된 Chrome for Testing/Chromium에서 MV3 실행 테스트
- Chrome 106 이상: `documentId`, `documentLifecycle`, `storage.session` 기반

```sh
cd fe
npm ci
npm test
npm run build
npm run build:dev
npm run dev
```

`build`는 타입 검사 후 `dist/`에 popup, ES module Service Worker, 단일 IIFE Content Script 및 manifest를 생성합니다. `build:dev`는 개발 모드 빌드입니다. `dev`는 최초 두 번들을 빌드한 후 변경을 감시합니다. HMR 서버를 사용하지 않으므로 코드 변경 후 Chrome 확장 프로그램을 새로고침하고 열린 웹페이지도 새로고침해야 합니다. 두 watcher는 출력 폴더를 지우지 않아 서로의 번들을 보존합니다. `npm run typecheck`로 타입 검사만 실행할 수 있습니다.

## API 설정 및 복구 (Issue #34)

`src/api/client.ts`의 `postJson()`은 세션 생성 전용 fetch·10초 timeout(본문 수신 포함)·오류, `session.ts`는 POST와 응답 검증, `types.ts`는 현재 BE DTO를 담당합니다. Content Script는 BE를 직접 호출하지 않습니다. HTTP 201, UUID, 목표 일치, UTC 밀리초 시각, ACTIVE/ENDED 및 endedAt을 확인하고 ACTIVE만 수집에 사용합니다. 서버 오류 본문은 사용자/로그에 노출하지 않습니다.

기본 주소는 `http://localhost:8080`입니다. `.env.example`을 `.env.development.local` 또는 `.env.production.local`로 복사해 `VITE_API_BASE_URL`을 HTTP(S) origin으로 설정합니다. `npm run build`는 production, `build:dev`/`dev`는 development 값을 사용합니다. 환경 변경 후 다시 빌드하고 확장을 reload합니다. 값에 비밀키나 인증정보를 넣지 않습니다.

빌드는 해당 API 호스트 **한 개**만 `host_permissions`에 생성합니다. Chrome 호스트 권한은 포트를 제한하지 못하므로 같은 scheme·hostname의 모든 포트는 수집 대상에서 제외합니다. 사이트별 선택 권한 선언은 기존대로 유지합니다. API 주소로 localhost를 쓴다면 로컬 수집 fixture는 127.0.0.1처럼 별도 호스트를 사용하세요.

시작 요청마다 UUID 키를 만들고 HTTP 요청 **전에** 키·정리된 목표·API 주소를 trusted local storage에 저장합니다. Popup의 요청 잠금과 Background의 도착 시점 잠금, 기존 직렬 큐로 중복 시작을 차단합니다. 성공 응답도 먼저 저장하고 활성 checkpoint/메타데이터 저장과 Script 활성화를 마친 뒤 미완료 요청을 지웁니다. 완료된 키·응답은 `activeSession.startRequest`에 계속 보관하며, 정상 활성 세션을 명시적으로 로컬 종료하고 저장까지 성공한 경우 해제합니다. API 대기 중 도착한 수집 이벤트의 시각은 활성화 이전으로 소급하지 않습니다.

- 네트워크 오류·timeout·5xx·잘못된 JSON/필드: 활성화하지 않고 키를 보존합니다. **같은 요청 재시도**로 동일 목표·키를 보냅니다. 백그라운드 자동 재시도는 없습니다.
- 최초 요청의 400: BE가 생성 전에 거절한 것이므로 요청을 해제해 목표를 수정할 수 있습니다. 이전 미확인 요청의 재시도에서 받은 400은 키를 유지합니다.
- 422, ENDED 재응답, API 주소 변경, 손상된 요청: 새 키로 우회하지 않습니다. 기존 서버/목표 확인이 필요합니다. 이를 강제로 취소하는 UI는 없습니다.
- 저장·활성화·권한 동기화 실패: 수집을 중단하고 시작 정보와 기존 방문 ID·sequence를 보존합니다. 정상 활성 세션의 일반 오류도 동일하게 중단하고 완료된 요청 정보를 복구 대기로 전환합니다. 이미 수신한 정상 응답은 명시적 복구 시 재사용하며, 응답 저장 전에 Worker가 종료되었다면 같은 키로 POST합니다. 닫힌 탭의 broadcast 수신 실패는 전체 활성화 실패로 취급하지 않습니다.
- Worker 중단: 정상 활성 checkpoint는 기존 세션·방문을 복구하며 미관찰 시간을 더하지 않습니다. 활성화 미완료 또는 오류 중단(`activeSession.interrupted`) 상태는 자동 재개하지 않고 명시적 재시도를 요구합니다. 브라우저/확장 reload 후 방문 checkpoint는 사라지지만 생성 키·응답은 남아 같은 서버 세션으로 명시적으로 복구합니다.
- **로컬 기록 삭제/로컬 종료는 미확인 생성 요청을 취소하지 않습니다.** 서버에 이미 생성되었을 수 있으므로 먼저 같은 요청으로 복구해야 합니다.

Background 상태의 `sessionStartRecovery`는 `none`(복구 불필요), `pending`(같은 목표·키/저장 응답으로 복구), `invalid`(손상·불일치·키 누락·초기화 실패)를 구분합니다. 손상된 `pendingSessionStart`나 완료 요청 정보는 자동 삭제·덮어쓰지 않으며, Popup에 **시작 요청 복구 필요**를 표시하고 목표 입력·신규 시작을 차단합니다. 상태 조회와 명시적인 방문 기록 삭제는 가능하지만, 생성 요청 원본은 그대로 남습니다. 저장소 초기화 자체가 실패하면 상태 조회만 제공하고 데이터를 수정하지 않습니다. 저장소 접근을 복구한 뒤 Worker를 재시작해 다시 확인해야 합니다.

손상·불일치 또는 생성 키가 없는 구버전 서버 세션은 UI에서 안전하게 복원할 수 없습니다. 원본 저장 정보와 확인 가능한 세션 ID를 보존한 채 담당자가 기존 API 서버의 멱등성 키·세션 상태를 확인해야 합니다. **서버 확인 없이 레코드를 삭제하거나 새 키로 우회하지 마세요.** 강제 초기화·서버 조회·관리자 복구 UI는 구현하지 않았습니다. API 주소 변경은 기존 설정으로 되돌린 뒤 재시도하고, ENDED 응답은 서버 확인이 필요합니다.

오류 시에는 중단 checkpoint와 local 중단 표시를 저장하고, checkpoint 저장도 실패하면 그 checkpoint를 제거해 자동 재개를 막습니다. 두 저장소의 쓰기와 checkpoint 삭제가 모두 실패한 채 Worker까지 종료되면 중단 표시를 영속화할 수 없습니다. 이 전면 저장소 장애까지 원자적으로 보장하는 기능은 없으며, 저장소 복구 및 서버 상태 확인이 필요합니다.

**후속 작업:** BE 종료 API, END_PENDING과 마지막 방문/행동 ACK, IndexedDB 전송 큐, 브라우저 재시작 후 서버 ACTIVE 세션 정리·복구 UX를 구현해야 합니다. 현재 로컬 종료·권한 철회·브라우저 재시작은 서버 종료를 보장하지 않습니다.

2026-10-16 실제 Java 21·Spring Boot·전용 MySQL 8.4·Chrome for Testing 통합 검증은 **17개 시나리오 성공**, 당시 FE 테스트는 **309건 성공**입니다. 실제 저장·동일 키 재시도·BE 중단·응답 유실·timeout·Worker 중단 복구를 확인했습니다. 테스트 종료 후 전용 컨테이너와 임시 비밀번호는 정리했습니다.

Issue #34 당시 2026-10-18 복구 보완 후 FE 테스트는 **338건 성공**(신규 29건), 타입 검사·production 빌드 통과입니다. BE 코드는 변경하지 않았으며, 해당 Issue #34 보완 시점에는 실제 Spring Boot·MySQL 통합 검증을 재실행하지 않았습니다. Issue #43의 신규 실제 검증은 위 실행 결과를 참고하세요. 아래 브라우저 스크립트는 모의 API로 복구를 검증합니다.

## Chrome에서 로드 및 세션 검증

1. `npm run build`를 실행합니다.
2. `chrome://extensions`에서 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드**로 `fe/dist/`를 선택합니다.
4. 수집할 일반 HTTP(S) 사이트에서 확장 프로그램 아이콘을 클릭합니다.
5. **현재 사이트 수집 허용**을 누르고 해당 사이트의 접근 권한을 허용합니다. 다른 사이트를 탐색하려면 그 사이트에서도 이 단계를 수행합니다.
6. 설정한 BE 서버를 실행하고 최초 목표를 입력한 뒤 **작업 세션 시작**을 선택합니다. 이미 활성 세션이 있으면 새 세션을 만들지 않습니다.
7. 허용한 문서 탭으로 돌아가 Chrome 창과 탭을 활성 상태로 1초 이상 유지합니다.
8. popup의 **상태 새로고침**으로 후보/유효 방문 수를 확인합니다. **수집 데이터 표시**를 선택하면 본문을 포함한 구조화 데이터가 popup 안에만 표시됩니다. 화면 공유·캡처 시 주의하고 실제 개인정보를 저장소에 붙여 넣지 마세요.
9. **로컬 수집 종료**를 선택하면 새로운 후보 및 지연된 Content Script 응답을 받지 않습니다. 마지막 후보의 유효/제외 판정을 완료하고 결과는 확인용으로 유지합니다. 서버 종료 요청은 보내지 않아 BE의 ACTIVE 상태는 그대로 남을 수 있습니다.
10. 종료 후 **로컬 기록 삭제**로 데이터를 지울 수 있습니다. 미확인 방문이 없을 때 새 세션 시작 시에도 이전 결과를 지웁니다.

세션 시작 당시 이미 열려 있던 **허용된 탭**에도 Script를 주입하고 현재 문서를 후보로 등록합니다. 백그라운드 탭의 시간은 누적하지 않습니다. 방문 시각은 실제 과거 방문 시각을 추정하지 않고 이 세션에서 후보를 관찰한 UTC 시각입니다.

목표는 기존 BE `CreateWorkSessionRequest` 구현의 공백 제거 후 **5~150 UTF-16 code units** 검증과 맞췄습니다. `docs/fe-spec.md`의 길이는 아직 미확정이므로 FE 정책으로 새로 확정한 값은 아닙니다. 공백 정리는 Java `String.strip()`과 동일하며 NBSP/BOM은 임의로 제거하지 않습니다. `Collector.start`는 서버 응답만 받고 `source: server`로 표시합니다. sessionId/startedAt/status를 로컬에서 만들지 않습니다.

## 권한 및 개인정보

| 항목 | 실제 사용 목적 |
| --- | --- |
| `storage` | 활성 세션 메타데이터 및 Service Worker 중단 시 상태 복구 |
| `webNavigation` | 최상위 문서의 진입, 새로고침, 뒤로/앞으로가기 및 History API 이벤트 구분 |
| `scripting` | 사용자가 허용한 사이트에만 Content Script 등록/주입; 세션 시작 전에 열린 탭도 지원 |
| `activeTab` | 아이콘을 클릭한 현재 탭의 origin을 확인하여 사이트별 권한 요청 |
| 선택적 `http://*/*`, `https://*/*` | HTTP(S) 사이트를 선택할 수 있는 선언 범위. 실제 요청은 현재 **origin 한 개**이며 전체 사이트 권한을 일괄 요청하지 않음 |

`tabs`, `history`, `cookies`, `webRequest`, `clipboardRead`, `unlimitedStorage` 권한은 요청하지 않습니다. 탭 활성화 및 창 포커스 이벤트는 `tabs` 권한 없이 구독하며 전체 방문 기록을 조회하지 않습니다. 비활성 세션의 Content Script는 context 확인만 하고 DOM 추출/관찰을 시작하지 않습니다. 페이지와의 `postMessage` 또는 MAIN-world 코드 주입은 사용하지 않습니다.

원본 URL은 정책 검사와 SHA-256 계산에만 일시 사용합니다. 원본 Query·Fragment를 저장하거나 출력하지 않고, 정규화 URL과 문서 비교용 해시만 보관합니다. 해시는 익명화 보장이 아니므로 외부에 공개하지 않습니다. 개발 로그에 목표, URL, 제목, 본문, 입력값 또는 플랫폼 오류 원문을 출력하지 않습니다.

- `chrome.storage.local`: 활성 서버 세션 메타데이터(`activeSession`: 완료 생성 정보 `startRequest`, 오류 중단 시 `interrupted`)와 미완료 생성 요청(`pendingSessionStart`: 키·목표·서버 주소·수신 응답)을 보관합니다. 방문 본문은 보관하지 않습니다.
- `chrome.storage.session`: 세션, 전역 sequence, 탭/문서 식별, 후보 및 유효 방문의 개발용 checkpoint. 디스크에 영속 전송 큐를 만들지 않습니다.
- 두 storage 영역 모두 `TRUSTED_CONTEXTS`로 제한하며 Content Script에 저장소 읽기 권한을 열지 않습니다.
- Service Worker 재기동 시 정상 session checkpoint를 복구합니다. 브라우저 재시작/확장 프로그램 reload 시에는 방문 기록이 사라지고 자동 수집을 재개하지 않습니다. 유효한 서버 세션 메타데이터와 생성 요청은 local에 남아 명시적인 동일 세션 재시도로 복구합니다. 키가 없는 구버전 서버 메타데이터는 신규 시작을 차단하고 서버 확인을 요구합니다. 이전 개발용 로컬 세션 checkpoint는 서버 세션으로 승격하지 않습니다.
- 사이트 권한 철회 시 활성 세션을 중단하고 기록을 삭제합니다.
- 개발용 저장 한도는 **세션당 후보 200개**입니다. 한도 도달 시 수집을 중지하고 popup에 표시합니다. 무제한 저장 권한을 쓰지 않습니다.

## 수집 및 방문 정책

`src/background/collector.ts`가 후보·유효 방문·제외 상태를 관리하고 Background의 단일 비동기 직렬 실행기가 이벤트 처리와 checkpoint 저장을 순서대로 수행합니다. `visitId` 및 세션 내 `browserTabKey`는 UUID v4입니다. Issue #26부터 후보 배열의 생성 순서를 유지하고, 앞에서부터 판정이 종료된 후보 중 유효 방문에만 `sequence`를 1부터 연속 부여합니다. 복구 불가능한 제외는 즉시 판정을 종료하고, 나머지는 문서/SPA 교체·탭 닫기·세션 종료·수집 한도 도달로 종료하며, 새로고침·탭 전환은 기존 방문을 유지합니다. 열린 후보는 검색 결과 복구나 민감 DOM 제외가 가능하므로 뒤의 방문보다 늦게 유효해져도 원래 순서를 보장하도록 기다립니다.

| 상황 | 처리 |
| --- | --- |
| 새 최상위 문서 진입 | 새 후보 |
| 동일 탐색 대상 새로고침 | 문서 ID만 교체, visitId/sequence/활성시간 유지 |
| 다른 문서로 뒤로/앞으로가기 (BFCache 포함) | 새 후보. 과거 URL의 방문을 재사용하지 않음 |
| 기존 탭 활성화 | 현재 방문 재개 |
| 동일 문서의 중복 탐색/등록 이벤트 | 문서 ID로 중복 방지 |
| SPA URL만 또는 본문만 변경 | 기존 방문 유지 |
| SPA URL과 주요 본문 변경 | 새 후보 |
| 금지 URL/민감 DOM | 제외 상태, 제목·본문·검색어 payload 보관하지 않음 |

Chrome의 `onHistoryStateUpdated`로 `pushState`/`replaceState`를 감지하고, `popstate`, `pageshow`, `pagehide` 및 MutationObserver로 탐색 복원과 비동기 렌더링을 처리합니다. SPA는 Fragment를 뺀 **정규화 전 URL의 해시**와 주요 본문의 변경을 함께 확인합니다. Query만 다른 문서도 구분할 수 있습니다.

SPA 본문은 32자 조각이 이전/현재 본문에 포함되는 양방향 비율을 비교해, 양쪽 모두 **60% 미만**인 경우에만 주요 변경으로 봅니다. 댓글 덧붙이기와 단순 메뉴 변경은 신규 방문으로 처리하지 않습니다. 최초 50자 이상 본문을 비교 기준으로 유지하여 DOM과 URL 변경 순서가 바뀌어도 감지합니다. 이는 PoC 휴리스틱이며 서로 거의 같은 텍스트를 사용하는 서로 다른 문서는 놓칠 수 있습니다. 실제 SPA 샘플로 FE-007과 함께 검증해야 합니다.

### URL·DOM 정책 및 본문

- HTTP(S)만 허용, hostname 소문자 및 기본 포트 제거, 경로 의미/대소문자 보존, Query/Fragment 제거.
- 인증정보가 포함된 URL, 민감 경로/호스트/인증 파라미터, PDF·미디어 파일/대표 미디어 서비스는 제외합니다.
- 비밀번호/인증/연락처/결제 입력 요소 또는 보이는 form/편집 영역이 있는 문서는 보수적으로 제외합니다. 입력값은 검사하거나 읽지 않습니다.
- 주요 영역은 `article`, `main`, `[role=main]` 및 대표 본문 selector입니다. 없으면 문단/코드 블록이 2개 이상인 `section`을 시도하고, 이를 찾지 못하면 추출 실패로 둡니다. 전체 body의 `innerText`는 사용하지 않습니다.
- script/style, 광고, 메뉴/내비게이션, footer/aside, 숨겨진 요소와 숨겨진 조상, form 및 모든 입력/편집 요소, 반복 댓글·공유 요소를 텍스트 순회에서 제외합니다.
- 공백/줄바꿈을 정리하고 Unicode code point 기준 최대 **5,000자**로 제한합니다. 한국어·영어와 코드 기호를 유지하며 실패 시 임의 본문을 만들지 않습니다.
- 제목은 개발 저장 용량 제한을 위해 최대 500자로 제한합니다.
- 본문 준비 실패/50자 미만이면 최대 4회 추가 확인합니다 (350ms, 1s, 2s, 4s). DOM/History 이벤트 발생 시에도 확인합니다. DOM 이벤트는 350ms debounce, 최대 1.5s 대기로 연속 mutation의 무한 지연을 방지합니다.
- Google·Naver는 아래 FE-007 검색 정책으로 처리합니다. 검색어가 없는 검색 페이지는 기존 `search-pending`으로 제외하며, 결과를 기다리는 후보는 `pending`입니다.

### 최소 유효성 측정

활성 세션, 사이트 수집 허용, 제외 정책 통과, 종류별 콘텐츠 기준, 활성시간 1,000ms 이상을 모두 만족해야 유효합니다. 일반 HTML은 주요 본문 50자 이상이며 검색 페이지는 검색어와 유기적 결과 1건 이상입니다. `active-time.ts`는 활성 탭과 포커스된 비최소화 Chrome 창에서만 누적합니다. 탭/창 전환 시 일시 정지하고 복귀/새로고침 시 누적을 이어갑니다. 최소 유효성 확인을 위해 Content Script가 활성화 후 한 번 타이머를 실행하며 반복 분석 스냅샷이나 worker keepalive 루프는 없습니다. 유효시간 미달 후보는 탭 복귀 시 계속 대기할 수 있고, 실제 문서 이탈/닫기/세션 종료 시 최종 제외합니다.

## 데이터 상태 및 BE 계약 경계

`VisitCandidate`는 `pending | valid | excluded`와 판정 종료 여부 `finalized`를 가집니다. 제외 시 본문 payload를 지우고 이유와 식별 정보만 유지합니다. popup의 로컬 미리보기 `visits`는 유효하지만 순서 미확정인 방문(`sequence: null`)도 표시합니다. `readyVisits: PageVisit[]`에는 앞선 후보가 모두 종료되어 서버 전송 순서가 확정된 방문만 포함됩니다. 확정된 번호·visitId·방문 원본은 유지되며 제외 후보는 번호를 소비하지 않습니다. 앞선 열린 탭 때문에 `readyVisits`가 지연될 수 있습니다. Issue #43에서는 이 `readyVisits`만 순차 전송하며, 방문 전송 checkpoint와 ACK를 별도로 관리합니다.

Worker checkpoint에는 `sequenceVersion: 1`을 저장합니다. 이전 sequence 형식의 서버 세션 checkpoint는 기존 ID·본문·체류시간·후보 순서를 보존해 복구하고 과거 후보 번호를 새 정책으로 변환합니다. 서버 응답이 없는 구 개발용 로컬 세션은 업그레이드 시 중단합니다. 이전 버전은 서버 전송을 하지 않았으므로 이미 전송된 번호를 변경하는 마이그레이션이 아닙니다. 브라우저/확장 reload 후에는 session storage를 복구하지 않으며, local에 남은 정상 생성 정보로 명시적 재시도를 요구합니다.

| 유효 `PageVisit` 필드 | 값 |
| --- | --- |
| `visitId`, `sessionId`, `sequence`, `browserTabKey` | FE UUID v4, BE 응답의 sessionId, 확정 유효 방문 순서(미리보기는 null 가능), 세션 내 탭 UUID |
| `normalizedUrl`, `domain`, `title`, `content` | 정책 통과한 정규화 URL, hostname, 제한된 제목/주요 본문 |
| `visitedAt`, `activeDurationMs` | 후보 관찰 UTC ISO 시각, 누적 최소 활성시간(ms) |
| `isSearchResultPage`, `searchQuery` | 검색 방문은 `true`와 실제 URL 검색어, 일반 HTML은 `false`와 `null` |
| `tabSwitchCount`, `behaviorVersion` | 방문별 누적 이탈 횟수, 행동 값이 변경될 때 증가하는 방문별 버전 |

`docs/data-collection-spec.md`와 BE-003의 논리 필드를 기준으로 타입을 만들었으며, 로컬 미리보기와 서버 요청 DTO는 구분합니다. Issue #43의 `visitRequest()`가 현재 BE DTO로 필드를 선택하며 서버 세션 ID·UTC 밀리초 시각·`(session_id, sequence)` 유일성·visitId 원본 비교 계약을 따릅니다.

## FE-005·006 행동 정보 정책 (Issue #32)

`docs/fe-spec.md`와 `docs/be-spec.md`는 방문별 배분·버전의 일부를 미확정으로 두지만, `docs/data-collection-spec.md` 5~6절과 현재 BE `applyBehavior`는 이전 방문 귀속 및 누적값·버전 계약을 명시합니다. 이를 적용하며 기존 새로고침·SPA·검색·유효성·sequence 정책은 유지합니다.

- **활성시간:** 탭과 비최소화 Chrome 창이 모두 활성인 구간만 ms로 정산합니다. 문서 교체, 탭 전환/종료, 창 비활성화 및 세션 종료에서 마지막 구간을 닫습니다. `leave` 이후에는 새 문서나 현재 문서의 재등록 전까지 상태 조회/중복 창 이벤트만으로 측정을 재개하지 않습니다. 뒤로 움직인 시계는 이전 정산 경계를 넘은 부분만 더합니다.
- **탭 전환:** A → B에서는 A 방문에 1회, B → A에서는 B 방문에 1회를 더합니다. 초기 탭 결정, 동일 탭 중복 활성화, URL 이동/새로고침/SPA, 백그라운드 탭 생성, 단순 창 포커스 해제는 제외합니다. 다른 Chrome 창의 탭으로 이동하면 실제 전경 탭 ID 변경으로 1회만 집계합니다. 비활성 창 내부의 탭 선택은 집계하지 않습니다.
- **미수집 탭/닫기:** 권한이 없거나 수집 제외인 탭으로 전환해도 이전 수집 방문의 이탈은 셉니다. 목적지의 URL/본문은 추가 수집하지 않습니다. 탭 닫기 자체는 전환이 아니며, 다른 전경 탭이 확인되면 닫힌 방문에 마지막 1회를 반영합니다. `onRemoved`와 `onActivated` 순서에 상관없이 한 번만 집계합니다. 닫기 후 대체 활성화가 없으면 전환은 0회입니다. 창 비활성 중 마지막 탭이 자동 이동해도 이탈은 마지막으로 실제 활성화되었던 방문에 귀속합니다.
- **버전:** 새 후보는 세 값 모두 0으로 시작합니다. 양의 시간 정산 또는 전환 횟수 증가마다 해당 방문의 `behaviorVersion`을 1 올립니다. 한 이벤트에서 둘 다 변경하면 두 번 증가할 수 있으며 버전 연속 전송은 요구하지 않습니다. 값이 같으면 버전도 그대로입니다. `status().visits`/`readyVisits`는 후보와 분리한 값 복사본이므로 이미 반환한 버전의 스냅샷은 이후 변경되지 않습니다. 내부 타이머 경계는 외부 결과에 노출하지 않습니다.
- **방문 확정 이후:** `finalized`와 `sequence`는 방문 순서/콘텐츠 확정을 뜻합니다. 닫힌 탭의 대체 활성화가 늦게 도착하면 행동 정보만 높은 버전으로 갱신할 수 있습니다. 세션 종료 이후에는 최종 행동 값도 고정합니다. 향후 재시도는 보관한 동일 스냅샷을 보내고, 최신 값은 새 버전의 갱신 요청으로 보내야 합니다.
- **MV3:** 창·탭 이벤트는 수신한 ID/시각과 창별 선택 탭 캐시를 사용해 단일 직렬 실행기 안에서 처리하고 `storage.session`에 값·버전·측정 경계·마지막 활성 방문을 함께 저장합니다. Worker 재기동 시에는 같은 탭이 다시 전경이어도 마지막 checkpoint 이후의 확인할 수 없는 구간을 누적하지 않습니다. 저장된 값·버전을 보존하고, 새 창/탭 이벤트 또는 실제 상태 조회로 확인한 시점부터 측정을 재개합니다. 따라서 정상 idle 종료였어도 checkpoint 이후 구간은 과소 측정될 수 있습니다. 비동기 조회 결과는 조회 완료 시점의 상태로만 사용하며, 과거 수신 시각으로 소급하지 않습니다. 일반 페이지 등록/이동 메시지는 이미 알려진 전경 상태를 임의의 최신 조회로 덮어쓰지 않습니다. 브라우저/확장 reload 후 자동 세션 재개를 하지 않는 정책은 유지합니다.
- **구 checkpoint:** 측정되지 않았던 전환은 0, 기존 체류시간이 있으면 최초 버전은 1(없으면 0)로 초기화합니다. 과거 탭 전환은 복원할 수 없습니다. 기존 식별자·본문·체류시간·확정 sequence를 보존합니다. 이전 checkpoint는 서버 전송을 하지 않았던 개발용 상태입니다.

Issue #32는 상태와 스냅샷 준비까지였으며 Issue #34에서 서버 세션 ID를 적용했습니다. Issue #43은 BE-003 방문 생성과 고정된 초기 요청 스냅샷 재시도를 구현합니다. Issue #46은 POST ACK 이후 BE-006 행동 PATCH와 로컬 종료 후 최종 행동 ACK를 구현합니다. 서버 종료 요청과의 ACK 순서는 후속 작업입니다.

## 테스트

```sh
npm test
npm run build
npm run build:dev
# 실제 브라우저 테스트용 바이너리 설치 (최초 1회)
npx playwright install chromium
npm run test:browser
# 이미 설치된 Chrome for Testing/Chromium을 지정할 수도 있음
CHROMIUM_PATH="/absolute/path/to/browser" npm run test:browser
# 화면이 보이는 테스트 (선택)
HEADED=1 npm run test:browser
```

브라우저 테스트는 임시 프로필·로컬 HTTP API 모의 서버·합성 문서와 요청 가로채기로 제공한 Google·Naver URL의 합성 검색 문서를 사용합니다. 실제 Spring Boot·MySQL 및 검색 서비스 검증과 구분합니다. 임시 빌드의 API 주소만 모의 서버로 지정하고 dist는 변경하지 않습니다. 응답 유실 뒤 Worker 재시작·동일 키 재시도·중복 시작 차단·서버 세션 ID 일치를 검사합니다. 자동 실행을 위해 **테스트용 manifest 복사본에만 localhost·Google·Naver 호스트 권한을 사전 부여**하며, 배포 manifest의 사이트별 선택 권한은 바꾸지 않습니다. popup, 메시징, 세션 전/후 차단, 본문, 새로고침, 뒤로가기, SPA, 탭 재사용, sequence, 민감 페이지/짧은 본문 제외를 실제 MV3 런타임에서 검증합니다. Google Chrome Stable의 unpacked 로드와 권한 허용 dialog는 아래 수동 절차로 추가 확인합니다.

추가 창 포커스·최소화·복원 시나리오는 `HEADED=1`에서 실행합니다. headless Chrome for Testing은 여러 창을 동시에 focused로 보고할 수 있으므로 기본 실행에서는 이 시나리오만 `SKIP`으로 명시합니다. 복구 시 포커스 조회 결과가 모호하면 측정을 중지하고 확실한 이벤트를 기다립니다.

Issue #34 보완 브라우저 시나리오는 실제 Worker에 checkpoint 저장 오류를 한 번 주입하고 재시작 후 HTTP 재요청 없이 동일 세션·방문으로 복구하는지 검사합니다. 손상된 pending 레코드는 두 번의 Worker 재시작과 Popup 기록 삭제 이후에도 원본이 보존되고 신규 시작이 차단되는지 확인합니다. 이는 모의 HTTP API와 합성 저장 오류를 사용한 MV3 검증이며 실제 BE·MySQL 장애 검증과 구분합니다.

수동 검증 항목:

1. popup을 열기 전/세션 시작 전 방문해도 기록이 생성되지 않는지 확인합니다.
2. 사이트 권한을 거부하면 수집하지 않는지 확인하고, 허용 후 이미 열린 탭과 새 탭 모두 수집되는지 확인합니다.
3. 정상 문서에서 1초 이상 머무른 뒤 하나의 유효 방문이 생성되는지 확인합니다. 1초 미만에 떠나거나 본문이 50자 미만인 경우 유효 기록이 없어야 합니다.
4. 새로고침 및 탭 복귀는 ID/sequence를 유지하고, 다른 문서 이동과 뒤로/앞으로가기는 새 ID를 갖는지 확인합니다.
5. SPA의 Query가 다른 문서 이동 시 URL+주요 본문이 바뀌면 새 방문이 생기고, Fragment/메뉴/댓글 변경은 중복을 만들지 않는지 확인합니다.
6. 두 탭을 빠르게 탐색해 sequence 중복이 없는지 확인합니다. Chrome 최소화/다른 프로그램으로 이동한 시간은 늘어나지 않아야 합니다.
7. 로그인·결제·민감 form·오류·PDF·영상·짧은 본문 페이지는 유효 목록에 없어야 합니다. 숨김/입력 필드의 합성 비밀값도 결과에 없어야 합니다.
8. Google/Naver는 아래 검색 브라우저 검증 절차를 수행합니다. 검색어가 없으면 `search-pending`, 결과가 없으면 8초 대기 후 `unavailable-content`이며 유효 목록에 없어야 합니다.
9. 세션 종료 후 새 방문을 생성하지 않는지, 기록 삭제와 권한 철회가 동작하는지 확인합니다.
10. Service Worker가 idle 종료된 후 popup을 다시 열어 세션·방문 ID·순서를 복구하는지 확인합니다 (DevTools가 worker를 계속 살려둘 수 있으므로 닫고 검사). 브라우저 재시작 시 자동 수집을 재개하지 않아야 합니다.

## 미구현·후속 작업 및 명세 차이

- 정식 제품 UI 및 FE-003 서버 종료 연동. Issue #34에서 `POST /api/sessions` 생성은 연동했고, GET 조회와 `POST /api/sessions/{sessionId}/end` 종료는 아직 FE에서 호출하지 않습니다.
- 활성 체류 10초 시점의 AI 분석 예약과 최종 누적 행동의 실제 전송은 후속 연동 범위입니다. 현재는 확정된 방문을 저장할 때 초기 행동 스냅샷을 보내며, 이후 확정 행동값이 바뀌면 Issue #46의 PATCH를 전송합니다. 반복 분석 요청은 만들지 않습니다. 기존 명세의 10초 분석 시점과 `readyVisits` 순서 확정 지연의 조정도 후속 FE·BE 협의가 필요합니다.
- IndexedDB 영속 전송 큐·브라우저 재시작 복구·END_PENDING, AI 분석/분류/알림/사용자 선택, 대량 데이터셋 구축. 방문 생성 POST·순차 전송·ACK·제한된 재시도는 Issue #43에서 구현했습니다.
- 현재 문서/DOM 휴리스틱은 민감 페이지를 완벽하게 판별하지 못하며 안전한 form 포함 문서나 비표준 본문/Shadow DOM/iframe도 제외할 수 있습니다. 민감 페이지로 판정된 SPA 문서는 새 문서 navigation 전까지 제외를 유지합니다. 실제 공개 샘플로 selector/판정을 추가 검증해야 합니다.
- 수집 규격은 탭 복귀 재사용, FE UUID 및 IndexedDB 복구를 명시하지만 FE/BE 통합 명세는 일부 항목을 미확정/BE ID로 기재합니다. 이번 작업은 사용자 지시대로 수집 규격을 우선하며 원본 명세는 변경하지 않습니다.
- Issue #9에서는 최소 유효성 측정만 구현했고, Issue #32에서 방문별 누적 활성시간·탭 전환·행동 버전 관리를 보완했습니다. 확정 방문의 행동 전송은 Issue #46에 구현했고, 진행 중 방문의 10초 분석 예약은 후속 범위입니다.
- 서버 세션 생성은 연동했지만 방문 checkpoint는 여전히 `storage.session` 기반입니다. 수집 규격의 방문 디스크 영속성·전송 큐·서버 종료 요구는 후속 작업입니다.
- 프로젝트의 보장 대상은 Windows 11 Chrome Stable입니다. macOS Chrome for Testing 자동 검증만으로 이 플랫폼의 최종 검증 완료를 주장하지 않습니다.

참고: [Issue #9](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/9), [Chrome Service Worker 생명주기](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Playwright 확장 테스트](https://playwright.dev/docs/chrome-extensions).

## Issue #9에서 복사한 과거 검증 기록 (2026-10-12)

- `npm test`: 5개 파일, **79개 테스트 성공**.
- `npm run build`, `npm run build:dev`: 타입 검사 및 두 확장 번들 빌드 성공.
- `npm run dev`: 초기 빌드/두 watcher 실행 및 필수 산출물 유지 확인 후 종료.
- `npm run test:browser`: macOS **Chrome for Testing 151.0.7922.34**의 임시 프로필에서 성공. 앞/뒤 탐색과 CDP로 worker를 중단한 뒤 세션/ID/sequence 복구도 포함.
- `git diff --check`: 성공.
- Chrome Stable의 실제 toolbar 권한 dialog, 외부 프로그램 포커스 전환 및 Windows 11 환경은 수동 검증하지 않았습니다. 최소 지원 버전 Chrome 106도 별도 실행 검증이 필요합니다.


## FE-007 검색 수집 정책 (Issue #21)

### 지원 URL과 검색어

- Google: `http(s)://[www.]google.com/search?q=...`. 기존 정책의 `google.co.kr`, `google.co.uk`, `google.co.jp`, 2자리 국가 도메인도 동일한 `/search` 경로로 식별합니다. 국가 도메인·모바일 DOM은 모두 실측 검증된 지원 범위가 아닙니다.
- Naver: `http(s)://search.naver.com/search.naver?query=...`, `m.search.naver.com`의 동일 경로. 실제 DOM 검증은 데스크톱 `search.naver.com`입니다.
- URL API로 정규화 **전에** Google `q` 또는 Naver `query` 하나만 디코딩하고, 공백을 한 칸으로 정리합니다. `+`, `%2B`, 한글 인코딩을 처리하며 다른 파라미터·Fragment를 검색어에 합치지 않습니다.
- 파라미터 누락·빈 검색어·중복 파라미터·제어문자·500 Unicode code point 초과는 추정하거나 잘라서 저장하지 않습니다. 500자는 개발용 메시지/메모리 제한이며 서버 계약이 아닙니다.
- 다른 검색 엔진·사이트 내부 검색에는 검색 플래그나 검색어를 부여하지 않습니다. 일반 HTML 수집 정책은 별도로 적용됩니다.

### 유기적 결과 구조

`src/content/search.ts`에서 서비스별 추출을 분리했습니다. 결과 컨테이너, 표시되는 제목, 실제 HTTP(S) 제목 링크를 함께 확인합니다. 제목이 확인되면 설명이 없어도 1건이며, 검색창·메뉴·추천어·AI 브리핑·미확인 영역을 결과로 계산하지 않습니다.

| 서비스 | 현재 판별 근거 | 설명 추출 | 검증 상태 |
| --- | --- | --- | --- |
| Google | `#search #rso` 안의 `.MjjYud`/`.g`, `a[href] h3` | `[data-sncf]`, `.VwiC3b`, `.IsZvec` | 합성 HTML/MV3 검증만 완료. 실제 서비스는 차단되어 **실제 DOM 미확인** |
| Naver | `#main_pack .fds-web-root .fds-web-list-root > .fds-web-doc-root.fds-web-normal-doc-root`와 제목 링크의 `headline1`; 기존 `web/…`·`ugcItem/searchBasic`도 유지 | 새 카드는 같은 목적지 링크의 `body1`만 연결하며 모호한 다중 제목/설명은 제외 | 2026-10-19 실제 데스크톱 영어/한국어 수집·전용 DB 저장 확인. [#60 보고서](../docs/naver-search-dom-fix-validation.md) |

Naver의 해시형 클래스는 사용하지 않습니다. Google의 클래스 변경, Naver의 다른 섹션/모바일/실험 레이아웃은 추출 실패할 수 있습니다. 근거가 부족하면 전체 body 텍스트로 대체하지 않습니다. 같은 제목 DOM의 중첩 wrapper와 같은 제목·설명은 중복 계산하지 않습니다.

#60 재현 테스트는 `npm test -- tests/search-live-dom.test.ts`로 기본 실행됩니다. `RUN_KNOWN_SEARCH_BUG` 조건과 SKIP은 제거했습니다. 실제 서비스 재검증은 새 전용 DB(label `focus-recovery.issue=60`)와 본인이 시작한 로컬 BE를 확인한 뒤 `INTEGRATION_API_BASE_URL`, `INTEGRATION_MYSQL_CONTAINER`, `CHROMIUM_PATH`를 지정해 `HEADED=1 node scripts/naver-search-integration-test.mjs`로 실행합니다. 실제 공개 검색 3회(영어·한국어·결과 없는 검증어)만 요청하고 원문은 출력하지 않습니다.

`content`는 `검색어: …`, `검색 결과 N`, `제목: …`, 선택적 `설명: …` 구조이며 총 **5,000 Unicode code point** 제한을 적용합니다. 제한 내에 온전한 제목을 보관할 수 없는 결과는 세지 않습니다. 별도 서버 검색 결과 배열/DTO/`searchedAt`은 추가하지 않았습니다. `PageSnapshot.organicResultCount`는 내부 판정 근거이며 `PageVisit`에서 제거합니다.

### 광고·민감정보

- 광고 컨테이너(`#tads`, `#tadsb`, `#bottomads`, `#power_link`, `.ad_section` 등), 광고 데이터 속성, 결과 wrapper의 광고/스폰서 라벨, 광고 전용 링크 호스트를 제외합니다. 숨김·form·입력·편집·메뉴 영역도 기존 텍스트 정리에서 제거합니다.
- 기존 URL 인증정보·민감 파라미터·경로 정책을 그대로 적용합니다. 결과 링크도 이 정책을 통과해야 하며 링크 URL 자체는 저장하지 않습니다.
- 검색 페이지에서만 동일 origin/검색 경로를 대상으로 하는 `role=search` 또는 Naver `nx_search_form`의 검색 필드·hidden/submit 필드 구성, 입력이 전부 hidden인 옵션 form을 허용합니다. 비밀번호/인증/연락처/결제 입력, 다른 form·편집 영역은 여전히 문서 전체를 제외합니다. **입력값은 읽지 않습니다.** 일반 HTML의 form 제외 정책은 유지합니다.
- Background는 타입/길이/빈 검색어/결과 건수/서비스·호스트·정규화 URL을 검사하고, 현재 Chrome frame URL에서 직접 추출한 검색어 및 해시와 비교합니다. 알 수 없는 snapshot 필드도 거부해 원본 URL·임의 DTO가 저장되는 것을 방지합니다.
- 검색어·결과 본문은 허용된 작업 세션의 메시지, trusted `chrome.storage.session`의 수집·전송 checkpoint, 사용자가 직접 요청한 개발 popup 데이터 표시와 설정된 BE 방문 저장에 사용합니다. 로그·`storage.local`에는 보관하지 않습니다. Issue #43부터 확정 방문은 BE로 전송하며, 로컬 삭제는 이미 전송한 서버 기록을 삭제하지 않습니다.

### 대기·상태·SPA

검색 방문은 활성 세션, 사이트 허용, 지원 URL, 실제 검색어, 유기적 결과 1건, 활성 체류 1,000ms, 제외 정책 통과를 모두 요구합니다. 일반 HTML의 50자 기준을 적용하지 않습니다.

초기 결과 없음은 payload 없이 pending으로 보내며 기존 MutationObserver, 350ms debounce/최대 1.5초 대기, 350ms·1s·2s·4s 재시도를 사용합니다. 검색 URL 해시가 바뀌면 대기 기준을 다시 설정하고 약 **8초** 뒤에도 결과가 없으면 pending 후보를 `unavailable-content`로 제외해 payload를 지웁니다. observer는 남아 있으므로 나중에 실제 결과가 나타나면 동일 문서 후보를 복구할 수 있습니다. Worker 복구에는 기존 session checkpoint를 사용합니다.

이미 valid인 방문은 결과의 일시적 로딩 실패/검색어 누락으로 삭제하지 않습니다. 새 실패 후보는 다른 정상 방문에 영향을 주지 않습니다. 민감 DOM/URL 제외는 기존 개인정보 삭제 정책을 우선합니다.

정규화 전 URL에서 Fragment만 제외해 계산한 SHA-256과 결과 콘텐츠 변경을 **함께** 검증합니다. SPA 결과 비교에서는 검색어/번호/고정 라벨을 제거하고 기존 양방향 32자 조각·60% 기준을 재사용하되 50자 최소 길이만 해제합니다. 검색어만 변경, 결과 추가만 발생, 메뉴 mutation은 신규 방문을 만들지 않습니다. 동일 결과 새로고침/탭 복귀는 ID·sequence·tab key를 유지하고 다른 문서의 뒤/앞 탐색은 새 방문을 만듭니다.

### 실제 검색 브라우저 검증

1. `npm run build` 후 위 절차로 확장을 로드합니다. BE 서버를 실행한 뒤 Google와 Naver **각 origin에서** 수집을 허용하고 작업 세션을 시작합니다.
2. `Spring Boot JWT`, `스프링 부트 인증` 등 공개 검증어를 검색하고 결과 탭을 1초 이상 활성화합니다. `isSearchResultPage=true`, 실제 `searchQuery`, Query/Fragment 없는 URL, 제목·설명이 있는 content를 확인합니다.
3. 광고가 포함된 검색과 결과 없는 검색에서 광고가 content에 없고, 실제 유기적 결과 0건이면 8초 뒤 제외되는지 확인합니다. 차단/동의/CAPTCHA 화면은 성공으로 처리하지 않습니다.
4. 새로고침/탭 복귀의 ID·sequence 재사용, 새 검색/뒤·앞 탐색의 신규 ID, SPA URL만 변경의 중복 방지, 결과 지연 로딩을 확인합니다.
5. Worker 중단 후 재기동해 검색어·본문·후보 상태·ID·sequence가 유지되는지 확인합니다. 종료 후 기록을 삭제합니다.

합성 MV3 테스트: `CHROMIUM_PATH="/absolute/path/to/browser" npm run test:browser`.
실제 서비스 점검(선택): `CHROMIUM_PATH="/absolute/path/to/browser" node scripts/live-search-check.mjs`.
실제 점검 스크립트는 설정된 BE 서버가 필요하며 서버에 검증용 세션을 생성합니다. 종료 후 서버는 ACTIVE로 남을 수 있습니다. 임시 프로필/테스트용 manifest에는 기존 API 권한을 보존하고 Google·Naver 수집 권한을 사전 부여합니다. 요청을 가로채지 않으며 상태/건수/일치 여부만 출력합니다. 공개 검증어만 사용하고 임시 기록은 종료 시 삭제합니다. `HEADED=1`로 화면을 볼 수 있습니다.

### 제한·명세 해석

- **Google은 실제 DOM 검증 미완료입니다.** 보수적인 selector가 합성 테스트를 통과한 상태이며 실제 서비스 지원이 검증됐다고 간주하지 않습니다. 차단되지 않는 사용자 Chrome에서 위 수동 검증이 필요합니다.
- 모바일·국가 도메인·동의 화면·개인화/A/B 레이아웃·Shadow DOM·iframe·보이지 않는 결과·비표준 snippet은 놓칠 수 있습니다. Naver UGC/웹 결과 외 다른 섹션은 일부러 확대하지 않았습니다.
- 개인정보/광고 판정은 보수적인 구조/URL 휴리스틱입니다. 일반 공개 결과 문구나 검색어 자체에 포함된 개인정보를 완벽하게 제거하는 DLP 기능은 구현하지 않았습니다.
- 8초 대기, 검색어 500자, 내부 건수 100건, 짧은 검색 결과 SPA 비교는 명세의 미확정 항목을 개발용 구현에서 제한한 값입니다. 원본 명세나 서버 계약은 변경하지 않았습니다.
- FE-005/006 전체 행동 측정, 정식 UI, BE/AI 연동, IndexedDB 큐는 범위 밖입니다.

### 작업 기반 복원

시작 시 detached HEAD `d1435751878fe4494b128dc40329e3c00d3af2a5`, 미커밋 변경 없음. PR #15는 병합됐지만 마지막 커밋 `8386d64`가 FE 소스/테스트를 삭제한 상태라 최신 upstream/main에는 README만 있었습니다. 사용자 승인에 따라 Issue #9 worktree의 **현재 FE 파일 28개**를 복사해 FE-004 안정성 수정과 기존 **102개 테스트**를 보존한 후 FE-007을 확장했습니다. 다른 worktree는 변경하지 않았습니다. 최초 구현 보고 시점에는 커밋/푸시/PR 생성을 수행하지 않았습니다.


### Issue #21 파일 변경 목록

복사한 FE-004 기반 대비 수정 11개:

- `README.md`
- `scripts/browser-test.mjs`
- `src/background/collector.ts`, `src/background/index.ts`
- `src/content/extraction.ts`, `src/content/index.ts`
- `src/shared/url.ts`, `src/shared/types.ts`, `src/shared/messages.ts`, `src/shared/content-change.ts`
- `tests/background.test.ts` (기존 내용 그대로, 검색 테스트 8개 추가)

FE-007 신규 7개:

- `src/content/search.ts`
- `scripts/live-search-check.mjs`
- `tests/search-url.test.ts`, `tests/search-extraction.test.ts`, `tests/search-collector.test.ts`, `tests/search-messages.test.ts`, `tests/search-content.test.ts`

그대로 복원한 나머지 FE-004 기반 17개:

- `.gitignore`, `package.json`, `package-lock.json`, `popup.html`, `public/manifest.json`
- `tsconfig.json`, `vite.config.ts`, `vite.content.config.ts`, `scripts/dev.mjs`
- `src/background/active-time.ts`, `src/background/serial.ts`, `src/popup/index.tsx`, `src/popup/style.css`
- `tests/collector.test.ts`, `tests/extraction.test.ts`, `tests/messages.test.ts`, `tests/url.test.ts`

최신 main 대비 README 수정 1개와 신규 파일 34개로 보이는 것은 위 기반 복원이 포함됐기 때문입니다. 의존성과 lockfile, 원본 명세, BE·AI 영역은 변경하지 않았습니다.

### Issue #21 검증 기록 (2026-10-14)

- Vitest: 기존 **102개**를 삭제/완화하지 않고 검색 테스트 **90개 추가**, **10개 파일 / 192개 테스트** 성공.
- `npm run typecheck`, `npm run build`: 성공.
- `npm run test:browser`: 설치된 Chrome for Testing **151.0.7922.34**를 `CHROMIUM_PATH`로 지정하여 성공. 기본 실행은 Playwright 요구 바이너리가 설치되어 있지 않아 실패했으며 기존 설치된 브라우저로 재검증했습니다. 합성 검색 응답에 대한 MV3 테스트이며 실제 서비스 성공을 의미하지 않습니다.
- 실제 Naver: 영어 검색 16건/3,971자, 한국어 검색 17건/4,086자, 광고 포함 샘플 23건/4,398자의 유기적 결과 기반 content 및 실제 검색어 확인. 검색어/본문 원문은 로그로 출력하지 않았습니다. 실제 광고 컨테이너가 있는 페이지도 확인했습니다. 새로고침 ID·sequence 재사용, 다른 검색으로 뒤/앞 이동의 신규 ID·검색어, 결과 없는 희소 검색의 `unavailable-content` 제외를 확인했습니다. 이 건수는 확인 시점의 샘플 결과이며 서비스 결과 변화로 달라질 수 있습니다.
- 실제 Google: MCP 브라우저에서 HTTP 429 차단, 확장을 로드한 Chrome에서도 영어/한국어 모두 결과 화면 밖으로 이동했습니다. 차단 화면은 `dom-policy`로 제외됐고 **실제 유기적 결과 DOM/수집 성공은 확인하지 못했습니다**.
- 동적 로딩/검색 SPA/두 탭/Worker 복구/빈 결과에서 기존 방문 보존은 합성 자동 테스트로 검증했습니다. 실제 서비스 전체 조합과 Windows 11 Chrome Stable/권한 dialog/모바일은 수동 검증이 남습니다.
- `git diff --check`: 성공. 최초 구현 검증 당시 Git은 `feat/21/search-query-collection`, HEAD `d143575`, 미커밋 변경 상태였습니다.
- 기존 lockfile의 개발 의존성 audit 결과: `@vitest/mocker` moderate, `tinypool` critical, `vitest` critical (총 3건). 해결 제안은 Vitest 메이저 업데이트라 이 Issue에서 의존성을 변경하지 않았습니다. [mocker advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [tinypool advisory](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3). 배포 확장 번들에 포함되는 운영 의존성은 아닙니다.
- 권장 커밋 메시지: `feat(#21): Google·Naver 검색어 및 유기적 검색 결과 수집`. 최초 구현 보고 시점에는 커밋·푸시·PR 생성을 수행하지 않았습니다.


### Git 검증 및 Fork Push 구성 (2026-10-14)

- 원격 최신 참조 확인 후 `origin/main`, `upstream/main`, 작업 브랜치의 기준은 모두 `d1435751878fe4494b128dc40329e3c00d3af2a5`입니다. 불필요한 Merge/Rebase나 main 변경을 하지 않았습니다.
- 복원 당시 28개 파일의 해시가 Issue #9 worktree의 현재 파일과 모두 일치함을 확인했습니다. 이 정확한 스냅샷을 첫 커밋에 스테이징하고 FE-007 변경을 두 번째 커밋으로 분리합니다. 작업 파일을 삭제/교체하거나 다른 worktree를 수정하지 않습니다.
- 최종 추적 대상은 FE 파일 35개입니다. BE·AI·공통 명세 변경, 인증정보, `.env`, 브라우저 프로필, 로컬 테스트 산출물은 포함하지 않습니다. `node_modules`, `dist`, `coverage`, `*.local`은 기존 `.gitignore`로 제외합니다.
- Commit 전 Vitest 192개(기존 102개 + 신규 90개), 타입 검사, 빌드 및 MV3 브라우저 테스트를 다시 실행해 모두 통과했습니다. Google의 실제 검색 결과 DOM 검증은 접근 차단으로 여전히 미완료입니다.
- Push 대상은 개인 Fork의 `origin/feat/21/search-query-collection`입니다. Force Push, PR 생성, Merge는 수행하지 않습니다.

현재 개인 수집 정책 v5는 실제 제목·최대5,000 Unicode 본문·허용된 검색어를 수집합니다. HMAC URL/기존 동의·격리·전송 계약과 함께 `pageContent`를 검증하며 이전 정책은 호환 경로로 유지합니다. [설치·재동의·데이터 계약](../docs/data-collection/page-content-collection.md), [실제 E2E·회귀 검증](../docs/data-collection/page-content-validation.md).
