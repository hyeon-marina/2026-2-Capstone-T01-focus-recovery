# 사용자 알림 비교 평가 및 고정 주기 연동

[Issue #139](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/139) · [기준 main 및 PR #138 병합 커밋](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/commit/6bb0bdd3ac211b680cd6e7a981eeb698b42c1a12)

## 알림 실행

사용자용 v2 합성 빌드와 루프백 Mock의 `USER_ALERT_MODE`를 각각 `AI` 또는 `FIXED_INTERVAL`로 설정한다. 기본값은 AI다. Worker는 세션 생성 요청 전에 모드를 시작 의도 및 멱등 키와 함께 저장한다. 시작 ACK가 유실되면 저장된 모드로 시작을 재시도한다. Worker와 Chrome 재시작 시 같은 값을 복원한다. Chrome 재시작으로 세션 저장소의 자격정보가 사라지면 같은 계정으로 재인증한 뒤 알림을 재개한다. 이전 버전의 모드 필드가 없는 세션은 기존 AI 경로로 복원한다. 합성 빌드는 이 모드를 시작 시점에 주입한다. [Worker](../fe/user/background.ts) · [영속 상태](../fe/src/v2/state.ts) · [시작 의도와 예약](../fe/src/v2/runtime.ts)

| 구분 | AI | FIXED_INTERVAL |
| --- | --- | --- |
| 후보 확인 | `GET /api/sessions/{id}/analysis-status` | `POST /api/sessions/{id}/alerts/fixed-interval` |
| 유효성 | 현재 세션, DRIFT, 최신 Window·stateVersion·analysisId 일치 | 현재 세션, 최초 목표, 현재 로컬 회차에서 받은 BE ID, 미표시 |
| 상세 화면 안내 | 목표 이탈 안내 | 작업 중간 점검 안내 |
| 공통 | 최초 목표, 두 선택 버튼, Chrome 제출 상태와 Outbox | 최초 목표, 두 선택 버튼, Chrome 제출 상태와 Outbox |

고정 주기 회차는 `floor((현재 시각 - startedAt) / 600000)`으로 구한다. 첫 회차 전에는 POST를 보내지 않는다. Chrome의 일회 알람을 다음 경계에 등록하고 기존 주기 알람과 탐색으로도 확인한다. 실행이 늦으면 가장 최근 회차만 확인한다. 요청을 합치고 확인한 회차와 알림 ID를 IndexedDB에 저장한다. 완료한 조회는 같은 Worker에서 재요청하지 않는다. POST 응답 유실이나 Worker 재시작 후 미표시 후보 재확인에는 BE의 같은 회차 `200` 재사용을 이용한다. 두 회차 사이에 도착한 응답이나 다른 회차에서 이미 사용한 알림 ID는 폐기한다. 이전 회차의 예약 및 Chrome 알림을 정리하고 상세 화면을 만료시킨다. 접근·세션 종료가 시작되면 후속 호출과 지연 응답의 반영을 차단한다. [스케줄링과 Chrome 전달](../fe/user/analysis.ts) · [BE 회차 처리](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertService.java)

POST의 `AlertResponse`는 `analysisId`, `windowIndex`, `shownAt`을 명시적 `null`로 반환하고 `windowId`, `stateVersion`을 생략한다. v2 분석 조회의 `V2AlertResponse`는 다섯 필드를 모두 `null`로 제공한다. 두 응답에서 `scheduledAt`은 생략되며 `createdAt`은 후보 생성 시각을 뜻한다. Spring/H2 테스트는 회차 예정 시각부터 7초 뒤에 후보를 생성해 두 DTO와 DB의 예정 시각을 검증한다. `FIXED_INTERVAL_DISABLED`에서는 현재 회차를 닫고 AI로 전환하지 않는다. `ALERT_INTERVAL_NOT_REACHED`도 현재 회차를 닫으며 `SESSION_ENDED` 및 인증·동의·격리 거절은 접근을 중단한다. [POST 응답 검증](../fe/user/fixed-interval.ts) · [Spring 계약 테스트](../be/src/test/java/com/focusrecovery/domain/alert/FixedIntervalAlertTest.java)

## 표시와 영수증

두 모드는 기존 R3 예약, 제출 대기, 제출 확인, 불확실, 닫힘, 폐기 상태를 사용한다. Worker가 중단되면 Chrome의 긍정적인 제출 증거를 확인한다. 이미 Chrome 제출을 시작한 알림은 결과가 불확실해도 다시 만들지 않는다. 고정 주기 상세 열기와 선택은 세션 조회를 통해 유효한 소유·동의·활성 세션을 다시 확인한다. 상세 화면은 활성 탭에서 렌더링된 뒤 최초 표시 시각을 저장한다. `RETURN_TO_GOAL`과 `CONTINUE_BROWSING`은 최초로 접수한 선택을 보존하며 페이지 이동을 강제하지 않는다. [공통 상세 화면](../fe/user/alert-page.tsx) · [Worker 명령 검증](../fe/user/background.ts)

R4 독립 Outbox는 두 모드의 최초 표시와 선택 및 유형을 같은 세션·알림 ID 아래 저장한다. 기존 영수증은 선택과 시각을 보존하고 전달 경로에서 정상 처리한다. 표시 PATCH와 선택 POST, 서버 이력 대조, Backoff 및 이전 세션 복구를 공통으로 사용한다. 이력 및 표시 ACK의 유형도 검증한다. 이미 선택한 영수증을 복구할 때 알림을 다시 표시하지 않는다. [Outbox 저장소](../fe/src/v2/notification-store.ts) · [ACK 및 이력](../fe/src/v2/notifications.ts)

PR #138 기준 코드에 새 회귀 테스트만 적용하자 접근 차단 후 지연된 `verifyAccess()`는 Outbox 접근을 복원했고, 반대 순서에서는 지연된 Outbox 검증이 실제 표시 PATCH까지 보냈다. 두 검증은 이제 접근 Epoch와 Credential 세대에 더해 동일한 요청 순서를 사용한다. 최신 검증이 반영되면 더 오래된 응답으로 상태를 덮을 수 없다. 현재 세션 소유자에 대한 검증과 같은 자격정보로 접근할 수 있는 이전 세션 영수증의 전송은 계속 독립적으로 처리한다. 회귀 테스트에서 두 순서 모두 로컬 미확인 기록을 보존했고, 새 정상 검증 이후 원본을 한 번 전송했다. [접근 검증과 회귀 테스트](../fe/tests/user-session.test.ts)

## 합성 비교 결과

Chrome for Testing 151.0.7922.34에서 모드마다 새 임시 프로필, 동일한 합성 목표·시나리오, 같은 40분 2초의 가상 수행 시간을 사용했다. 실제 Chrome Notifications API 콜백 또는 목록을 사용해 제출을 확인했다. 알림 클릭은 테스트용 Worker에 캡처한 Chrome 클릭 리스너를 호출했고 선택은 Chrome 상세 화면의 실제 버튼으로 입력했다. Chrome은 첫 표시 PATCH의 끊어진 연결을 자체 재시도할 수 있어 Outbox가 미확인 상태를 저장할 때까지 동일 응답의 유실을 유지했다.

| 항목 | AI | FIXED_INTERVAL |
| --- | ---: | ---: |
| 집계 세션 / 합성 수행 시간 | 1 / 40분 2초 | 1 / 40분 2초 |
| BE 후보 생성 | 3 | 3 |
| Chrome 제출 확인 / 불확실 | 2 / 1 | 2 / 1 |
| 상세 표시 / 로컬 선택 | 2 / 2 | 2 / 2 |
| 서버 이력의 표시 / 선택 | 2 / 2 | 2 / 2 |
| 표시 ACK / 선택 ACK | 2 / 2 | 2 / 2 |
| 목표 복귀 선택 / 비율 | 1 / 50% | 1 / 50% |
| 탐색 계속하기 선택 / 비율 | 1 / 50% | 1 / 50% |
| 상세 표시부터 선택까지 평균 | 30.95초 | 30.95초 |
| 수행 시간당 Chrome 제출 확인 | 3.00건 | 3.00건 |
| 복구 전 → 후 미확인 영수증 | 1 → 0 | 1 → 0 |
| 상세 표시 후 로컬 선택이 기록되지 않은 건수 | 0 | 0 |
| 충돌 기록 / 제외 세션 | 0 / 0 | 0 / 2 |

모드별 평가 표본은 정상 종료한 첫 세션이다. 후속 세션은 이전 선택 ACK 복구를 확인하는 데 사용했다. 모드 불일치와 동의 철회로 제외한 고정 주기 세션의 사유는 리포트에 남겼다. 고정 주기는 9분 59.999초에 요청 0건, 10분 경계에서 후보 1개였다. 첫 POST 응답 유실 후 같은 ID를 받았고, 20분 회차를 건너뛰어 30분 회차 하나를 만들었다. 분석 실패와 분석 조회 503 중에도 유효한 고정 후보를 제출했다. 이전 회차의 미표시 상세 화면, 회차 경계를 넘은 POST 응답, 계정 전환 및 철회 중에 도착한 후보의 차단도 확인했다.

### 집계 규칙

- 종료된 합성 세션의 기존 알림 이력 GET을 페이지 끝까지 읽고 현재·보관 대상의 로컬 제출 상태 및 Outbox와 대조한다. 동일한 세션 및 알림 ID의 같은 증거는 한 번 센다. 종료 이후에도 영수증이 갱신될 수 있어 복구 전후를 각각 집계한다. 활성 세션의 Offset 페이지네이션에는 조회 도중 새 행이 생길 수 있다.
- BE 후보 건수는 대상 모드의 서버 이력에 있는 고유 후보 수다. 충돌 또는 무효화 후보의 존재도 생성 건수에 남기고 표시·선택 집계에서 격리한다. 충돌한 시간, 유형, 세션, 선택과 무효화·격리 기록은 사유와 함께 남긴다.
- 선택률 분모는 평가 가능한 로컬 선택 수다. 평균은 같은 선택의 `selectedAt - shownAt`을 사용한다. 시간당 빈도 분모는 평가 세션의 합성 수행 시간 합계다. 분모가 0이면 JSON `null`, 표기 `N/A`를 쓴다.
- 로컬 선택이 있고 ACK가 확인되지 않은 영수증은 미확인으로 기록한다. Chrome 제출의 의미는 브라우저 API 확인까지다. OS 배너 노출과 열람은 여기서 측정하지 않는다. 목표 복귀 버튼은 선택 의사를 남긴다. 실제 집중 회복과 참여자 효과는 별도 실험에서 확인할 항목이다.
- 평가 조건이 깨진 세션은 알림 권한 거부, 비교 실행을 중단시킨 서버 오류 또는 개인정보 철회와 같은 사유를 붙여 분모에서 제외한다. 잠깐의 ACK 유실처럼 종단 이력을 확인할 수 있는 오류는 영수증 상태에 남긴다. 합성 시계, 강제 클릭, 장애 주입은 통합 동작을 비교하기 위한 조건이다. [집계](../fe/scripts/user-evaluation.mjs) · [Chrome 시나리오](../fe/scripts/user-browser-test.mjs)

## 재현

아래 명령은 `fe`에서 실행한다. 각 자동화는 루프백 서버와 새 Chrome 프로필을 만들고 끝날 때 정리한다. Chrome for Testing이 Playwright 기본 위치 밖에 있으면 `CHROMIUM_PATH`를 지정한다.

```sh
npm ci
USER_ALERT_MODE=AI npm run build:user
fixed_build=$(mktemp -d)
USER_ALERT_MODE=FIXED_INTERVAL npx vite build --mode user-mock --config vite.user.config.ts --outDir "$fixed_build"
npx vite build --config vite.synthetic.content.config.ts --outDir "$fixed_build"
USER_FIXED_EXTENSION="$fixed_build" USER_TEST_EVIDENCE="$(mktemp -d)" npm run test:user:browser -- --evaluation
npm run test:user:browser
npm run test:user:browser -- --outbox-only
```

수동 실행은 같은 `USER_ALERT_MODE` 값으로 `npm run build:user`와 `npm run mock:user`를 실행한 뒤 새 Chrome 프로필에 `dist-user`를 로드한다. 합성 인증·동의 후 작업 목표를 입력한다. AI는 합성 문서를 탐색해 DRIFT 후보를 만들고, 고정 주기는 세션 시작 후 첫 10분 경계에 후보를 확인한다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| FE `npm run typecheck`, `npm test` | PR #138 기준 1,170건 재현. 변경 후 55개 파일, 1,194건 통과(+24). 기본 실행의 opt-in HTTP 2건은 별도 Spring/H2·Mock FastAPI에서 통과했다. |
| FE 빌드 | 사용자 합성 AI·FIXED_INTERVAL, v1·dev·synthetic·participant·pilot·real 빌드 통과. 참가자·real 잠금 빌드는 수집 차단을 실제 Chrome에서 확인했다. |
| Spring/H2 | 전체 1,150건 중 954건 통과, 196건 조건부 건너뜀, 실패 0건. 고정 주기 16건, 표시·선택 19건, 이력 14건이 포함된다. |
| Spring/H2 + Mock FastAPI + Chrome | 인증·동의·철회 HTTP 및 기존 pilot·real 제어 HTML 검증 통과. pilot·real 각각 Visit 10건, Window 8건과 Worker·Chrome 재시작을 확인했다. |
| 실제 Chrome v1 | 탐색, 창 전환·최소화·복원, 전달·종료 및 체크포인트 회귀 통과. |
| 실제 Chrome 합성 비교 | AI와 고정 주기에서 목표 입력·후보·Chrome 전달·상세·ACK·세션 종료를 확인했다. 회차 경계, 모드 불일치, 계정 전환 및 철회 시 늦은 응답 차단을 재현했다. |
| 실제 Chrome 사용자 R2·R3·R4 | 기존 사용자 회귀 18개를 통과했다. 목표 입력, 탐색·수집, 분석 알림, Chrome 제출 중단·복구, 두 선택 및 세션 전환을 확인했다. |
| 실제 Chrome R4 Outbox와 이전 빌드 이관 | 독립적인 Backoff·소진·수동 확인, 올바르지 않은 ACK와 충돌, 계정 격리를 통과했다. PR #136의 Chrome IndexedDB에서 현재·이전 세션 영수증 이관을 재현했다. |
| 실제 Chrome 합성 v2 | 인증·동의, 탐색·수집, 기존 상세 알림, Worker·Chrome 재시작, 철회 복구를 통과했다. |
| 실제 Chrome RAW_ONLY | 별도 임시 MySQL에서 Visit 10건, Window 0건을 확인했다. 네트워크, Worker 및 Chrome 재시작 복구를 통과했다. |

기존 AI Chrome 회귀의 재인증 직후 알람은 진행 중인 분석 조회에 합쳐질 수 있었다. 테스트가 다음 알림 관측까지 알람을 다시 전달하도록 보정했다.

## 실제 사용자용 계약 협의

서버의 알림 모드는 전역 설정이다. 실제 사용자 도입 전에 서버가 승인한 세션별 모드·배정과 고정 주기 설정의 전달 방법을 합의해야 한다. Fixed POST의 모드 비활성 응답이나 분석 상태의 다른 유형 후보는 불일치 증거가 된다. AI 빌드에서 후보가 없는 상태만으로는 서버 모드를 확인할 수 없다. 현재 DTO에는 예정 회차가 없으므로 합성 실행은 Worker·서버 시계를 동기화한다. 운영에서는 서버가 확인한 회차 또는 `scheduledAt`, 서버 시계와 허용 편차, 경계 너머 응답 및 기존 후보의 표시 자격을 정의해야 한다. 평가 실행은 인증·동의·권한·철회 처리와 비교 표본 제외 기준을 팀과 협의한 뒤 실제 참여자에게 적용한다.
