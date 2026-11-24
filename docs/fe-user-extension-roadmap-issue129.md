# Issue #129 사용자용 Chrome Extension 개발 계획

기준 `020cb1ff9612c3e95f3df694d5818d2e81fdd7bf`. 사용자용 진입점과 합성 UI부터 착수할 수 있다. 실제 자유 목표 v2 연결은 사용자 정책과 세션 계약이 선행 조건이다. DRIFT의 서비스 수준은 Worker 알림 전달과 영수증 복구를 함께 검증한 뒤 판단한다. [FE 점검](fe-user-extension-audit-issue129.md) · [FE–BE 계약·재현](fe-be-user-integration-issue129.md)

## 권장 구조

사용자용 Manifest/entry를 별도로 만들고 v2 모듈을 재사용한다. 개발 작업의 첫 조각은 Mock transport를 쓰는 사용자용 시작·진행·종료/복구 화면이다. 제품용 권한과 수집 정책은 승인된 계약에 따라 결합한다.

| 구조 | 초기 변경·복잡도 | 수집 회귀·테스트 격리 | 유지보수·시연 |
| --- | --- | --- | --- |
| `participant/` 확장 | 낮아 보이나 배정 선택, Attempt, 정책 Digest, 복구 우회와 제품 분기가 한곳에 쌓여 중~높음 | 동일 진입점/Manifest에서 수집 권한과 UI를 바꾸므로 회귀 위험 높음. 관리·사용자 E2E를 함께 세팅 | 기존 화면/ACK UI 재사용은 쉽지만 수집용·사용자용 릴리스가 결합됨. [현재 화면](../fe/participant/index.tsx) |
| `popup/` v2 연결 | 목표 형식/Popup 화면 재사용, v1 Worker·메시지·저장/권한 wiring 교체가 필요해 중~높음 | v1 기본 빌드/권한 회귀 위험. 작은 팝업은 독립 alert를 맡기 어렵다 | 간단한 목표/진행 화면에 유용. 제품 연결 시 두 Runtime 계약이 한 entry에 섞이기 쉽다. [v1 팝업](../fe/src/popup/index.tsx) · [v1 Worker](../fe/src/background/index.ts) |
| 별도 `user/` entry + v2 모듈 **권장** | 새 Manifest·Popup·Worker 조립과 channel 인터페이스, 중간 규모. v1의 UX와 v2의 Runtime·전송기 재사용 | 테스트/Extension ID/DB namespace 격리, 기존 빌드에 영향이 적다. 새 승인 프로필만 별도 검증 | 목표→작업→개입→복구를 보여주면서 수집 관리 화면도 독립 시연 가능. 유지관리할 빌드 하나가 추가된다. [v2 Runtime](../fe/src/v2/runtime.ts) · [저장소](../fe/src/v2/repository.ts) |

