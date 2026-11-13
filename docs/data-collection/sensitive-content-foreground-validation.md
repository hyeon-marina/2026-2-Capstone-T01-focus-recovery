# SENSITIVE_CONTENT 전경 경계 수정 검증

검증일: 2026-11-13(macOS). 작업 브랜치: `fix/sensitive-content-foreground`.
기준 소스: `e088f03780b76404e4bba17138670e40d47600d8`.
운영 정책: `focus-team-raw-v2/6`, RAW_ONLY, Plan revision 1.
정책 SHA-256: `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982`.

이 문서는 독립 합성 검증 결과이며 C 담당자의 연구 수집 실적이 아니다. 운영 환경 반영과 PLAN-003 재수집은 별도 승인 대상이다.

## 확인한 원인과 확정할 수 없는 부분

기존 코드는 세션 시작 시 허용되는 모든 탭에 `v2-capture`를 전송했다. `real/content.ts`는 전경 여부를 확인하기 전에 문서 제외·제목·본문 검사를 실행했고, 일부 민감 신호에는 `visible`이 없었다. `installV2Browser`는 전경 탭 및 가시성 확인보다 먼저 `runtime.quarantine('SENSITIVE_CONTENT')`를 실행했다. 따라서 수집 대상이 아닌 비활성 탭의 신호가 활성 세션 전체를 격리하는 구현 오류를 합성 테스트로 확인했다.

또한 권한 응답의 `collecting=false`로 관찰 타이머가 정지한 탭은 복귀해도 주기 관찰이 재개되지 않을 수 있었다. 늦게 도착한 이전 응답이 새 활성화 타이머를 취소하는 경합도 재현했다. DOM 이벤트 외에 Chrome의 탭·창 활성화 이벤트에서도 전경 탭의 관찰을 재개하도록 보완했다.

활성 검색창에 포커스만 주어도 문서 제외로 판정하는 것은 기존 보호 기준이다. `isExcludedMetadataDocument`와 [본문 수집 가이드](page-content-collection.md)의 활성 입력 제외 규칙을 유지했다. 입력 유무나 검색창 여부에 따른 예외를 추가하지 않았다. 포커스를 빼면 문서 자체는 다시 적격일 수 있지만, 이미 발생한 세션 격리가 자동 해제되는 것은 아니다.

민감 검사는 첫 Visit의 5초 요건보다 먼저 수행되므로 시작 직후 격리·Visit 0은 코드상 가능하다. 기존 PLAN-003의 101ms·69ms 격리는 이 경로와 양립하지만, 당시 트리거 탭·DOM 검사 단계가 기록되어 있지 않아 동일 원인으로 확정할 수 없다. `VISITS_BELOW_10`은 격리 원인이 아닌 사후 품질 진단이다.

## 수정 범위

- `fe/real/content.ts`: DOM 접근 전과 비동기 인증 응답 후 가시성·문서 포커스 확인, 민감 신호의 가시성 전달, 복귀 시 타이머 재개, 이전 응답의 새 타이머 취소 방지.
- `fe/src/v2/browser.ts`: 시작 캡처를 전경 탭으로 제한, 추출 컨텍스트의 전경 확인, 비동기 검증 뒤 전경·가시성·탐색 revision을 격리보다 먼저 확인, native 탭·창 복귀 시 전경 캡처 재개.
- `fe/tests/real-content-lifecycle.test.ts`, `fe/tests/real-browser-foreground.test.ts`: 실제 Content Script와 브라우저 어댑터의 회귀 테스트 23개.
- `fe/scripts/foreground-browser-test.mjs`: 합성 fixture만 허용하는 실제 MV3 확장 검증. 운영 Source·계정·프로필 사용 및 Export 호출 금지.

Backend 코드, 정책, 개인정보 판정·마스킹 기준, DB 스키마, API 계약, IndexedDB 버전·저장 형식·키는 변경하지 않았다. 기존 비활성 탭의 오래된 신호는 격리하지 않으며, 활성 문서의 민감 신호는 계속 격리한다.

## 전후 비교 및 자동 테스트

