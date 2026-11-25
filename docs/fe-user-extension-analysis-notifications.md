# 사용자용 v2 분석 상태와 Chrome 알림

Issue #133 구현이 포함된 [PR #134 병합 커밋](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/commit/b1a3786b4ea418801c1960da8ad1b47ac9eecefe)을 기반으로 사용자용 합성 빌드에 분석 조회와 DRIFT 알림을 연결했다.

## Background 조회

- 사용자용 MV3 Worker가 등록 즉시 이벤트 수신을 시작하고, IndexedDB 로드와 기존 활성 세션 재연결을 기다린다. 기존 인증·동의 검증과 세션 ID, 최초 목표, 시작 시각 대조가 끝나면 처음 조회한다.
- 별도 `user-analysis` 알람이 1분 간격으로 조회를 요청한다. Worker 시작 시 알람 유무를 확인하고 누락된 알람을 다시 등록한다. 최상위 탐색 커밋, History API 변경, URL fragment 변경도 조회를 요청하며, 동일 접근 상태에서는 탐색 조회 간격을 5초로 제한한다. 페이지 URL은 분석 상태 요청에 사용하지 않는다. 팝업을 열 때 한 번 최신 조회를 요청하고, 화면의 500ms 상태 확인은 Worker 스냅샷을 읽는다. 동일 세션과 접근 상태의 겹치는 트리거는 진행 중인 10초 제한 HTTP 요청을 공유한다. Chrome이 알람을 늦게 실행할 수 있고 기기 절전 중에는 조회가 지연된다. [Chrome Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms) · [MV3 Worker 수명 주기](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- `GET /api/sessions/{sessionId}/analysis-status`는 고정 Mock origin의 인증 HTTP 클라이언트를 사용한다. Worker는 시작 전과 응답 후에 현재 활성 세션, 검증된 소유자와 동의, 호스트 권한, 인증 만료, 접근 Epoch, 재연결·저장 실패·격리 상태를 검사한다. 로그아웃, 계정 전환, 동의 철회, 종료 의도가 들어오면 바로 알림 접근을 차단한다. 원격 인증·동의 실패는 조회를 중단하며, 권한은 다음 탐색이나 알람에서도 확인한다. [Worker](../fe/user/analysis.ts) · [런타임](../fe/src/v2/runtime.ts)

## 상태와 최신성

| BE 결과 | 사용자 화면 및 처리 |
| --- | --- |
| `currentDecision: null` | 분석 결과 없음. 이미 Window를 확인한 세션의 빈 응답은 최신 결과로 수용하지 않는다. |
| `PENDING` | 분석 대기. 같은 Window의 대기 상태를 처음 확인한 지 90초가 지나면 분석 지연으로 표시한다. |
| `FAILED`, `INVALIDATED` | 각각 분석 실패, 분석 무효화로 표시한다. |
| `COMPLETED` | BE의 NORMAL, TRANSITION, DRIFT 판단을 각각 정상 탐색, 전환 탐색, 목표 이탈로 표시한다. |
| 연결 실패 또는 HTTP 5xx | 분석 지연과 서버 연결 실패를 표시한다. |
| 계약 위반 또는 이전 결과 | 분석 상태 확인 불가로 표시하고 후보 전달을 중단한다. |

`currentDecision`에 따라 UI 및 알림을 결정한다. `lastSuccessfulState`는 성공 이력을 검증하고 같은 Window의 마지막 완료 버전을 비교하는 데 사용한다. 이전 성공 결과로 대기·실패·무효화 상태를 대체하지 않는다. `V2StatusClient`는 응답 버전과 세션 일치를 확인한 뒤 Window 순서와 ID, 상태 버전과 분석 ID를 비교한다. 같은 Window가 다시 대기 또는 실패 상태가 되면 이전 완료 버전은 다시 사용할 수 없다. 무효화된 Window의 이전 판정도 거절한다. 사용자용 Worker는 검증된 기준을 현재 세션의 IndexedDB 체크포인트에 기록하고, 재시작 후 같은 기준에서 비교한다. 새 세션은 첫 Window부터 검증한다. [상태 검증](../fe/src/v2/status.ts) · [v2 계약](contracts/v2/README.md)

AI 후보는 활성 세션, 최초 목표 및 최신 DRIFT의 Window와 분석 ID·버전이 일치해야 한다. 후보가 없는 DRIFT는 알림을 제출하지 않는다. Worker는 유효성이 사라진 후보를 정리한다. 조회 실패나 오래된 응답을 받으면 기존에 제출했던 최신 알림은 유지하고, 다시 검증하기 전까지 상세 진입과 선택을 차단한다. 알림 ID로 BE의 `alertId`를 사용하고, 같은 세션에서 제출을 시도하기 전에 해당 ID를 IndexedDB에 예약한다. 재시작 뒤에도 예약된 ID의 Chrome 알림 생성은 반복하지 않는다. Worker가 예약 직후 종료되거나 Chrome 응답이 유실되면 실제 제출 여부를 확인하기 어렵다. 이 경우 예약을 유지하므로 해당 알림을 놓칠 수 있다. Chrome이 권한을 거부한 상태에서 조회한 신규 후보는 권한 복구 후 다시 검사한다. OS 배너에는 일반 안내 문구만 사용한다. [Chrome Notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications)

## 상세 화면과 기록

1. Worker가 Chrome 클릭을 받으면 상태를 다시 조회한다. 현재 세션의 후보가 유효할 때 알림용 로컬 키로 확장 상세 탭을 연다. 상세 탭과 선택 명령은 동일 Extension ID, 정확한 상세 URL, 주 프레임과 활성 문서, 세션·후보를 검사한다. [Chrome 메시지 발신자](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
2. 상세 화면은 최초 작업 목표와 목표 이탈 안내를 표시한다. 활성 탭에서 목표를 렌더링하고 표시를 확인한 뒤 `alert-shown`을 보낸다. 기존 `recordShown()`이 영수증을 저장하고 `PATCH /api/sessions/{sessionId}/alerts/{alertId}/shown`을 보낸다. 같은 상세 화면을 다시 열어도 최초 `shownAt`을 유지한다.
3. `alert-select`는 `RETURN_TO_GOAL` 또는 `CONTINUE_BROWSING`만 받는다. 서버의 최신 결정, 접근 권한과 로컬 영수증을 다시 확인한다. `selectAlert()`가 선택을 저장한 뒤 `POST /api/sessions/{sessionId}/alerts/{alertId}/responses`를 보낸다. 첫 선택만 저장하며, 화면은 로컬 접수와 서버 ACK를 구분한다. 기존 탐색 탭의 주소나 접근 상태를 변경하지 않는다.

| 시점 | 이번 검증에서 관측하는 값 |
| --- | --- |
| BE 후보 생성 | BE의 `createdAt` |
| Chrome 제출 | API 호출 전에 기록한 제출 예약과 Chrome 응답. 알림 센터에 등록돼도 OS 배너의 화면 표시나 열람은 별도로 관측해야 한다. |
| 상세 화면 표시 | 목표가 렌더링된 활성 상세 탭이 보낸 확인을 Worker가 수신한 시각을 `shownAt`으로 기록한다. |
| 선택 및 서버 확인 | Worker가 선택 명령을 수신한 시각이 `selectedAt`이다. 원본 영수증과 일치하는 서버 응답을 검증한 뒤 ACK를 기록한다. |

Mock은 표시 전 후보만 상태 응답에 반환하는 기존 BE 동작을 따른다. 이미 해당 후보의 `shownAt` 영수증이 있고 최신 판정이 동일한 DRIFT라면, 후보가 응답에서 빠져도 상세 탭에서 선택을 마칠 수 있다. 같은 판정에서 후보를 별도로 철회하거나 만료하는 정책을 도입한다면 사용자용 BE가 후보의 종료 여부를 조회할 수 있게 합의해야 한다. 사용자용 BE 통합 전에는 `shownAt`을 상세 화면 노출로 셀지, OS 노출·열람 지표를 별도로 어떻게 집계할지 정한다.

R4는 기존 `NotificationReceipt`와 `sendNotification(sessionId, receipt)`를 재사용할 수 있다. 현재 세션의 영수증은 Worker 재시작 뒤 원본 시각으로 재전송할 수 있다. 종료 후 새 세션을 시작하면 기존 저장소가 이전 세션과 미확인 영수증을 함께 `session/{sessionId}` 레코드에 보존한다. 활성 세션 전송기는 이 보관 데이터를 읽지 않는다. 보관된 영수증의 세션별 Outbox 및 재전송은 R4의 연동 지점이다. [영수증과 ACK](../fe/src/v2/notifications.ts) · [세션 보관](../fe/src/v2/repository.ts)

## 합성 재현

```sh
cd fe
npm ci
npm run build:user
npm run mock:user
```

격리 Chrome 프로필에 `dist-user`를 설치하고 Issue #133의 합성 계정으로 로그인해 동의와 작업 시작을 마친다. 팝업을 닫고 합성 문서 a~d를 각각 활성 탭에서 5초 이상 탐색한다. CLI Mock은 유효한 새 Visit 순서에 따라 PENDING → NORMAL → TRANSITION → DRIFT 합성 상태를 적용한다. 마지막 DRIFT는 BE 후보 객체를 함께 제공한다. 기존 API `127.0.0.1:8912`와 합성 탐색 `127.0.0.1:8911`을 사용한다. 다른 사용자 계정, 운영 백엔드, A/B/C 수집 데이터에는 연결하지 않는다. [설치 및 합성 계정](fe-user-extension-implementation-issue133.md) · [Mock](../fe/scripts/user-mock.mjs)

자동 검증은 별도 Chrome 프로필에서 Mock을 시작한다. 응답 보류, 503과 접속 유실, 잘못된 세션·Window 응답, 표시·선택 ACK 유실을 주입할 수 있다.

```sh
npm run typecheck
npm test
CHROMIUM_PATH='/absolute/path/to/Google Chrome for Testing' npm run test:user:browser
```

## 검증 결과

2026-11-25 KST, macOS의 Chrome for Testing 151.0.7922.34와 Node.js 25.9.0에서 검증했다.

| 검증 | 결과 |
| --- | --- |
| FE 타입 검사 및 `npm test` | 타입 검사와 기본 테스트 1,153건 통과. 기본 실행의 선택 실행 2건도 별도 Spring/H2와 Mock FastAPI로 통과했다. |
| 사용자용, v1, synthetic, participant, pilot, real 빌드 | 모두 통과. participant는 합성 HTTPS 주소, pilot은 루프백, real은 사이트를 비운 저장소의 DRAFT 정책으로 빌드했다. |
| `npm run test:user:browser` | 11개 시나리오 통과. 팝업이 닫히고 다른 페이지를 탐색할 때 Chrome의 실제 알람과 Notifications API 제출을 확인했다. 상태별 차단, 버전·Window·세션 경계, Worker 재시작, 중복과 표시·선택 ACK 유실, 인증 만료·로그아웃·철회도 확인했다. |
| 기존 v1·v2 Chrome | 헤디드 v1의 창 전환·최소화·복원, v2의 합성 전송·SPA·재시작·기존 알림 UI·철회 통과. |
| participant·pilot·real Chrome | participant 시작 잠금과 real DRAFT zero-site 잠금 통과. pilot 합성 카탈로그와 real 통제 HTML은 격리 Spring/H2 및 Mock FastAPI에서 각각 10 Visit·8 Window와 Worker·Chrome 재시작을 확인했다. |

Headless Chrome 테스트는 실제 알람과 알림 제출을 실행하고 Chrome의 알림 목록을 확인한다. OS 클릭 경로는 임시 확장 복사본에 등록된 클릭 리스너를 호출하고, 권한 거부·재허용은 권한 조회 결과를 제어해 검증한다. 네이티브 배너 표시, OS 알림 센터에서의 물리 클릭, 집중 모드의 동작은 수동 검증 항목으로 남는다. 실제 사용자용 BE와 운영 AI 모델 검증은 후속 통합 범위다.
