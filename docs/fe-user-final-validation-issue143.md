# Issue #143 사용자용 Chrome Extension 최종 검증

## 기준

[Issue #143](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/143) · [선행 PR #142](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/142)

- 공식 `main` 기준은 PR #142의 병합 커밋 `e81686017516bac953298d5f8294c00d1e2db3ff`이다.
- 검증 및 캡처 대상 구현 커밋은 `b8ee29cf71a45223dd40ab839df48ce9cda3a36d`이다.
- macOS 27.2.1 arm64, Node.js 25.9.0, Playwright와 Chrome for Testing 151을 사용했다. Manifest의 최소 Chrome 버전은 106이다.
- 별도의 합성 프로필과 루프백 API를 사용했다. 실제 운영 자격정보, 운영 DB, A/B/C 슬롯, 비합성 탐색 데이터를 사용하지 않았다. 테스트의 알림 클릭은 Chrome에 등록된 콜백을 호출했다.

## 고정 주기 알림 상태

기준 빌드로 10분 이전의 활성 세션을 Chrome에서 열었을 때 ‘고정 주기 알림’ 배지만 있었고 ‘예정 회차 대기’ 검증이 실패했다. 기존 Worker는 별도의 알림 방식과 실제 상태를 전달하지 않았다. 특히 후보 GET 재검증 실패는 이전 확인 정보를 무효화했지만 그 결과를 팝업에 보고하지 않았다.

| 근거 | 새 팝업 표시 | Chrome 검증 |
| --- | --- | --- |
| 첫 10분 전의 로컬 일정 | 예정 회차 대기 | 첫 회차 1ms 전까지 후보 POST 0건 |
| 후보 POST 또는 GET 진행 중 | 알림 확인 중 | 서버 응답을 보류해 두 종류의 진행 상태 확인 |
| 유효한 현재 후보 확인 | 현재 회차 후보 확인 완료 | POST 응답 유실과 GET 실패 이후 같은 후보 복구 |
| 소켓 응답 유실, HTTP 503, 타임아웃 | 알림 확인 지연 | 기존의 확인 완료 배지가 사라지고 지연으로 전환 |
| 응답 구조 확인 불가, 새 회차의 근거 부족 | 알림 상태 확인 필요 | 잘못된 GET 응답 및 이전 회차 응답 지연 |
| 후보 불일치 또는 서버 모드 비활성화 | 알림 사용 불가 | 후보 누락 및 `FIXED_INTERVAL_DISABLED` 검증 |
| 서버에서 회차 미도달을 응답 | 예정 회차 대기 및 건너뛰기 안내 | 같은 회차 재요청 차단, 다음 회차 재확인 |
| Chrome 알림 권한 거부 | Chrome 알림 권한 꺼짐 | 수집을 유지하면서 알림 권한 복구 후 재검증 |
| 소유자가 재연결해야 하는 세션 | 알림 일시 중지 | 연결 중단 및 재연결 후 상태 복구 |
| 소유권·사이트 접근·동의 조건 위반 또는 종료 | 알림 상태 숨김, 기존 접근 안내 | 로그아웃, 계정 전환, 권한 차단, 철회 및 종료 |

팝업은 기존 `StatusBadge`와 `Notice`를 사용한다. Worker는 공개 가능한 활성 고정 주기 세션에 선택적 `fixedAlertStatus`를 제공한다. 상태를 보내지 않는 기존 Snapshot은 확인 필요로 표시한다. 재연결 상태는 기존 접근 정보로 표시한다.

진행 및 실패 상태는 기존 `scope()`에 포함된 세션, 접근 세대, 자격정보 세대와 현재 회차에 묶인다. 후보 확인에는 `fixedCheck`를 사용한다. 만료된 확인 정보나 오래된 비동기 응답은 현재 상태에 적용하지 않는다. Worker 재시작 이후 현재 후보의 검증 전에는 확인 완료를 추정하지 않는다. 권한 확인은 기존 Worker 폴링 및 Chrome 권한 이벤트를 활용한다. 팝업 상태 조회 시마다 서버에 요청하거나 IndexedDB 구조를 바꾸지 않는다.

후보 확인, Chrome 제출, 상세 표시, 선택, 서버 ACK는 각각의 단계이다. 기존 10분 스케줄, 건너뛴 회차의 처리, Chrome 제출 중복 방지와 재검증, AI 판단과 Outbox 재시도는 유지한다.

## 사용자 기능 및 회귀

| 항목 | 결과 | 확인 범위 |
| --- | --- | --- |
| FE 타입 검사 | PASS | `npm run typecheck` |
| 기본 FE 자동 테스트 | PASS | 1,262건 통과. PR #142 기준 1,251건에 11건 추가 |
| 사용자용 Chrome | PASS | 기존 18개. 탐색 방문과 행동 전송, 인증·동의, 시작·종료 ACK 유실, 작업 재연결, AI 상태와 사용자 선택 |
| 고정 주기 상태 UI | PASS | 대기, POST/GET 진행, 네트워크와 타임아웃, 잘못된 응답 및 후보 불일치, 회차 변경, 권한·접근 복구 |
| 고정 주기 유효성 | PASS | 19개. 알림 권한 복구, 인증·동의·종료·회차 및 후보 유효성, 이전 요청의 최신성 경계 |
| Worker 제출 복구 | PASS | 기존 사용자 Chrome 18개에 포함된 7개를 별도 모드로 재실행 |
| Outbox 및 이전 IndexedDB | PASS | Worker 및 Chrome 재시작, 이전 세션 ACK, 재시도 소진과 수동 복구, 사용자·세션 격리, 충돌, PR #136의 실제 IndexedDB 이관 |
| AI 및 고정 주기 비교 | PASS | 두 모드의 정상 시나리오와 장애 주입 시나리오, 중복 집계 방지, 사유가 있는 제외 사례 |
| 실제 툴바·레이아웃·키보드 | PASS | macOS 툴바 팝업 403×600px, 본문 388px, 스크롤, 닫기·복원, 320px와 200% 확대, 목표 길이와 키보드 동의·철회 |
| 가이드 실행 절차 | PASS | 두 모드의 실제 빌드와 `mock:user` 명령. AI에서 합성 문서 a~d 순회 및 알림 제출, 고정 주기에서 첫 회차 대기, 두 모드의 종료 |
| 사용자용 및 기존 빌드 | PASS | AI, FIXED_INTERVAL, 기본, dev, synthetic, participant, pilot, real. 참가 및 real 빌드는 예약 도메인과 테스트 정책으로 빌드만 확인 |
| Worker 메시지 실패 화면 | NOT_VERIFIED | Worker와 Chrome의 재시작·복구는 검증했다. 브라우저의 메시지 채널 실패 화면은 별도로 캡처하지 못했다 |
| 실제 백엔드 통합용 테스트 | NOT_VERIFIED | 기존 환경 변수 의존 HTTP 통합 2개는 실행 대상에서 제외했다. 공통 HTTP 계약 변경 없음 |
| 실제 운영 환경과 타 플랫폼 | OUT_OF_SCOPE | 실제 수집기·RAW_ONLY 재검증, 실제 FE·BE·AI 연동, Windows/OS 배너와 물리 클릭 |

정상 비교에서 두 모드는 각각 후보 2건, Chrome 제출 2건, 상세 표시 2건, 선택 ACK 2건이다. 장애 주입 비교에서는 모드별 후보 3건, Chrome 제출 확인 2건과 제출 불확실 1건, 실제 상세 표시 2건, 선택 ACK 2건이다. 복구 후 미확인 영수증은 0건이었다. 두 선택의 비율은 각각 50%였으며 집계 입력 중복에도 결과가 같았다. 모드 불일치와 개인정보 철회 시나리오는 제외 사유가 기록되었다.

FE-001~FE-003은 최초 목표, 시작, 종료이다. FE-004~FE-007은 허용된 합성 페이지의 방문, 활성 체류, 탭 전환, 검색어 처리이다. FE-008~FE-010은 AI 목표 확인 알림, 동일 최초 목표의 표시 및 선택 기록, 고정 주기 목표 확인이다. 탐색 수집과 알림 검증은 사용자용 합성 앱 범위이다.

## 재현 방법

`fe`에서 실행한다. Playwright가 관리하는 Chrome을 설치하거나 Chrome for Testing 실행 파일을 `CHROMIUM_PATH`로 지정한다. 두 모의 서버가 같은 루프백 포트를 사용하므로 브라우저 검증은 순서대로 실행한다.

```sh
npm ci
npm run typecheck
npm test
USER_ALERT_MODE=AI npm run build:user
fixed_build=$(mktemp -d)
USER_ALERT_MODE=FIXED_INTERVAL npx vite build --mode user-mock --config vite.user.config.ts --outDir "$fixed_build"
npx vite build --config vite.synthetic.content.config.ts --outDir "$fixed_build"
export USER_FIXED_EXTENSION="$fixed_build"
export USER_TEST_EVIDENCE="$(mktemp -d)"
npm run test:user:browser
npm run test:user:browser -- --fixed-ui
npm run test:user:browser -- --fixed-validity
npm run test:user:browser -- --evaluation
npm run test:user:browser -- --outbox-only
npm run test:user:browser -- --recovery-only
HEADED=1 npm run test:user:browser -- --ui
```

팀원이 직접 실행할 때는 `USER_ALERT_MODE=AI npm run build:user`와 `USER_ALERT_MODE=AI npm run mock:user`를 사용한다. 고정 주기 모드는 두 명령에서 모두 `FIXED_INTERVAL`을 지정한다. 개발자 모드의 별도 Chrome 프로필에서 `fe/dist-user`를 압축해제된 확장 프로그램으로 로드한다. 인증은 별도로 전달받은 합성 자격정보를 사용한다. 자동 테스트의 고정 주기 경계는 가상 시각으로 재현했다.

## 팀 공유 가이드

**Focus Recovery — 사용자용 Chrome Extension 구현 결과 및 이용 가이드**를 20쪽 A4 PDF로 제작했다. Poppler로 전 페이지를 렌더링하고 한글, 캡처, 페이지 순서와 목차 링크를 확인했다. 실제 Chrome 화면 56개를 확보해 툴바 팝업과 상세 탭을 포함한 30개를 PDF에 사용했다. macOS PDFKit에서 20쪽을 열어 확인했다. PDF와 제작 자료는 로컬 파일로 별도 제공한다.

- SHA-256 `22a44daa165f02ad2d1f16bfa1e0868ebed2f7cba41141d09d9b4281ebabbfa3`

## 후속 통합

실제 사용자 인증·동의·자유 목표 세션 API와 승인 사이트 정책을 확정해야 한다. 실험군 배정, 서버 기준 예정 회차 식별, 실제 AI 모델 연동, R6 FE·BE·AI 전체 검증, Windows 및 네이티브 OS 알림 검증과 사용자 평가가 남아 있다.