제안 파일은 `fe/user/index.html`, `fe/user/index.tsx`, `fe/user/background.ts`, `fe/vite.user.config.ts`다. 사용자 알림 상세는 같은 extension 내부 route나 작은 별도 페이지에 둔다. Worker가 인증·세션·권한·수집·상태 조회·알림·영수증의 상태를 소유하고 UI는 message로 명령을 보내며 필요한 snapshot만 받는다. 공유 후보는 `V2Runtime`, `V2Repository`, `V2Collector`, 인증/동의·철회 및 세 전송기다. `installV2Browser`의 배정/현장 보고 및 합성 catalog 결합부는 사용자 entry에 그대로 설치하지 않는다. 사용자 사이트 정책·메시지 sender 검사·정제는 수집용 제약을 보존해 공통화할 수 있는 부분만 뽑는다. 사용자용 ID/저장소는 기존 IDB를 migrate하거나 가져올 필요 없이 공존하게 한다. [배정 wiring](../fe/src/v2/browser.ts#L21) · [Runtime transport](../fe/src/v2/runtime.ts#L426)

### 사용자 화면과 보존 정보

| 화면 | 표시·명령 |
| --- | --- |
| 목표 입력 및 시작 | 발급된 계정과 정책/동의 상태, 목표와 허용 범위, 5~150자 검증. START_PENDING은 같은 요청 키로 복구, 세션 생성 후에만 수집 상태를 표시한다. |
| 진행 | 현재 목표와 ACTIVE, 확인된 연결/수집 상태, 접근 중지·오프라인·재인증 안내, 종료 버튼. `currentDecision`이 비어 있거나 PENDING/FAILED면 결과 대기/지연을 표현한다. BE의 최종 상태만 사용한다. |
| DRIFT 및 사용자 선택 | 수집 관리 화면과 독립된 Chrome 알림. 상세를 열면 활성 세션/후보를 확인한 뒤 최초 목표와 복귀/계속 버튼을 보여준다. 두 선택은 의사를 기록하며 페이지를 강제로 이동하거나 차단하지 않는다. 서버 저장 대기·확인·거절을 구분한다. |
| 종료 및 복구 | 종료 의도 접수 시 즉시 관찰/신규 알림 중지. END_PENDING, 안전한 재시도, 서버 ACK 후 ENDED, 정책 철회/재인증을 구분한다. 미전송 영수증은 정책에 따라 독립적으로 복구한다. |

배정 목표·시나리오, Attempt, POST/PATCH ACK, RAW_COLLECTED, 수집 품질, 관리자용 재수집, 내부 Digest는 기존 관리 화면에 둔다. 사용자용 화면은 재연결/종료처럼 사용자가 해결할 수 있는 상태만 보여준다. [기존 화면](../fe/participant/index.tsx#L77) · [기능 요구사항](fe-spec.md)

## 알림 채널 비교와 권장 계약

| 채널 | 독립성·권한·복잡도 | 표시 관측·UX·검증 |
| --- | --- | --- |
| A. Chrome Notifications + extension 상세 **권장** | 관리 화면/사이트 DOM과 독립. Manifest `notifications`, Worker 시작 시 이벤트 등록, 알람·저장된 상호작용 ID 매핑으로 복구. 별도 웹 호스트/DOM 권한 없음. 중간 난이도 | OS 트레이, 시스템 권한·집중모드·플랫폼 UI 차이. `create` 성공은 Chrome 생성 요청 성공이며 OS 배너 노출/사용자 열람을 입증하지 않는다. 목표 원문은 잠금화면에 노출될 수 있으므로 기본 OS 알림은 일반 문구, 목표와 두 선택은 확인된 extension 상세에서 제공. 버튼을 지원하는 플랫폼에서는 `onButtonClicked`, 본문 클릭은 `onClicked`. 합성 fake API/Chrome 통합, OS 실기기 별도. [Notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications) |
| B. Content Script 오버레이 | 열려 있는 허용 탭 위에 표시 가능. content script 권한/취소, SPA route·문서 교체, 제외 페이지·Chrome 내부 페이지·백그라운드 탭 문제. isolated world는 JS를 격리하나 DOM 공유. Shadow DOM/style 격리, CSP/DOM 삽입 검토와 메시지 발신자/문서/탭 검증 필요. 높음 | 삽입 성공 + 현재 문서/탭 visible 확인을 표시 관측으로 정의 가능. 실제 읽음은 불명. 페이지와 충돌, 민감 사이트에 작업 목표 노출. SPA/권한철회·제외 페이지 조합 E2E 필요. [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) |
| C. Popup 또는 별도 extension 화면 | 이미 쓰는 React와 messaging 재사용. 열린 화면만 현재 흐름으로 가능하며 닫히면 별도 트리거 필요. Popup 수명이 짧고 자동 개방에는 플랫폼/버전 제약 및 사용자 흐름 영향. 낮음~중간 | extension DOM에서 사용자에게 보일 때 렌더·선택을 확인하기 쉽다. 알림 상세에는 적합하며 관리 화면 독립 전달은 A가 담당한다. [Action](https://developer.chrome.com/docs/extensions/reference/api/action) |

합의할 측정 규칙은 Chrome API 성공을 `presented`(플랫폼 제출 성공)로 기록하고, `shownAt`은 채널별 확인 가능한 표시 계기로 생성하는 것이다. 초기 권장안은 활성 세션·후보가 유효할 때 사용자가 상세를 열어 visible 상태에서 목표가 커밋된 시점을 `shownAt`으로 사용한다. 알림 채널 정책을 바꿔 OS 제출 시각을 비교 지표로 쓸 경우 별도 필드/분모에 기록한다. 클릭으로 상세가 열리지 않았거나 시스템 알림이 억제되면 shown/선택을 추정하지 않는다. 클릭 전에 서버/세션/후보를 재검증하고, 종료·철회·새 상태의 만료 경계를 이전에 확인된 표시 영수증과 구분한다. [현재 BE의 표시 시각 제약](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertDisplayService.java#L125)

Worker는 최상위 알람·알림 리스너를 등록하고 시작 때 알람 존재와 세션을 확인한다. MV3 종료·브라우저 재실행·기기 절전 이후 같은 session/alert 식별자로 복구하고, alarm은 지연·합쳐짐이 가능한 wakeup으로 사용한다. 짧은 시연 타이머나 장시간 Worker 상주에 의존하지 않는다. Chrome 106 기준과 Chrome 120 이후의 최소 alarm 간격 차이를 고려해 지연 예산(1분 주기부터 실험)을 측정한 뒤 최소 Chrome/주기를 결정한다. 오프라인은 backoff, 401은 재인증, 403/철회·확정 충돌은 채널 중지와 상태 설명으로 연결한다. 늦은 응답/구버전은 sessionId·Window·stateVersion·credential 세대를 대조한다. [MV3 수명](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) · [Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)

## 문제와 원인

| ID·중요도·담당 | 재현·예상 → 실제·원인 | 영향·후속 |
| --- | --- | --- |
| F01 P0 · BE/FE/정책 | 인증 요청 기준 real/individual-local의 자유 목표 v1/v2 `POST /api/sessions`는 배정 요구. 예상 사용자 자유 목표로 v2 시작 → 실제 409. Storage Gate는 기본 프로필에도 없음. [생성 분기](../be/src/main/java/com/focusrecovery/domain/consent/OwnedSessionService.java#L20) | 제품 세션 시작 차단. 승인된 제품 경로·소유권·동의·session origin 및 동시 정책 정의. **R1 필요**. |
| F02 P0 · FE | 유효 DRIFT 후보 준비 후 합성 harness 닫기. 예상 관리 화면 없이 알림 제시 → 7초 동안 status 0·shown 0. 타이머가 UI에 있고 recovery alarm은 Visit/end만 kick. [타이머](../fe/participant/index.tsx#L49) · [복구](../fe/src/v2/browser.ts#L375) | 제품 핵심 알림 차단. Worker/채널 독립화. **R3 필요**. |
| F03 P1 · FE | 같은 client에서 A의 Window 9 수신 후 B의 Window 1 또는 다른 sessionId JSON으로 번호 오염. 예상 새 세션 유효 후보 → null. 카운터가 세션 기준으로 초기화되지 않고 응답 소유자 검사보다 먼저 업데이트된다. [상태 Client](../fe/src/v2/status.ts#L41) | 여러 세션에서 알림 손실 및 Worker 재시작 시 순서 기억 소실. 검증 후 세션별 fence 저장, 재시도/초기 상태 합의. **R3 필요**. |
| F04 P1 · FE/BE | 후보 수신 후 PENDING/NORMAL·종료·접근 해제/오류 또는 다중 UI. 예상 철회된 표시 제거·한 번 제시 → participant가 null/실패를 지우지 않고, 표시 뒤 재조회가 실패해도 렌더가 남을 수 있다. 다중 실제 화면은 미검증. [UI](../fe/participant/index.tsx#L49) · [재조회](../fe/src/v2/browser.ts#L203) | 오래된 목표 제시 또는 정확한 표시 집계 실패. 만료와 취소/claim·lease 필요 여부를 공동 검증. **R3/R4 필요**. |
| F05 P1 · FE/BE | shown/선택 HTTP 실패 후 END ACK → 같은 주체 새 세션. 예상 같은 payload 보존·재전송 → 이전 배열 소실 재현. flush는 예외를 삼키고 첫 실패가 뒤 영수증을 막는다. [Runtime](../fe/src/v2/runtime.ts#L171) · [flush](../fe/src/v2/runtime.ts#L373) | 선택 효과 평가가 왜곡되고 서버 확인 없이 성공으로 보일 수 있다. 독립 session별 outbox와 상태 노출, 종료 이후 합법적 replay·영구 오류 분리. **R4 필요**. |
| F06 P1 · FE/BE | FIXED 모드에서 10분 경계 지난 뒤 FE status만 호출. 예상 현재 회차 새 알림 → POST 호출이 없어 새 후보 없음. BE 모드는 전역이다. [고정 주기](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertService.java#L145) | 비교 실험 진행 불가. 주기 후보/배정·집계 계약 정의. **R5 필요**. |
| F07 P1 · FE/BE | 현재 BE를 깨끗한 v1 기본 설치에서 사용. 예상 입력→작업 시작 → v1 UI에 계정 발급/동의 UI가 없고 protected API는 자격정보를 요구. Chrome 회귀는 v1 Mock에 한정. [팝업](../fe/src/popup/index.tsx) · [인증 필터](../be/src/main/java/com/focusrecovery/domain/identity/AuthenticationFilter.java) | 기본 빌드의 사용자용 재사용 범위를 UX로 한정한다. **R1/R2에서 처리**. |
| F08 P1 · BE/AI | `individual-local`에서 원본 저장은 되지만 dispatch가 꺼져 있고, 실제 dispatch가 반복 실패해 terminal FAILED가 되면 별도 원인 복구가 필요하다. 예상 UI는 대기/장애 구분 → 현재 제품 UI 미구현. [프로필](../be/src/main/resources/application-individual-local.properties) · [#131](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/131) | 합성 시연부터 가능. 실제 AI 승인·복구/서비스 레이턴시 검증은 공동 의존성. **#131 재사용**, R3/R6에서 실패 표시를 확인. |
| F09 P2 · FE/BE | 진행 중 알림 이력 offset 두 페이지 사이에 새로운 후보가 삽입되는 경우. 예상 연속 이력 → 중복/변동 가능. 재현 테스트 미실행, 코드상 offset. [이력](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertHistoryService.java) | 초기 비교는 종료 세션의 이력으로 평가. 활성 이력 정밀 조회가 필요할 때 cursor를 별도 후속으로 검토. |

## 기존 Issue와 경계

2026-11-21 KST에 공식 저장소의 OPEN 전체와 OPEN PR을 조회했다. OPEN은 [#129](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/129), [#131](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/131), [#116](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/116), [#126](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/126)이다. OPEN PR [#117](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/117)과 [#127](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/127)은 각각 AI 결과 DB와 라벨링 작업이다. R1~R6은 이 작업을 다시 열지 않는다. [#128](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/128)/#130의 AI URL/HTTP 검증은 기준에 포함된다. [#89](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/89), [#95](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/95), [#39](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/39), [#41](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/41), [#44](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/44)의 서버 후보·소유권·표시·이력 구현을 활용한다. 후보는 아래 초안에 한정해 구체화했다.

## 후속 Issue 초안

R1의 계약 설계와 R2의 Mock 작업을 병행한다. R3/R4는 같은 합성 세션으로 기술 검증을 진행하되 실제 사용자 연결 전에 R1을 적용한다. R5는 R3/R4 표시·선택 경계가 고정된 뒤 진행한다. R6는 합성 필수 단계부터 반복한다.

### R1 · 사용자용 v2 세션과 접근 정책 계약

**GitHub 제목** `[Feat] 사용자용 v2 자유 목표 세션과 인증·동의 계약` · P0 · BE 주도, FE/정책 공동, dispatch·모델 경계는 AI 협의. FE 단독으로 합성 UI까지만 가능.

- TODO는 제품 세션 origin 및 승인 프로필, 자유 목표 생성/replay/활성 조회, 동일 사용자·다중 프로필 동시성, 새 인증 발급/재인증/동의/철회와 사이트 범위, 소유권/전송 오류 분기다. 기존 배정 start·Gate는 현재 정책을 유지한다.
- 예상 위치는 BE `OwnedSessionService`, `V2StorageGate`, `ConsentService`, `WorkSessionController` 및 계약 테스트, FE `runtime.ts`의 transport와 사용자 인증 UI다. 정책 결정이 선행한다.
- 완료 조건은 H2와 합성 Chrome에서 두 계정 격리, 같은 키 1세션, payload mismatch, 만료·철회 및 동시 시작 정책, 기존 두 수집 프로필의 `ASSIGNMENT_REQUIRED` 회귀를 확인하는 것이다. 운영 연결에는 별도 승인 증거가 필요하다.

### R2 · 사용자용 진입점과 작업 화면

**GitHub 제목** `[Feat] 사용자용 v2 Extension 진입점과 목표·세션 화면` · P0 · FE 단독 Mock 가능, 실제 API 연결은 R1, AI 협의 불필요.

- TODO는 독립 Manifest/entry와 storage identity, 접근·목표·시작/진행·복구 UI, v2 Runtime/전송기 공유, 최소 host 권한, diagnostic 숨김이다. 시작/종료 오류 UX에서 실제 서버/로컬 intent를 구분한다.
- 예상 위치는 신규 `fe/user/`, `vite.user.config.ts`, `package.json` 및 기존 shared goal/access·Runtime 어댑터다.
- 완료 조건은 별도 Chrome 프로필에서 시작/탐색/종료, start/end ACK 유실과 재연결, 권한 거절을 통과하고 기존 v1/participant/pilot/real 빌드와 저장이 독립적인 것이다.

### R3 · Worker 상태 조회와 DRIFT 알림 채널

**GitHub 제목** `[Feat] 관리 화면과 독립적인 v2 DRIFT 알림 및 최신성 처리` · P0 · FE 단독 Mock 가능, 실제 연결은 R1/R2, BE와 상태·만료/표시 정의 협의, AI와 fixture·상태 지연 합의.

- TODO는 Worker alarm+이벤트 wakeup, 관측된 상태와 유효 후보 구분, 최소 권한 Chrome notifications, 세션·버전별 검증과 표시 예약, 정상/종료/철회/만료 시 정리, 상세·두 선택 route다. Worker와 UI의 순서/중복 방어를 한 책임으로 묶는다.
- 예상 위치는 `fe/src/v2/status.ts`, 사용자 Worker·Manifest, 알림 채널과 `fe/tests/v2-status.test.ts`다. R4의 영수증 인터페이스와 먼저 맞춘다.
- 완료 조건은 관리 화면 닫힘·다른 탭에서 합성 DRIFT 하나, PENDING/FAILED/이전 세션·Window에서는 0, 코드·Chrome에서 Worker 종료·재시작/계정 전환 복구와 권한 거부를 확인하는 것이다. 플랫폼 제출과 실제 열람은 별도 측정한다.

### R4 · 영속 표시·선택과 복구

**GitHub 제목** `[Fix] 사용자 알림의 표시·선택 영수증을 세션별로 영속화하고 복구` · P1 · FE 주도, 종료 후 선택·멱등성·충돌 분류 BE 협의, AI 협의 불필요.

- TODO는 session/alertId와 최초 UTC timestamps의 outbox, 표시 확인·사용자 선택·서버 ACK 경계, 자동 retry/상한·backoff, 영구 거절·철회·다중 인스턴스·새 세션 이관, UI 대기/저장/거절 상태다.
- 예상 위치는 `notifications.ts`, `runtime.ts`, `repository.ts`, 사용자 worker/상세와 Mock HTTP 테스트, 필요 시 BE AlertDisplayService/DTO다. R2·R3와 연결하며 증거 보존 정책은 R1에서 확인한다.
- 완료 조건은 표시 직후 Worker stop, PATCH/POST 응답 유실, 완료 후 새 세션 시작, 클릭과 세션 종료 동시 발생, 접근 갱신/철회에서 영수증의 정확한 소유권과 최종 상태를 검증하는 것이다. ACK 재전송은 같은 ID/시간으로 BE 한 건을 유지해야 한다.

### R5 · 고정 주기와 비교 평가

**GitHub 제목** `[Feat] 고정 주기 알림과 AI 알림 비교 평가 연동` · P1 · 공동, FE 단독으로 FIXED Mock 동작 가능. BE 모드·세션 배정/일정, AI 기준 데이터, 평가 설계 협의. R1/R3/R4 후.

- TODO는 두 모드 배정과 모드별(또는 별도 합성 환경별) 재현 설정, 예정 회차 POST, 누락 회차/재시작/중복 대응, 공통 표시·선택·결측 집계, 온보딩·기기 권한에서 생기는 편향 확인이다.
- 예상 위치는 사용자 Worker/테스트, BE `AlertService`·설정 및 필요 시 세션 config/평가 계약 문서다.
- 완료 조건은 시간 제어 테스트에서 10분 경계, 현재 회차 한 건, 종료 후 무발급이 통과하고 두 모드의 후보·제시·shown·선택이 각각 조회 가능하며 중복 집계하지 않는 것이다.

### R6 · 통합 테스트와 최종 시연

**GitHub 제목** `[Test] 사용자용 Extension v2 합성 통합과 Chrome 시연 검증` · P1 · FE/BE 공동, AI Mock 제공 및 실제 모델·배포 단계를 위한 AI 참여. 합성 일부는 FE 단독.

- TODO는 사용자 entry→Spring/H2→Mock AI와 fixture 브라우저 통합, 조합별 권한/OS 시연, 수집 빌드 회귀, 실제 모델/승인 단계의 별도 결과 기록이다. 예상 위치는 `fe/scripts/`, `fe/tests/`, `be/src/test/` 및 시연 문서다. R1~R5, 장애 재처리는 기존 #131과 연계한다.
- 완료 조건은 깨끗한 설치에서 자유 목표→세션 ACK→3개 이상 승인된 합성 Visit→NORMAL/TRANSITION에는 무알림→DRIFT에서 UI 닫힘 상태로 알림→상세와 두 선택 각각 저장→종료 및 재접속 복구까지 이어지는 것이다. FIXED 비교 조건도 같은 harness로 확인한다.

## 통합 테스트와 시연 체크

- **자동화**는 인증 만료/갱신·정책 승인·타인 접근, 5초/4초/5분 및 Chrome 포커스, 3-Visit·상태 버전·이전 응답, 페이지 제외/철회, POST/PATCH/end/shown/response 각각의 장애를 다룬다. Worker stop/reload와 브라우저 재실행은 별개로 확인한다. [현재 합성 스크립트](../fe/scripts/v2-browser-test.mjs) · [BE 통합](../be/src/test/java/com/focusrecovery/domain/integration/V2IntegrationContract.java)
- **시연**은 합성 데이터와 별도 프로필에서 동일 실행 절차로 재현한다. 알림 권한 허용/거절, 다른 탭/비활성/최소화, OS 집중모드, 정상/이탈, 1회 표시, 선택 ACK·이력, 비교 모드·종료 복구를 증거로 남긴다. 플랫폼 제출만 확인된 경우 읽음이나 실제 OS 표시로 표시하지 않는다.
- **회귀**는 기본 v1 빌드/권한, participant 잠금, pilot, controlled, real 원본 저장·재수집·철회 장부를 각각 합성 확인한다. 운영 검증은 실제 승인, 합법적 데이터/기기 범위와 소유자 확인의 증거가 있을 때 독립 수행한다. [수집 브라우저 테스트](../fe/scripts/collection-browser-test.mjs) · [원본 회귀](../fe/scripts/raw-browser-test.mjs)
