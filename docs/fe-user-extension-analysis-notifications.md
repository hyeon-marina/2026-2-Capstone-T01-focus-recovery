# 사용자용 v2 분석 상태와 Chrome 알림

[Issue #135](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/135)는 사용자용 합성 빌드에 분석 조회와 DRIFT 알림을 연결한다. 개발 기준은 Issue #133 구현이 포함된 [PR #134 병합 커밋](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/commit/b1a3786b4ea418801c1960da8ad1b47ac9eecefe)이다.

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

AI 후보는 활성 세션, 최초 목표와 최신 DRIFT의 Window·분석 ID·버전에 일치해야 한다. 후보의 관계나 목표가 틀린 응답은 최신성 기준을 갱신하기 전에 거절한다. 정상적인 확정 응답에서 후보가 바뀌거나 사라지면 이전 알림을 정리한다. 조회 실패나 오래된 응답을 받으면 이전 최신 알림을 유지하고, 다음 검증이 성공할 때까지 상세 진입과 선택을 차단한다. OS 배너에는 일반 안내 문구만 사용한다.

## Worker 중단과 Chrome 알림 복구

초기 구현 커밋 `14f1cb0`에서 예약이 IndexedDB에 커밋된 직후 권한 조회를 보류한 채 Chrome CDP로 Worker를 중단했다. Chrome의 활성 알림 목록은 비어 있었다. 재시작 뒤 같은 DRIFT 후보를 다시 조회했지만 제출 시도는 0건이었다. 최초 구현에서 예약 레코드의 존재가 Chrome API 호출 여부까지 대신했기 때문이다.

`fe/user/analysis.ts`는 Chrome 채널과 복구를, `fe/src/v2/runtime.ts`는 현재 세션의 영속 전환을 담당한다. `state.ts`와 `repository.ts`는 기존 사용자 IndexedDB 레코드에 아래 단계를 저장하고 검사한다. `status.ts`는 후보 식별자와 목표가 일치하는 응답만 최신성 검사에 사용한다.

| 영속 단계 | 의미와 복구 정책 |
| --- | --- |
| `reserved` | 후보 및 상세 키를 저장했다. Chrome API 호출 가능 단계에 들어가기 전이다. Worker 재시작 후 현재 소유자, 인증·동의·Epoch, 저장 상태, 세션과 최신 BE 후보, 호스트 및 알림 권한을 확인한다. 동일 Chrome ID가 목록에 없고 이 조건이 충족되면 제출한다. |
| `submitting` | Chrome API를 호출하기 직전에 기록한 인계 단계다. 재시작 시 `uncertain`으로 복원한다. |
| `presented` | 같은 Chrome ID의 생성 성공 응답을 받았거나 `getAll()`에서 해당 ID를 확인했다. OS 배너 표시나 열람은 별도 증거가 필요하다. |
| `uncertain` | 인계 이후 완료 증거가 없거나 Chrome 응답이 모호하다. 초기 구현의 단계 없는 레코드도 여기에 해당한다. 후속 검증에서 같은 ID가 목록에 있으면 `presented`로 조정한다. 목록에 없는 경우 추가 생성을 보류한다. |
| `dismissed` | Chrome이 `onClosed(byUser=true)` 이벤트를 전달했다. 사용자가 닫았음을 기록한다. 목록에서 사라진 `presented` 알림도 추가 생성이 차단된다. |
| `retired` | 미제출 예약이 최신 후보에서 탈락했거나 종료·계정 전환·로그아웃·철회·호스트 권한 해제를 받았다. 이전 예약은 이 상태에서 재제출 대상에서 제외된다. |

Chrome ID는 `focus-drift:<BE alertId>`를 사용한다. Chrome은 같은 ID로 `create()`를 호출하면 기존 알림을 교체하므로, 같은 ID 자체만으로는 중복 개입을 막을 수 없다. Worker는 같은 세션·접근 상태의 조회를 합치고, Chrome API 접근을 직렬화하고, IndexedDB에서 현재 상세 키와 제출 단계가 일치할 때 전환한다. 권한 거부 같은 제출 전 차단은 유효한 예약을 남겨 다음 검증에서 처리한다. Chrome API 인계 뒤에는 긍정적인 Chrome 증거에 따라 조정하며, 결과를 알 수 없는 호출에는 추가 생성 시도를 하지 않는다. [Chrome Notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications)

IndexedDB와 Chrome API 사이에 단일 원자적 트랜잭션이 없다. 인계 단계 커밋 직후 API 호출 전에 Worker가 중단되거나, Chrome이 알림을 생성하기 전에 실패했지만 호출 효과를 확정할 수 없으면 알림이 누락될 수 있다. Chrome이 알림을 이미 닫아 목록에서 사라진 경우와 구분할 수 없는 구간이다. 이 구간에서는 반복 개입 방지를 우선한다. 상태 전환은 표시·선택 영수증과 독립적이다.

## 상세 화면과 기록

1. Worker가 Chrome 클릭을 받으면 최신 상태와 호스트·알림 권한을 다시 확인한다. 현재 세션의 후보가 유효할 때 알림용 로컬 키로 확장 상세 탭을 연다. 상세 탭과 선택 명령은 동일 Extension ID, 정확한 상세 URL, 주 프레임과 활성 문서, 세션·후보를 검사한다. [Chrome 메시지 발신자](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
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

1. 독립 Chrome 테스트 프로필을 열고 `chrome://extensions`의 개발자 모드에서 **압축해제된 확장 프로그램을 로드합니다**로 `fe/dist-user`를 선택한다.
2. 도구 모음의 확장 팝업에서 [Issue #133의 합성 계정](fe-user-extension-implementation-issue133.md#빌드-설치-및-실행)으로 인증하고 합성 동의를 저장한다. 최초 목표를 입력하고 **작업 시작**을 누른다.
3. 팝업을 닫고 [합성 문서 a](http://127.0.0.1:8911/__focus_synthetic__/a)부터 b, c, d 순으로 같은 활성 창과 탭에서 탐색한다. 각 페이지를 5초 이상 본다. CLI Mock은 새 유효 Visit 순서에 따라 PENDING → NORMAL → TRANSITION → DRIFT를 적용한다. NORMAL과 TRANSITION에서는 알림이 없다. 마지막 DRIFT에는 후보가 포함되고 다음 탐색 또는 1분 주기 Chrome 알람에서 확인한다. API는 `http://127.0.0.1:8912`에 바인딩한다.
4. Chrome 알림을 클릭해 열린 확장 상세 탭에서 최초 목표를 확인한다. **목표로 돌아가기** 또는 **탐색 계속하기**를 선택한다. 상세 탭의 **서버에 기록했어요** 문구와 Mock 터미널의 `POST /responses 201 <action>`을 확인한다. 표시 요청이 먼저 도착하면 `PATCH /shown 200`도 출력된다. 터미널 출력은 메서드·상태 코드·선택 enum만 포함한다.
5. 팝업을 다시 열고 **작업 종료**를 누른 뒤 종료 완료를 확인한다. Chrome 프로필과 Mock 서버 프로세스는 시연별로 격리한다.

자동 검증은 별도 Chrome 프로필에서 Mock을 시작한다. 응답 보류, 503과 접속 유실, 잘못된 세션·Window 응답, 표시·선택 ACK 유실을 주입할 수 있다.

```sh
npm run typecheck
npm test
CHROMIUM_PATH='/absolute/path/to/Google Chrome for Testing' npm run test:user:browser
CHROMIUM_PATH='/absolute/path/to/Google Chrome for Testing' npm run test:user:browser -- --recovery-only
```

## 검증 결과

2026-11-25~26 KST에 macOS 27.2.1, Chrome for Testing 151.0.7922.34, Node.js 25.9.0에서 확인했다. 최초 R3 구현에서 기본 테스트 1,153건, 별도 HTTP 2건과 사용자 E2E 11개가 통과했다.

| 검증 | 추가 개선 결과 |
| --- | --- |
| FE 타입 검사 및 `npm test` | 통과. 기본 1,157건 통과. 신규 4건은 단계 복원과 폐기, 지연 표시 ACK의 세션 경계, 잘못된 후보의 최신성 오염을 검사한다. |
| 별도 FE HTTP | 기존 인증·동의 및 철회 2건 통과. 분리 Spring/H2와 합성 FastAPI를 사용했다. |
| 사용자용과 기존 빌드 | 사용자용, v1, 개발, synthetic, participant, pilot, real 모두 통과. 빌드는 예시 루프백 origin과 사이트를 비운 DRAFT 정책으로 확인했다. |
| 사용자용 Chrome E2E | 전체 18개, 별도 `--recovery-only` 7개 통과. 기존 11개에 Worker 복구 7개를 추가했다. |
| CLI Mock 실행 가이드 | 격리된 헤드리스 Chrome에서 a~d 탐색, 네 상태, 팝업 닫힘 상태의 실제 알림 등록, 클릭 리스너, 최초 목표, PATCH/POST ACK와 종료를 확인했다. 헤디드 자동 시도에서는 첫 Visit 이후 PENDING을 관측하지 못했다. |
| 기존 v1·v2 Chrome | 헤디드 v1의 창 전환·최소화·복원과 오류 복구, v2의 합성 HTTP·SPA·기존 알림·철회·재시작 통과. |
| participant·pilot·real·RAW Chrome | participant 시작 잠금과 real DRAFT zero-site 잠금 통과. 격리 Spring/H2와 Mock FastAPI에서 pilot 카탈로그 및 real 통제 HTML 각각 10 Visit·8 Window, Worker·Chrome 재시작을 확인했다. RAW는 새 임시 MySQL에서 합성 10 Visit·0 Window와 네트워크·Worker·Chrome 복구를 통과했다. |

| Worker 복구 시나리오 | 최초 구현 | 추가 검증 |
| --- | --- | --- |
| A · 예약 직후 중단 | 자동 누락을 재현했다. | 권한 확인을 보류한 채 예약 커밋을 확인하고 CDP로 Worker를 중단했다. 재시작 후 현재 후보를 확인하고 Chrome 생성 1회와 목록 등록을 확인했다. |
| B · API 인계 후 중단 | 예약의 존재로 일괄 차단했다. | 결과 전달을 보류했다. Chrome 목록에 있으면 제출 완료로 조정하고 비어 있으면 불확실 상태로 유지한다. 두 경우 모두 추가 생성은 0회였다. |
| C · Chrome 제출 성공 직후 중단 | API 성공을 별도 저장하지 않았다. | Chrome 콜백 성공 후 IndexedDB 트랜잭션을 보류하고 Worker를 중단했다. 재기동 뒤 기존 항목을 대조해 추가 생성 없이 제출 완료로 조정했다. |
| D · 사용자 닫기 | 예약 덕분에 반복 표시를 막았다. | 실제 Chrome 항목을 지우고 사용자 닫기 이벤트를 재현했다. 닫음 단계가 보존됐고 재기동 뒤 추가 생성은 0회였다. |
| E · 후보 및 접근 무효화 | 현재 후보와 접근 검사를 거쳤다. | NORMAL, 신규 Window, 동일 Window의 PENDING, 로그아웃, 계정 변경, 인증 만료, 세션 종료·교체, 동의 철회에서 이전 예약의 재생성을 차단했다. |
| F · 동시 조회와 상세 탭 | 같은 접근 범위에서 요청을 합쳤다. | 생성 콜백을 보류한 동안 탐색·여러 알람·팝업 새로고침을 겹쳤다. 추가 HTTP 조회와 Chrome 생성은 없었고, 두 상세 탭에서 요청한 선택은 첫 한 건만 저장했다. |
| G · 권한 및 API 오류 | 권한 거부를 검사하고 예약을 보존했다. | 제출 전 권한 거부와 복구, 무효화된 후보 및 권한 거부 뒤 기존 클릭을 차단했다. 존재하지 않는 알림 아이콘으로 실제 Chrome API 오류를 발생시키고 재시작 시 중복 없이 불확실 상태를 보존했다. 철회 중 예약도 폐기했다. |

검증에는 격리된 Chrome 프로필을 사용했다. 사용자용 헤드리스 검증에서 실제 Chrome 알람과 Notifications API 호출, 콜백 및 `getAll()` 결과를 관찰했다. 권한 전환은 테스트의 권한 조회 결과를 제어했고, 시스템 클릭은 임시 확장 복사본에 등록된 리스너를 호출했다. 장애 주입 코드는 테스트 복사본에만 포함된다.

| 표시 검증 | 판정 |
| --- | --- |
| Chrome API 호출·생성 | 실제 Chrome의 성공 응답과 활성 알림 목록으로 확인 |
| 클릭 Handler 및 상세 렌더링 | 등록 리스너 호출로 검증. 최초 작업 목표와 사용자 선택·ACK 확인 |
| 네이티브 OS 배너와 물리 클릭 | `BLOCKED`. 현재 macOS 자동화 환경에서 시스템 UI 접근성이 비활성이다. 격리 프로필 시연에 OS 설정 변경을 적용하지 않았다. |
| 사람의 실제 열람 | `NOT_VERIFIED`. 상세 화면 커밋과 서버 ACK만 측정한다. |

R6에서 네이티브 알림 표시를 관찰할 수 있는 독립 테스트 기기와 OS 알림 허용 상태를 준비한다. OS 배너를 실제로 클릭해 상세와 선택 ACK를 확인하고 집중 모드에서의 동작도 검증한다. R1 사용자용 BE 계약, R4 보관 영수증 Outbox, R5 고정 주기 평가 및 R6 운영 BE·AI는 후속 범위다.