| 검증 | 수정 전 또는 추가 발견 시 | 최종 결과 |
|---|---:|---:|
| 최초 전경·수명주기 재현 20개 | 실패 13 / 통과 7 | 통과 |
| 늦은 응답의 새 타이머 취소 | 실패 1 | 통과 |
| native 탭·창 활성화 재개 | 실패 2 | 통과 |
| 관련 신규 테스트 전체 | 위 실패들을 포함 | 23개 통과 |
| FE 전체 | 최종 소스로 실행 | 955 통과 / 기존 skip 2 |
| BE 전체 기본 실행 | H2 및 기본 조건 | 888 통과 / 조건부 skip 167 / 실패 0 |
| 배정·동의 MySQL 통합 | 별도 합성 스키마 | 41 통과 / skip 0 |
| 저장·회수·인증 MySQL 통합 | 별도 합성 스키마 4개 | 198 통과 / skip 0 |
| TypeScript 및 실제 수집용 Extension 빌드 | 작업 트리의 `dist-real`만 생성 | 통과 |
| Backend `bootJar` | 작업 트리에서 생성 | 통과 |
| 공식 `checkLocalPolicy` | v6 및 지정 SHA 입력 | 통과 |

기존 전체 테스트에는 로그인·결제·개인 문서 URL 제외, 폼 값 제외, 이메일·국내 휴대전화 마스킹, 고위험 문자열 격리, 전송 중 격리 시 후속 요청 차단, IndexedDB transaction abort, worker 재시작, Queue 재시도, 과거 세션 보존, 격리 마감 및 Tombstone 차단 검증이 포함된다.

## 실제 브라우저 합성 검증

최종 실제 MV3 브라우저 검증 8개 항목이 모두 통과했다. `browser-result.json`과 `synthetic-db-aggregate.json`에 원문 없는 결과를 기록했다.

- 새 MySQL 8.4 컨테이너·Volume, loopback DB 33111, 테스트 Spring 18101, 새 합성 Participant/Credential, 새 Chrome for Testing 프로필만 사용.
- 기존 테스트 서버가 지원하는 SYNTHETIC exact-site 정책 사용. 운영 v6 PUBLIC_HTTP_HTTPS 정책은 변경하지 않음. 합성 HTML 요청은 Playwright에서 응답하고 외부 페이지 요청은 차단. TLS 경고 우회 옵션 없음.
- 시작 시 비활성 검색 입력 포커스 무시, 공개 페이지 실제 5초 이상 체류, 탭 복귀, 백그라운드 로딩 후 복귀, SPA 탐색.
- 10개 이상 합성 Visit, 정상 종료 ACK, pending 0, RAW_COLLECTED, AI NOT_RUN, 실제 참여자 완료 0.
- 실제 고위험 합성 문자열 및 입력하지 않은 활성 검색창의 격리 유지, 격리 후 추가 수집 중단, 안전 마감 ACK, 기존 IndexedDB archive와 Attempt 보존.
- DB에는 원문 URL/Query/Fragment와 미제출 입력값이 없고 합성 연락처는 마스킹되었는지 원문 없는 집계로 확인.

최종 성공 실행의 정상 세션은 유효 Visit 10개, RAW_COLLECTED, AI NOT_RUN, 일반 END ACK acked, pending 0이었다. 이어진 격리 두 세션도 ENDED 및 격리 마감 ACK acknowledged였다. 해당 프로필의 IndexedDB version 2에는 종료 상태 3개(격리 2개 포함)가 남았다. 실제 참여자 세션·완료는 0이다.

앞선 실패 재현 기록까지 보존한 합성 DB 전체는 Session/Attempt 7개, 모두 ENDED/SYNTHETIC, ACTIVE 0개였다. 저장 Visit 17개 전부 체류 5초 이상·HMAC 식별 URL이며, 그중 합성 연락처를 포함했던 15개는 이메일·전화 마스킹을 확인했다. 미마스킹 합성 연락처·미제출 입력값·저장 URL의 Query/Fragment는 각각 0개였다. Window/AI 결과는 각각 0개다. 격리 이력 2개, 회수 Job 1개, Tombstone 1개, 회수 대상 9개를 보존했다. Job 상태는 QUARANTINED이며, 외부 사본 삭제 완료/PURGED로 판단하지 않는다.

