# 사용자 알림 영수증 Outbox

[Issue #137](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/137) · [기준 PR #136 병합 커밋](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/commit/3efbce312e85fa3c138495a7e71fb6c0008111a3)

## 저장과 이전 버전 호환

이전 Worker는 현재 세션의 `notifications` 배열을 읽었다. 종료된 세션의 배열은 `session/{sessionId}`에 남았지만 다음 세션에서는 전송 대상에서 빠졌다. 한 요청의 오류는 반복 전체를 종료했고, 당시 체크포인트에는 횟수와 다음 재시도 시각이 없었다. 팝업은 활성 레코드만 읽어 과거 미확인 기록을 집계할 수 없었다.

사용자 합성 DB `focus-recovery-user-v2-mock`의 기존 `v2` Object Store에 별도 키 영역을 사용한다. 키는 URL 인코딩한 API origin, 소유자 ID, 동의 ID, 세션 ID, 알림 ID를 포함한다. 전용 Object Store는 별도의 사용자 스키마 관리와 업그레이드 연결 처리가 필요하다. 기존 Store 내 범위 조회로 원하는 계정과 세션을 찾을 수 있고, 현재 세션과 개인정보 차단 표식을 같은 IndexedDB 트랜잭션에 커밋할 수 있어 공통 DB 버전 2를 유지했다. 방문 압축 영수증 `v2-receipts`와 기존 빌드는 기존 경로를 사용한다. [저장소](../fe/src/v2/notification-store.ts) · [Repository](../fe/src/v2/repository.ts)

Worker 초기화 중 엄격한 내구성의 단일 트랜잭션에서 `current`와 `session/` 범위를 읽고 복사한다. 원래 표시·선택 시각과 action, 확인된 ACK를 유지하며 이미 있는 Outbox 키는 다시 쓰지 않는다. 세션·소유자·동의·API 환경을 검증할 수 없는 기록은 접근 대상에서 제외한다. 철회와 격리 표식, 이관된 영수증, 완료 표식은 한 번에 반영된다. 중단이나 저장 실패 시 전체 이관을 재시도할 수 있다. 이전 세션과 기존 배열은 기록 보존용이다. 사용자용 조회와 송신의 원본은 Outbox이고, R3 상세 화면에는 현재 세션의 영수증만 파생한다.

표시와 선택은 기존 R3 검증을 통과한 Worker 명령에서 접수한다. 세션 전환·종료와 같은 직렬 실행기를 쓰며, 쓰기 트랜잭션 안에서도 접근과 종료 의도를 확인한다. 첫 표시와 첫 선택은 불변이다. 팝업과 상세 화면에는 커밋 후의 상태를 전달한다. 배치에서 지연된 ACK는 요청의 원래 Outbox 키와 전송 상태를 확인해 적용한다. [런타임](../fe/src/v2/runtime.ts) · [상세 메시지](../fe/user/analysis.ts)

## 전송과 정합성

| 상태 | 전환 |
| --- | --- |
| `pending` | 로컬 커밋 완료. 표시 PATCH와 선택 POST의 대기 상태를 각각 기록한다. |
| `sending` | 횟수와 중단 복구 시각을 HTTP 전에 커밋한다. 중단된 마지막 시도는 이력으로 확인한다. |
| `retry-wait` | 네트워크, 타임아웃, 408, 429, 5xx, 불확실한 ACK를 제한적으로 다시 확인한다. |
| `acknowledged` | 실제 DTO 또는 일치하는 서버 이력을 검증했다. 이미 확인된 ACK를 내리지 않는다. |
| `exhausted` | 자동 시도 3회가 끝났다. 팝업의 수동 복구는 이력을 확인하고 필요한 경우 같은 원본으로 새 시도 주기를 시작한다. |
| `rejected` | 영구 4xx, 처리할 수 없는 후보, 확인된 서버 충돌. 기기에 첫 선택과 시각을 보존한다. |
| `access-blocked` | 인증·동의·정책 실패. 확인된 401과 동의 정책 차단은 같은 소유권 범위의 자동 복구를 멈춘다. |
| `privacy-blocked` | 서버가 원래 세션의 개인정보 격리를 알려 해당 세션을 차단했다. 로컬 철회 또는 격리 표식도 전송을 차단한다. |

기존 3회 제한을 사용하며 첫 두 일시 오류에 1분, 2분의 Backoff를 저장한다. 세 번째 요청 중 Worker가 종료된 경우 마지막 전송의 불확실성을 보존한 뒤 다음 확인 시각에 읽기 전용 이력을 확인한다. 유효한 429 `Retry-After`는 Backoff에 반영한다. 기존 `user-analysis` 알람은 분석 결과와 독립적으로 Outbox를 깨운다. Worker 초기화, 저장, 권한 복구, 재인증, 새 세션, 종료 요청, 수동 복구도 전송을 깨운다. 단일 전송 루프가 동시 이벤트를 합치고, 한 영수증의 오류가 다음 영수증을 중단시키지 않도록 처리한다. 10초 제한의 읽기와 쓰기를 사용한다. [전송기](../fe/src/v2/notification-delivery.ts)

표시 ACK는 세션 ID, 알림 ID, 표시 시각을 확인한다. 선택 ACK는 알림 ID, action, 선택 시각, UUID feedbackId를 확인한다. 실제 선택 DTO는 세션 ID와 표시 시각을 생략한다. 선택 POST는 원래 세션 경로와 최초 `shownAt`을 사용하므로 저장 또는 멱등 재처리가 성공하면 BE 트랜잭션 계약에 따라 표시까지 확인할 수 있다. 표시 전송에 실패한 경우에도 원본 선택을 저장할 수 있다. [전송과 이력 검증](../fe/src/v2/notifications.ts) · [BE AlertDisplayService](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertDisplayService.java)

충돌, 잘못된 ACK, 재시도 소진, 수동 확인에서는 기존 알림 이력 GET을 최대 3페이지씩 20건으로 조회한다. 대상 알림의 긍정적인 일치 증거가 있어야 ACK를 저장한다. 일치하는 ID가 같은 페이지에 중복되면 해당 응답을 거절하고, 대상 일치 시 조회를 종료한다. Offset 페이지 사이에 알림이 추가될 수 있으므로 결과가 없으면 미확인 상태를 유지한다. 서버와 충돌하면 로컬 원본을 보존한다. [BE AlertHistoryService](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertHistoryService.java)

## 접근과 사용자 화면

전송 전에 현재 인증 사용자, 만료, 동의, 수집 권한, 대상 원래 세션의 소유권, API 환경과 개인정보 상태를 확인한다. 이전 세션 전송의 접근 검증은 현재 세션이 활성인지, 누가 소유하는지와 독립적으로 이뤄진다. BE도 같은 요청 경로에서 원래 세션의 소유자와 현재 유효 동의를 대조한다. 로그아웃·계정 전환·철회의 시작부터 일반 요청을 차단한다. Credential 세대와 접근 Epoch를 보내기 직전과 응답 커밋 시 확인한다. 인증 자격정보, 목표, 서버 오류 본문은 Outbox에 저장하지 않는다. 팝업은 허용된 범위의 미확인·이전 작업·서버 완료·재시도·거절 건수만 읽는다. [Worker](../fe/user/background.ts) · [ConsentService](../be/src/main/java/com/focusrecovery/domain/consent/ConsentService.java)

## 검증 환경과 재현 결과

macOS 27.2.1, Node.js 25.9.0, Playwright의 Chrome for Testing 151.0.7922.34를 사용했다. 새 임시 브라우저 프로필, 루프백 Mock 서버, 별도 Spring/H2·Mock FastAPI 및 RAW용 임시 MySQL을 사용한다. 브라우저 자동화는 실제 Chrome Notifications API와 알람을 관찰하고, OS 배너의 클릭은 테스트용 Worker에서 등록된 Chrome 클릭 리스너를 호출해 재현한다.

| 변경 전 증상 | 합성 재현 | 변경 후 |
| --- | --- | --- |
| 이전 세션 전송 중단 | 이전 빌드에서 선택 ACK를 유실하고 다음 세션을 시작했다. 알람은 현재 세션 요청을 보내지만 이전 세션에는 다시 요청하지 않았다. | 세션 B가 진행되는 동안 세션 A의 같은 원본을 다시 보내고 기존 feedbackId를 저장한다. |
| 특정 오류가 나머지 요청을 중단 | 이전 빌드에서 첫 표시 요청의 ACK를 계속 유실시키자 두 번째의 로컬 영수증이 전송되지 않았다. | 같은 배치의 앞선 503에도 다른 세션의 표시 ACK를 완료한다. |
| 다시 보낼 시각과 횟수를 잃음 | 이전 빌드의 미확인 영수증에는 표시 시각과 ACK 여부만 남았다. | Worker·Chrome 이후에도 시각과 횟수를 유지하고, 3회 소진 이후 수동 확인을 제공한다. |
| 이전 기록이 팝업에 빠짐 | 이전 빌드는 현재 세션의 배열 외에 과거 미확인 기록을 집계하지 않았다. | 동일 소유자·동의 범위에서만 이전 작업의 미확인 건수를 표시한다. |

PR #136 기준 기본 FE 검증은 1,157건 통과와 별도 HTTP 2건이었다. 변경 전 이 작업에서 기본 FE 1,157건을 다시 통과했다. 변경 전 Chrome 전체 실행은 인증 만료 주입 후 단일 알람과 진행 중 조회가 겹쳐 만료를 관측하지 못했다. 회귀 스크립트는 인증 만료가 관측될 때까지 알람을 다시 전달한다. 최초 병렬 회귀에서는 합성 서버 포트 8911이 충돌해 Chrome 검증을 순차 실행했다. 설치 경로에서 구형 Worker 등록이 남는 업그레이드 테스트는 기존 Worker 캐시를 제외하고 IndexedDB만 새 합성 프로필에 옮기도록 수정했다.

| 명령 또는 검증 | 결과 |
| --- | --- |
| `npm run typecheck`, `npm test` | 53개 파일, 1,170건 통과. Outbox 단위 테스트 13건을 추가했다. 기본 실행에서 제외된 2건은 별도 HTTP로 통과했다. |
| `npm run build:user` 및 v1·dev·synthetic·participant·pilot·real 빌드 | 통과. participant와 real은 합성 HTTPS origin, pilot은 루프백, real은 사이트가 비어 있는 DRAFT 정책으로 빌드했다. |
| `npm run test:user:browser` | R2/R3 및 세션 전환 후 원본 선택 ACK 복구를 포함해 18개 통과. `--recovery-only` 7개는 18개 안에 포함된다. |
| `npm run test:user:browser -- --outbox-only` | 표시 쓰기 중 Worker 중단, Chrome 재시작 및 재인증, 계정 격리, Backoff와 소진, 수동 확인, 잘못된 ACK 이력 대조, 충돌과 철회 통과. |
| `./gradlew test --tests '*AlertDisplayTest' --tests '*AlertHistoryApiTest'` | 표시·선택 19건, 알림 이력 14건 통과. |
| opt-in `AuthConsentLiveHttpTest` 및 `RetractionLiveHttpTest` | 격리된 Spring/H2와 합성 FastAPI에서 실제 인증·동의와 철회 HTTP 각 1건 통과. |
| `HEADED=1 npm run test:browser`, participant 및 real 잠금 | 기존 Chrome 탐색·창 전환·최소화·복원, 잠금 빌드의 수집 차단 통과. |
| Spring `CollectionLiveHttpTest`, `CollectionRealHtmlHttpTest` | Chrome pilot·real 제어 HTML에서 각각 Visit 10건·Window 8건, Worker 및 Chrome 재시작 통과. |
| `npm run test:v2:browser`, `npm run test:raw:browser` | 기존 합성 v2 수집, 알림, 철회 및 복구 통과. 별도 임시 MySQL의 RAW는 Visit 10건·Window 0건, 네트워크·Worker·Chrome 복구 통과. |
| `USER_LEGACY_EXTENSION=… npm run test:user:browser` | 실제 이전 빌드의 현재·보관 세션 영수증 4개를 이관했다. 서버 확인된 선택은 재전송 0건이며, 이전 세션의 최초 피드백 ID와 보관 배열을 확인했다. |

## 합성 환경 재현

`fe`에서 `npm ci` 후 다음 명령을 실행한다. 사용자용 Chrome 빌드는 루프백 합성 서버만 사용한다.

```sh
npm run build:user
node --experimental-strip-types scripts/user-mock.mjs
```

새 임시 Chrome 프로필의 확장 프로그램 페이지에서 개발자 모드를 켜고 `fe/dist-user`를 압축해제된 확장으로 로드한다. 합성 테스트 자격정보와 동의로 시작하고, 최초 목표를 넣은 뒤 팝업의 합성 페이지 링크에서 a, b, c, d를 탐색한다. DRIFT 알림을 열어 목표를 본 뒤 선택하면 상세 화면과 팝업에 로컬 접수 및 ACK 상태가 나타난다.

장애 주입은 기존 Mock API를 사용하는 다음 자동화에서 재현한다. Chrome 경로를 지정할 때는 `CHROMIUM_PATH`에 로컬 Chrome for Testing 실행 파일을 사용한다. 각 명령은 임시 프로필과 루프백 서버를 만들고 종료할 때 정리한다. 수동 서버가 켜져 있으면 자동화 전에 종료한다.

```sh
npm run test:user:browser
npm run test:user:browser -- --outbox-only
npm run test:user:browser -- --recovery-only
```

이전 버전 검증은 `3efbce312e85fa3c138495a7e71fb6c0008111a3`의 새 복사본에서 `npm ci`와 `npm run build:user`를 실행한 뒤 다음 명령을 사용한다. 테스트는 이전 코드로 합성 세션을 생성한다. 실제 이전 IndexedDB 파일을 새 임시 프로필로 복사하고 같은 확장 ID에서 새 Worker를 등록한다.

```sh
USER_LEGACY_EXTENSION=/absolute/path/to/legacy/fe/dist-user npm run test:user:browser
```

## 후속 통합

R5는 후보가 유효한 세션에서 실제로 표시되고 선택된 뒤 같은 `recordShown()`, `selectAlert()`와 전송 경계를 사용할 수 있다. AI와 고정 주기 후보 생성은 각자 담당하며, 평가에서는 후보 생성·Chrome 제출·상세 표시·선택·서버 확인을 별개 사건으로 센다. 미확인 영수증과 사용자 무응답의 구분, 알림 유형별 서버 집계, 충돌·격리 기록의 평가 제외 기준은 R5 계약에서 합의한다. R1 실제 사용자 인증·동의, 서버의 동의 갱신 및 과거 접근 정책, R6 운영 BE·AI와 OS 배너 클릭 및 집중 모드 확인도 별도 통합 범위다.
