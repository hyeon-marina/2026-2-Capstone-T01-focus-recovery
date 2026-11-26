# Issue #141 사용자용 Chrome Extension UI·UX

## 기준과 설계 시안

공식 main `a727abfd0cd7e3f44780de1104b598e5f097009b`를 기준으로 작업했다. 이슈 #141의 17개 항목, #139 종료, PR #140 병합을 확인했다. 인증부터 시작·분석·알림·선택·서버 확인·종료까지 기존 순서를 따른다.

기존 Popup은 폴링과 명령 직렬화, 폼, 상태, 설정을 한 컴포넌트에 두었다. 진행 화면에서 목표와 상태가 비슷한 비중으로 보였고, 고정 주기의 검증된 모드 및 종료 ACK 시각을 읽을 수 없었다. 알림 상세도 Popup과 동일한 380px 폭을 사용했다. 기존 선택 버튼은 서로 다른 강조를 사용했다.

따뜻한 종이색과 짙은 녹색 위에 최초 목표를 한 번 강조하는 구성을 선택했다. 복귀 화살표와 중심점은 목표를 다시 확인하는 동작을 나타낸다. 합성 환경 표시, 낮은 강도의 주의 색, 존댓말을 두 진입점에 공통 적용한다.

| 화면 | 구현 전 배치 시안 |
| --- | --- |
| 인증 | 브랜드와 합성 환경 → 서비스 목적 → 비밀번호 입력 → 인증 |
| 동의 | 적용 범위 → 수집·전송 항목 → 명시적 체크 → 저장 |
| 목표 입력 | 목표 안내 → 줄바꿈 입력 → 정규화된 글자 수 → 시작 |
| 진행 | 최초 목표 → 경과시간·시작 시각 → 수집·알림 → 종료 |
| AI 알림 | 넓은 상세 탭 → AI 판단 안내 → 목표 → 같은 강조의 두 선택 |
| 고정 주기 알림 | 넓은 상세 탭 → 예정 점검 안내 → 목표 → 같은 위치의 두 선택 |
| 선택 결과 | 목표 → 선택값 → 로컬 저장 및 서버 확인 상태 |
| 종료 | 요청 및 종료 확인 → 확인된 시작·종료와 경과 → 새 작업 |
| 오류·기록 복구 | 원인 → 현재 보존·차단 상태 → 상태에 맞는 복구 |
| 설정 | 서버 검증 시각 → 접근 확인 → 로그아웃과 철회 확인 |

## 디자인 시스템과 사용 기준

| 토큰 | 값과 용도 |
| --- | --- |
| 브랜드 | 기본 `#174d40`, 호버 `#103c32`, 누름 `#092d25`. 명시적 저장·시작 동작과 목표 영역에 사용 |
| 배경과 표면 | `#f3f2e9` / `#fffef9` / `#eeefe6` |
| 본문 | 기본 `#182a24`, 보조 `#42554b`, 도움말 `#526358` |
| 경계와 초점 | 구분선 `#cfdbd1`, 입력·버튼 경계 `#708278`, 2px 초점 표시 `#8f421b` |
| 의미 색 | 정상·완료 `#215947`, 주의 `#74491e`, 오류·철회 `#812f39`, 정보 `#32566a`, 비활성 `#58665e`. 연한 배경과 명시적인 문구를 함께 사용 |
| 글꼴 | Apple SD Gothic Neo, Malgun Gothic, Noto Sans CJK KR, 시스템 글꼴. 제목 26px, 본문·버튼 15px, 보조 문구 13px, 시간 23px 및 고정 숫자 폭 |
| 간격과 형태 | 4·8·12·16·20·24·32·48px. 모서리 6·8·12·16px. 그림자는 상세 페이지와 확인 대화상자에만 사용 |

`Header`와 `Footer`는 브랜드, 합성 환경, 서버 확인 상태를 제공한다. `Button`은 기본·보조·위험 동작 및 호버·누름·비활성·요청 중 상태를 공유한다. `GoalCard`는 줄바꿈을 보존한다. `StatusBadge`와 `Notice`는 텍스트로 상태를 전달하고, 변하는 경과시간은 라이브 영역 밖에 둔다. 폼은 네이티브 Label, Checkbox, Textarea를 사용한다. 철회는 네이티브 Dialog의 모달 초점·취소·Esc를 사용하며 최종 확인에서 기존 명령을 호출한다.

Light Mode를 적용했다. Dark Mode는 시스템 글꼴 및 의미별 색을 토큰으로 정의해 후속 테마에서 재정의할 수 있다. 색마다 대비를 재검증하고 아이콘과 양쪽 진입점을 확인한 뒤 지원 범위를 확장한다. 화면 진입과 알림 표시에 애니메이션이나 지연을 추가하지 않았다.