Headless Chrome의 DOM 가시성/포커스 플래그는 native 활성 탭 정보와 다를 수 있다. 따라서 실제 브라우저에서는 native 탭 판정을 확인했고, 숨김 DOM의 사전 추출 차단 및 비동기 전환 경합은 별도 Content Script 회귀 테스트로 검증했다. 일반 Chrome에서의 OS 창 전환·절전 복원을 검증한 것으로 확대 해석하지 않는다.

초기 실행에서 테스트 서버가 지원하지 않는 빈 sites 합성 정책이 Gate에 차단됐다. 테스트 fixture를 지원되는 exact-site 형식으로 교정했으며 운영 정책이나 검증기를 수정하지 않았다. 실제 브라우저의 탭 복귀 시간 초과는 통과로 간주하지 않았고, 추가 회귀 테스트와 native 재활성화 수정 후 다시 검증했다. 실패한 테스트의 기록과 프로필은 삭제하지 않았다.

검증 종료 후 이번 실행의 합성 Spring만 SIGTERM으로 종료했다. 합성 MySQL은 60초 유예의 정상 종료로 exit=0, OOMKilled=false, Error 없음이었으며 Volume·프로필·기록은 유지했다. 운영 프로세스는 종료하거나 재시작하지 않았다.

## Backend 처리와 기존 격리 기록

`PageVisitService.saveOrReplay`는 v2 접근·Tombstone·요청 형식·정책·본문 검증을 유지한다. FE의 `quarantineNow`는 격리 상태와 회수 대상 ID를 저장하고 전송을 차단한다. `PrivacyRetractionService.quarantineForOwner`는 저장된 Visit의 회수/Tombstone을 생성하며, Visit 0은 존재하지 않는 ID를 만들지 않고 세션을 격리·마감한다. 일반 END ACK와 격리 마감 ACK는 별개다. 격리 마감 시 일반 END 객체를 비우므로 화면의 일반 종료 ACK `-`를 일반 세션 전송 완료로 해석하면 안 된다.

운영 PLAN-003의 두 Attempt·격리·회수 상태는 기존 진단 결과를 참조하며 이번 작업에서 다시 쓰거나 재수집하지 않았다. 회수 접수·격리 마감 ACK는 외부 사본의 완전 삭제나 PURGED를 의미하지 않는다.

## 운영 보존과 적용 전 조건

실제 작업은 `/Users/hyeon/.codex/worktrees/dce7/2026-2-Capstone-T01-focus-recovery`의 별도 브랜치에서만 했다. 운영 저장소의 기존 미추적 매뉴얼 PDF는 유지했다. 운영 확장 빌드·LocalDir 설정·Owner 키·Credential·TLS·Backend 설정 7개 파일의 크기와 수정 시각이 전후 동일함을 확인했다. 비밀값은 출력하지 않았다.

운영 Backend 재시작, 일반 Chrome 조작·확장 새로고침, 운영 DB 접속/변경, IndexedDB·Queue 수정, 실제 동의·세션 시작·Export는 수행하지 않았다. 운영 DB/Chrome 저장소의 바이트 단위 동일성이나 현재 진행 상태를 재조회했다고 주장하지 않는다.

승인 후 운영 적용 시에는 매뉴얼 3~5장에 따라 최신 Session·Queue·ACK 상태와 암호화 백업을 다시 확인해야 한다. 같은 일반 Chrome 프로필·확장 ID·절대 로드 경로를 유지한 채 검증한 FE 변경만 반영할 수 있으며, 설치 삭제·DB 마이그레이션·신원 재생성은 필요하지 않다. 활성 입력 차단 기준은 그대로이므로 검색창 포커스 상태에서는 다시 격리될 수 있다. 이번 결과만으로 PLAN-003의 안전한 재수집을 보장하지 않는다.

운영 반영과 PLAN-003 실제 재수집은 실행하지 않고 사용자 검토를 기다린다. 일반 Chrome의 실제 공개 웹·운영 HTTPS·macOS 절전/복원·실제 개인정보 페이지 검증은 이번 독립 테스트 범위에 포함하지 않았다.