접근성 대비 계산에서 대표 텍스트·배경 조합은 최저 5.17:1, 입력·버튼 경계는 4.04:1, 초점 링은 6.31:1 이상이었다. 실기기 보조기술 검증 범위는 아래 시험 기록을 따른다. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## 화면과 데이터 경계

| 화면 | 표시 및 복구 기준 |
| --- | --- |
| 인증·동의 | 자격정보는 비밀번호 재입력 폼에서만 취급한다. 잘못된 인증과 소유 계정 불일치를 안내한다. 동의는 미선택으로 시작하며 계정 접근 상태가 바뀌면 폐기한다. |
| 목표 | 기존 `normalizeGoal()`과 `validGoal()`로 정규화한 UTF-16 길이를 센다. 시작 요청이 이미 있으면 같은 요청을 확인한다. |
| 진행 | 최초 목표, 서버가 확인한 시작 시각, 세션 경과, 합성 수집, AI 판단·대기 상태 또는 고정 주기를 표시한다. 경과시간은 기존 폴링 렌더에서만 계산한다. |
| 알림 | AI는 목표 이탈 판단, 고정 주기는 예정된 점검으로 안내한다. 선택 순서, 강조, 크기 및 키보드 조건은 두 모드에서 같다. |
| 선택 결과 | 처리 중, 기기 저장, 자동 재시도 대기, 서버 확인, 거절·충돌을 구분한다. Worker가 상세 유효성을 확인할 수 없으면 목표와 선택을 숨긴다. 상세 응답 계약에서는 만료·인증·정책 차단 사유의 세부값을 제공하지 않아 공통 문구를 표시한다. |
| 종료 | 전송과 종료 확인 대기를 보여 준다. Worker가 검증된 종료 ACK를 기록한 경우에만 종료 시각과 세션 경과를 계산한다. 과거 종료 상태에 시각 근거가 없으면 시작과 종료 상태만 표시한다. |
| 기록 복구 | 이전 작업의 미확인 건수, 기기에 있는 기록과 서버 ACK를 알려 준다. 자동 전송을 소진한 건에는 기존 수동 시도 버튼을 표시한다. 새 목표는 독립적으로 준비할 수 있다. |
| 설정·예외 | 마지막 서버 검증 시각과 사이트 권한을 확인할 수 있다. 네트워크·응답·저장소·계정·동의 상태에 맞는 안내를 사용한다. 일반 명령 중에도 로그아웃과 철회를 열 수 있다. |

Popup의 Worker 통신은 `use-user-session.ts`로 옮겼다. 500ms 조회, 동시 조회 차단, 세대 식별자 및 개인정보 명령 우선순위를 유지한다. `popup.tsx`가 화면을 선택하고 `onboarding.tsx`, `session-panels.tsx`, `settings.tsx`가 표현과 폼을 담당한다. `ui.tsx`, `tokens.css`, `style.css`를 알림 상세와 공유한다. 툴바의 388px 폭과 탭의 가변 Popup 폭을 구분하고 알림 상세 탭은 최대 672px로 구성했다.

읽기 전용 Snapshot에 `alertMode`와 `endedAt`을 추가했다. 검증된 소유자, 합성 수집 접근 상태 및 사이트 권한을 확인한 뒤 영속 시작 의도와 `SessionEndCheckpoint.ack`에서 읽는다. 모드가 없는 이전 레코드는 기존 AI 실행 경로와 같은 기본값을 사용한다. 목표·시각은 정책 차단 중 숨긴다. BE API, 보고 지표, Worker 메시지 발신자 검증, 세션 핸들, IndexedDB 스키마, 알림·Outbox 정책을 유지했다. 표시 경계는 기존 이중 `requestAnimationFrame`, 문서 가시성과 Worker의 활성 탭 확인이며 선택 시각은 기존 Worker가 정한다.

로컬 SVG 마크 및 16·32·48·128px PNG를 사용한다. 알림에는 같은 마크를 64px PNG로 제공한다. Manifest는 아이콘 리소스만 추가한다. CDN, 새 패키지, 새 권한 및 외부 접속은 추가하지 않았다. [Chrome action API](https://developer.chrome.com/docs/extensions/reference/api/action)

## Chrome 화면 증거

기준과 변경 빌드를 별도 임시 프로필 및 루프백 합성 데이터로 실행했다. 비교 캡처는 동일한 380px 탭 뷰포트에서 얻었다. 데스크톱 알림은 920px 탭의 콘텐츠 영역을 캡처했다. 실제 툴바는 추가로 열어 크기, 스크롤과 재열기를 확인했다.

| 화면 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 인증 | [기준](evidence/issue141/before/01-access.png) | [인증](evidence/issue141/after/01-access.png) |
| 동의 | [기준](evidence/issue141/before/consent.png) | [동의](evidence/issue141/after/consent.png) |
| 최초 목표 | [기준](evidence/issue141/before/02-goal.png) | [목표 입력](evidence/issue141/after/02-goal.png) · [시작 확인](evidence/issue141/after/03-starting.png) |
| AI 진행 | [기준](evidence/issue141/before/active-AI.png) | [AI 진행](evidence/issue141/after/active-AI.png) |
| 고정 주기 진행 | [기준](evidence/issue141/before/active-FIXED_INTERVAL.png) | [고정 주기 진행](evidence/issue141/after/active-FIXED_INTERVAL.png) |
| AI 알림 | [기준](evidence/issue141/before/alert-AI.png) | [좁은 탭](evidence/issue141/after/alert-AI.png) · [데스크톱](evidence/issue141/after/alert-desktop-AI.png) |
| 고정 주기 알림 | [기준](evidence/issue141/before/alert-FIXED_INTERVAL.png) | [좁은 탭](evidence/issue141/after/alert-FIXED_INTERVAL.png) · [데스크톱](evidence/issue141/after/alert-desktop-FIXED_INTERVAL.png) |
| 선택 | [기준](evidence/issue141/before/selection-AI.png) | [선택 및 서버 확인](evidence/issue141/after/selection-AI.png) |
| 종료 | [기준](evidence/issue141/before/07-ended.png) | [종료 확인 중](evidence/issue141/after/06-ending.png) · [완료](evidence/issue141/after/07-ended.png) |
| 연결 오류 | [기준](evidence/issue141/before/05-server-unreachable.png) | [서버 응답 실패](evidence/issue141/after/05-server-unreachable.png) |
| 기록 복구 | [기준](evidence/issue141/before/receipt-recovery.png) | [이전 작업 기록의 수동 복구](evidence/issue141/after/receipt-recovery.png) |
| 연결·개인정보 | [기준](evidence/issue141/before/settings.png) | [설정](evidence/issue141/after/settings.png) · [철회 확인](evidence/issue141/after/withdraw-dialog.png) · [철회 완료](evidence/issue141/after/withdrawn-320px.png) |

[320px 긴 목표](evidence/issue141/after/active-320px.png)와 [Chrome 200% 확대](evidence/issue141/after/active-200-percent.png)에서 줄바꿈과 가로 스크롤을 확인했다. 화면 캡처의 문구, 버튼 간격, 초점 링, 두 알림 레이아웃을 직접 검토했다.

## 시험 결과

환경은 macOS arm64, Node.js 25.9.0, Playwright를 통한 Chrome for Testing 151이다. 네트워크 오류·시작과 종료 ACK 유실·동일 계정 복구와 계정 전환·철회는 격리된 Mock 서버에서 재현했다.

| 검증 | 실행 결과 |
| --- | --- |
| FE 타입 검사 및 전체 테스트 | 기준 1,225건 → 변경 1,251건 통과. Snapshot, UI·Worker 상호작용, 선택 및 가시성 신규 26건 포함. 기존 opt-in HTTP 2건은 기본 실행에서 건너뜀 |
| Chrome 툴바 및 접근성 | 실제 브라우저 액션 팝업을 열어 본문 388px, 긴 목표에서 스크롤바 포함 404×600px 확인. 설정 스크롤·닫기·목표 복원 통과. 탭에서 320px, 200% 확대, 목표 4·5·150·151자, 키보드 인증·동의·철회, 대화상자 초점 및 복귀 확인 |
| 기존 R2·R3·R4 사용자 Chrome | 18개 통과. 서버 확인 전 종료 시각 비공개, 종료 ACK 시각 표시, 시작·종료·재인증·재연결·Chrome 재시작·알림 상세와 선택 포함 |
| Worker 알림 제출 복구 | 7개 통과. 전체 18개에 포함되며 독립 재실행에서도 통과 |
| R4 Outbox | 자동 재시도·소진·수동 복구·이전 세션·계정 격리·충돌 통과. PR #136 빌드가 만든 IndexedDB를 실제 Chrome에서 이관 |
| R5 고정 주기 | 유효성 19개 통과. 권한 복구, 과거 회차, 상세 조회 실패, 종료, 늦은 응답 차단 포함 |
| R5 비교 평가 | 정상 두 모드 및 장애 주입 통과. 비교 집계의 기준과 변경 결과가 정상, 서버 저장 전 실패, 복구 전, 복구 후 모두 일치 |
| 빌드 | 사용자 AI와 고정 주기, v1·dev·synthetic·participant·pilot·real 통과. participant·real은 비운영 `.invalid` 주소와 DRAFT 정책을 사용 |
| 번들 | 사용자 AI Popup JS gzip 74.41 → 76.78 kB, CSS gzip 1.11 → 2.36 kB, Worker gzip 36.47 → 36.54 kB |
| 수집·HTTP 계약 범위 | 공통 Runtime·Repository·API·저장 구조와 BE 변경이 없어 별도 Spring/H2·opt-in HTTP 및 수집용 브라우저 통합은 재실행 범위에서 제외. 수집 빌드와 전체 FE 회귀를 실행 |

합성 비교의 장애 복구 후 두 모드에서 각각 후보 3건, Chrome 제출 확인 2건·불확실 1건, 상세 표시 2건, 서버 선택 ACK 2건을 확인했다. 두 선택의 비율은 각 50%였고 미확인 기록은 각 1건에서 0건으로 줄었다. 동일 시나리오의 집계 결과이며 실제 사용자의 효과를 측정한 수치는 아니다.

### 재현 명령

`fe`에서 실행한다. 최근 Playwright용 브라우저를 설치하거나 Chrome for Testing 실행 파일을 `CHROMIUM_PATH`에 지정한다.

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
npm run test:user:browser -- --recovery-only
npm run test:user:browser -- --outbox-only
npm run test:user:browser -- --fixed-validity
npm run test:user:browser -- --evaluation
HEADED=1 npm run test:user:browser -- --ui
```

기준 자료는 공식 main에서 같은 캡처 지점을 실행했다. 별도 빌드 경로를 쓰려면 `USER_EXTENSION`을 지정한다. 캡처 폴더의 평가 JSON에는 합성 내부 ID가 포함돼 PNG만 저장소에 포함했다.

### 재현 중 수정한 내용

| 관측 | 원인과 수정 | 재검증 |
| --- | --- | --- |
| 첫 시작 요청이 대기 중에 재시도 버튼 문구 표시 | Polling이 로컬 명령 완료보다 먼저 START_PENDING을 관측했다. `popup.tsx`에서 최초 요청과 재시도 진행 중에 같은 확인 상태를 표시한다. | 서버 지연 중 정확한 비활성 동작과 동일 시작 요청을 Chrome에서 확인 |
| 실제 툴바 팝업에서 기본 폭이 220px로 축소 | 브라우저가 좁은 초기 뷰포트에서 콘텐츠의 고유 폭을 계산했다. `index.tsx`와 스타일에 실제 툴바에만 적용하는 388px 고유 폭을 제공했다. | Chrome의 툴바 팝업에서 본문 폭과 스크롤바 포함 너비를 따로 확인하고, 탭은 320px에서 재검증 |
| 200% 증거 캡처에 오른쪽 일부가 누락 | 요소 단위 캡처가 CSS 단위와 확대된 화면 픽셀을 다르게 적용했다. 확대가 적용된 탭 화면을 캡처하고 DOM의 가로 크기를 별도로 검증했다. | 640px 창에서 확대된 320 CSS px 확인 |
| 수동 복구 캡처에 자동 재시도 상태가 남음 | 영속 저장소 업데이트와 Popup 폴링 사이에 시차가 있었다. 수동 복구 버튼이 표시될 때 캡처한다. | 소진 안내와 실제 수동 복구 및 ACK를 같은 시나리오에서 확인 |

## 체크리스트와 후속 통합

| 이슈 #141 항목 | 확인 |
| --- | --- |
| 1–4 구조·브랜드·토큰·컴포넌트 | 기준 분석, 화면 시안, 로컬 아이콘 및 공통 UI, 메시지 분리 |
| 5–7 인증·동의·목표·작업 진행 | 합성 전용 안내, 기존 검증·요청 보존, 소유한 세션의 시작 시각과 영속 모드 |
| 8–10 알림·종료·복구 | 두 모드의 공통 선택, 가시성 및 최초 선택 시각 유지, 종료 ACK 시각, 이전 기록 복구 |
| 11–12 설정·예외 | 서버 검증 시각, 권한 안내, 철회의 명시적 확인, 우선 처리 및 오류에 맞는 복구 |
| 13 레이아웃·접근성 | macOS 실제 툴바, 별도 상세 탭, 키보드, 320px, 200%, 대비 검증. Windows와 실제 스크린 리더는 후속 |
| 14 비교 평가 | 두 모드의 정상·장애 실행 집계 일치 |
| 15–16 실제 Chrome·회귀 | 위 검증 표, 화면 증거와 재현 명령 |
| 17 문서 | 디자인 토큰, 계약, 검증 결과 및 R6 연결 지점 기록 |

합성 발표 시연 흐름은 인증부터 종료·복구까지 사용할 수 있다. 실제 사용자 인증·동의·보존 정책과 실험군 배정, 모드 공개 및 문구 동일화 범위, 네이티브 OS 알림의 배너 표시·물리 클릭, Windows 및 스크린 리더, 실제 FE·BE·AI 통합은 R6와 최종 시연 준비에서 확인한다. 이 단계의 Chrome 자동화는 등록된 알림 클릭 리스너를 호출해 상세 탭 진입을 재현했다.
