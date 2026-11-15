# PR #125 추가 검토와 실제 재검증

검증일: 2026-11-15 KST. **판정: 운영 적용 승인 대기.** 새 코드의 독립 환경 검증은 통과했다. 운영 C 배포·v7 동의·과거 Attempt 복원은 수행하지 않았다. 과거 #123의 정확한 이벤트 원인과 현재 방어 코드의 검증 결과를 구분한다.

## 1. 기준과 증거 범위

| 항목 | 확인 결과 |
|---|---|
| PR / Issue | [#125](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/125) / [#124](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/124) |
| 브랜치 | `fix/124/raw-collection-continuity` |
| 검토 시작 HEAD | `be2b0432ecee700bc90011c57e81d9b320f634c2` |
| 보안·권한·업그레이드 수정 | `80b975249fbda8c7fe7a3424debd359afdac0479` |
| 최종 코드·패키지·새 10 Visit 검증 | `f1de635fd51778241ad728d1fd2a15da938023a3` |
| 이후 변경 | 이 보고서와 정제된 결과 문서. 실행 코드 변경 없음 |
| 시작 사용자 변경 | 보존. 운영 checkout·프로필·DB를 개발 worktree로 사용하지 않음 |
| DB 스키마 변경 | 없음 |

기존 `raw-collection-v7-validation.md`, `raw-collection-v7-results.json`, v6/v7 정책 원문과 API 계약을 대조했다. `/private/tmp/focus124-evidence`는 실제로 남아 있었다. 기존 성공을 재확인한 것과 이번에 새로 실행한 검사를 혼동하지 않았다. 이번 정제된 실행 결과·증거 파일 SHA-256은 [followup-results.json](raw-collection-v7-followup-results.json)에 기록했다. 원본 로그·암호화 백업·키·Credential은 Git에 넣지 않았다. 임시 경로는 영구 보관소가 아니다.

이전 보고서의 Blogger 분류는 보강이 필요했다. `blog.python.org`라는 도메인만으로 플랫폼을 확정할 수 없다. 이번에는 `generator=blogger`인 Blogger 공식 게시글에서 실제 본문과 저장을 확인했다. 이전 Chrome 151 성공을 Chrome 157 검증으로 재표기하지 않았다.

## 2. 새로 발견하고 수정한 문제

| 문제 | 재현과 원인 | 수정·재검증 |
|---|---|---|
| 인용된 Credential key 누락 | 기존 정규식은 `password:`는 잡지만 `{"비밀번호":"fictional-value"}`처럼 key와 구분자 사이의 닫는 따옴표를 놓쳤다. FE 본문 추출·BE 검증 우회를 가상 값으로 재현했다. | FE `privacy.ts`와 BE `MetadataPage`를 함께 수정. JSON·단일 따옴표 key와 공개 연락처/민감 표현의 공통 corpus를 FE·BE에서 검사. 실제 통제 페이지 제외 후 다음 실제 문서 수집 성공. |
| FE 허용 URL을 BE가 거절 | `account`, `login`, `auth`, `wallet` 및 점·하이픈 호스트 경계가 달랐다. 로컬 Visit 뒤 서버 정책 오류로 Queue가 멈출 수 있었다. | `fe/real/url.ts`의 RAW 호스트 규칙을 BE와 맞춤. 공통 URL corpus에서 공개 URL 허용·비공개/인증 URL 제외 일치. |
| 현재 동의 분기의 digest 누락 | `CollectionDataAuthorization.CONSENT`의 같은 동의 분기는 로컬 소유자의 정책 digest와 Session scope 일치를 확인하지 않았다. 잘못된 v7 scope가 `RAW_COLLECTED`로 보이는 실패를 재현했다. | 로컬 소유자 존재 시 scope digest 일치 요구. 명시적인 과거 동의 경로는 유지. v5/v6/v7, 타인, 잘못된 현재/과거 digest, 철회, Tombstone, 인증 취소 테스트 통과. 잘못된 구형 테스트 fixture의 scope를 올바르게 수정했다. |
| 설정 명령의 자동 정책 전환 | 공식 v6 SHA를 자동 업그레이드 목록에 넣어 일반 setup/인증 갱신이 정책 전환을 선택할 수 있었다. | 기본값은 기존 pin 보존. `setup --upgrade-policy`만 공식 정책 전환 선택. `--preview-policy`는 중지·DB·파일 쓰기 없이 선택 결과 제공. custom 정책은 명시적인 파일·SHA 필요. |
| 정책 파일 교체 실패의 복원 | 정책과 config의 두 파일 교체 사이 오류를 다뤄야 하며, 텍스트 읽기/쓰기는 CRLF 바이트를 바꿀 수 있었다. | staged 교체와 오류 시 기존 정책 바이트 복원. CRLF까지 같은지 회귀 검사. DB 반영 이후 파일 실패는 자동 DB 롤백을 가장하지 않고 fail-closed 복구 안내. |
| 재수집 dialog 처리 중 대상 변경 | dialog 열림/요청 중 배경 동작, cancel·select 및 오래된 상태의 재확인이 부족했다. | 요청 중 잠금, 배경 재수집 비활성화, privacy/session/Visit/delivery 상태 재검증, 기본 Cancel·Escape·Tab 포커스 처리. 빠른 클릭·선택 변경·stale 상태·중복 Enter 검사. |
| 인증 차단 시 상태 0 오해 | 인증으로 숨긴 로컬 집계가 실제 0처럼 표시됐다. | 인증 확인 후 표시로 구분. 다른 계정의 로컬 데이터를 공개하지 않음. |

주요 파일은 `fe/src/shared/privacy.ts`, `fe/real/url.ts`, `fe/participant/Attempts.tsx`, `fe/participant/index.tsx`, `CollectionDataAuthorization.java`, `MetadataPage.java`, `tools/individual-local/local.py`다. 대응 FE/BE/도구 회귀 테스트와 `docs/contracts/v2/fixtures/raw-v7-boundaries.json`을 추가했다. 본문 추출·검색·Queue의 정상 구현을 다시 만들거나 Visit 기준을 완화하지 않았다.

## 3. 개인정보·동의·권한의 최종 경계

v7 원문과 digest는 변경하지 않았다: `4c5fe813d703a3ae1d6bf95f3de3aca8ae12c94a5c4a8ca4a161ad29d6dd11f9`. 공개 연락처, 의료·금융 등 의미 표현과 공개 검색어를 이유로 마스킹·격리하지 않는다. FE 내용 검사와 BE `MetadataPage`/`CollectionSitePolicy`·POST/PATCH 경로를 대조하고 공통 corpus로 경계를 확인했다.

인증·참여자/배정/Session 소유권·직접 동의·정책 pin·Credential 형태 문자열·비공개/인증 경로·입력값 보호·철회·Tombstone·무결성 검증은 유지한다. 실제 통제 문서의 가상 연락처가 원문으로 저장됐고 password input 및 textarea의 `NEVER_COLLECT` 값은 저장되지 않았다. 인용된 가상 Credential 문서는 제외됐지만 Session은 ACTIVE/CLEAR였고 다음 MDN 문서는 정상 저장됐다.

기존 v6 정책 원문 SHA는 `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982`로 유지했다. 과거 세션의 접근은 유효한 동의·소유권·명시적인 정책 scope 호환 조건을 만족해야 한다. 과거 동의를 v7 새 수집에 자동 적용하지 않으며 기존 consent/withdrawal/Tombstone을 수정하지 않는다. 새 검증은 이전에 사용자가 직접 동의한 동일 독립 참여자와 동일 v7 정책을 사용했다. 동의 버튼이나 동의 API를 대신 실행하지 않았다.

## 4. Issue #123 재수집 방어

과거 두 `LOCAL_RECOLLECT`의 정확한 UI 이벤트/Network 기록은 여전히 없다. React key 변경이나 사용자의 특정 조작을 과거 사건의 확정 원인으로 보고하지 않는다.

현재 생성 경로는 `Attempts`의 대상 dialog → `v2-recollect` → 인증된 대상 tuple 요청 → Backend 소유자/Attempt/Session/배정/상태 검증이다. UI stale 응답·재렌더링·빠른 선택 변경·중복 클릭·키보드 Enter와 dialog focus를 검사했다. Backend transaction 잠금의 두 동시 요청을 H2·실제 MySQL에서 실행했다. PLAN-006(부족) 처리 중 PLAN-003(정상10)의 모든 Attempt/Visit 열과 기존 감사 행이 보존됐고 대상 audit는 하나였다.

실제 확장 UI에서도 완료 PLAN-003 dialog의 기본 Cancel에 Enter를 눌러 요청 0건, 부족 PLAN-015 확인에 연속 Enter로 요청 1건을 확인했다. 이어 부족 PLAN-009에 인증된 두 동시 HTTP 요청을 보내 두 응답 204·대상 audit 1건을 확인했다. 이 API 경쟁 검사는 실제 브라우저 Visit 수집으로 계산하지 않았다.

이 구간 전후에 독립 환경 정상 완료 PLAN-003·006·012의 **Session/Attempt 모든 열, 30개 Visit 모든 열, 기존 감사 행** 지문을 별도로 대조했다. 모두 보존됐고 새 감사 행은 의도한 두 대상에 대한 2건이었다. 이미 수집된 ID·순서·본문을 재생성하거나 완료 상태를 바꾸지 않았다. 운영 C의 과거 잘못된 PLAN-003 상태는 승인 없이 복원하지 않았다.

## 5. 자동화 검증

| 실행 | 결과 |
|---|---|
| `cd fe && npm test -- --run` | 1,118 성공, 실패0, 기본 환경 opt-in HTTP2 미실행 |
| BE 전체 실행이 띄운 FE HTTP93/95 | 위 opt-in2를 각각 실제 HTTP로 실행, 2 성공. 가상 시계/fixture 검사이며 공개 웹 실제 수집과 구분 |
| `cd fe && npm run typecheck` / `npm run build:real` | 성공 |
| `npm run package:collection -- real` | 성공, manifest 권한 유지, 패키지 검사 통과 |
| `run-regression.py …` → `./gradlew test --rerun-tasks --console=plain bootJar` | 실제 MySQL·HTTP·Chrome fixture 포함 64개 class, 1,236 성공, 실패/오류/skip0 |
| `python3 -m unittest discover -s tools/individual-local` | 44 성공 |
| `PYTHONPATH=ai …/python -m pytest ai/tests -q` | 289 성공, 외부 Starlette deprecation warning1 |
| 최종 `./gradlew bootJar` / `git diff --check` | 성공 |

전체 BE/FE 회귀는 80b9752의 실행 코드를 대상으로 했다. f1de635는 검증 도구와 정책 파일 바이트 보존만 추가하며 FE/BE 실행 소스가 같다. 최종 f1de635 FE·BE 패키지에서 새 실제10 수집을 다시 실행했다. 패키지 SHA-256: `397fcb94b47b5aa73c12ff8579d4cae37bc370c1de8a95fe5772071fa072246c`.

실제 Credential·DB/TLS 비밀번호·service secret의 정확한 값으로 추적 파일을 검사했다. 이전 검사10개와 인증 갱신 후 현재 값9개 검사에서 일치0. 공개 base URL 설정은 비밀값으로 분류하지 않는다. 이는 알려진 값 검사이며 모든 가능한 비밀 형식에 대한 수학적 보장은 아니다.

## 6. 새 실제 공개 웹 수집

| 항목 | 실제 결과 |
|---|---|
| OS/Chrome | macOS arm64, 일반 Chrome157.0.8103.51에서 앞7개 저장·재시작 보존. 최종 완주와 스트레스는 공식 Chrome for Testing157.0.8103.78 |
| 독립 환경 | API `https://localhost:19425`, MySQL33425, 별도 프로필·Volume. 기존 C와 다름 |
| Extension | 0.4.0, `haebiiiblkgpeaimegmamomfakfcieck`, 최종 source=f1de635 / dirty=false |
| 설치 조건 | 공식 CDP local pipe `Extensions.loadUnpacked`, 개발용 플래그 사용. Chrome Web Store/일반 사용자 설치 UI 검증으로 주장하지 않음 |
| 직접 동의 | 기존 독립 참여자의 직접 v7 동의·현재 정책 일치 확인 |
| Google | 입력 → 결과 렌더링 → organic9개 추출 → 검색어 원문 DB 일치 → 실제 링크 클릭 → refactoring.com 리디렉션·본문 저장 |
| 네이버 | 입력 → 결과 렌더링 → organic19개 추출 → 한글 검색어 원문 DB 일치 → 실제 티스토리 링크 클릭·본문 저장 |
| 1 → 5 → 10 | 각 단계 local/ACK/MySQL=1/1/1, 5/5/5, 10/10/10, 각 pending0 |
| 최종 상태 | `ENDED / CLEAR`, end ACK=`acked`, `RAW_COLLECTED` |
| 중복/행동 대조 | ID·sequence·activeDuration·tabSwitchCount·behaviorVersion가 로컬/서버 모두 일치. 최소 활성5,507ms |
| 이전 데이터 | 실패·재시작을 겪은 PLAN-012도 기존7을 이어10 완료. 최종 새 PLAN-018 전후 기존 ID·순서·본문 hash 모두 보존 |

새 PLAN-018은 최종 FE·BE source commit을 맞춘 뒤 처음부터 새로 수집한 기술 검증이다. 앞서 정상 저장된 데이터를 재수집 대상으로 바꿔 시작한 것이 아니다. 공개 웹10개에 직접 API 삽입·가상 시계·활성 상태 위조를 사용하지 않았다. Playwright 포커스 에뮬레이션은 끄고 실제 Chrome 창/탭과 native 앱 전환을 사용했다. 운영 Chrome과 같은 앱 bundle의 다중 프로세스를 UI 도구가 구분하지 못하는 제약 때문에 별도 공식 CFT157을 사용했다. 운영 Chrome과 패치 버전까지 같다는 주장은 하지 않는다. [CDP](https://chromedevtools.github.io/devtools-protocol/) 개발 설치는 운영 설치 절차와 구분한다.

실제 문서와 추출 글자 수:

| 유형 | 방문 URL | 글자 수 |
|---|---|---|
| Google 검색 | `https://www.google.com/search` — `site:martinfowler.com refactoring` | 1,843 |
| 검색 결과 공개 문서 | `https://refactoring.com/` (실제 클릭의 redirect) | 5,000 |
| 네이버 검색 | `https://search.naver.com/search.naver` — `site:notice.tistory.com 티스토리 공지` | 4,513 |
| 티스토리 공지 스킨 | 실제 검색 결과의 `notice.tistory.com` 게시글, 정확한 URL은 결과 JSON | 3,501 |
| 다른 티스토리 스킨 | `https://goddaehee.tistory.com/199` | 5,000 |
| 네이버 블로그 iframe | `https://blog.naver.com/insaweb/221650456057` | 1,884 |
| WordPress | `https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/` | 5,000 |
| Blogger (`generator=blogger`) | `https://blogger.googleblog.com/2020/05/a-better-blogger-experience-on-web.html` | 2,608 |
| 동적 공개 문서 | `https://react.dev/learn` | 5,000 |
| 실제 SPA 링크 이동 | `https://react.dev/learn/thinking-in-react` | 5,000 |

Google 광고 컨테이너2·네이버 해당 광고 selector0이 관찰됐다. 이는 유료 광고의 실제 노출 개수 판정이 아니다. organic 경계와 광고 제외 구현/fixture를 별도로 검증했다. 위 공개 페이지 외에 실제 MDN Web Workers 문서도 스트레스 흐름의 다음 페이지로 저장했다. 일반 뉴스 기사·Windows·모든 사이트/스킨을 이번 추가 공개10에서 망라한 것은 아니다.

## 7. 중단·복구 및 실패의 분류

| 시나리오 | 실제 추가 검증 |
|---|---|
| 약3초 → 다른 앱10초 → 복귀 | 실제 비활성37,885ms(앱 전환 대기 포함), 활성3,923→5,647ms, 같은 후보 ID |
| 약3초 → 다른 앱60초 → 복귀 | 실제 비활성74,793ms, 활성3,004→5,822ms, 같은 ID |
| 약3초 → 다른 앱5분 → 복귀 | 실제 비활성315,605ms, 활성3,005→5,737ms, 같은 ID |
| 여러 탭 | A 부분 체류→B 부분 체류→A, A의 같은 ID로 Visit 인정, 다른 문서 시간이 합쳐지지 않음 |
| 미전송 POST | 실제 브라우저 요청3회 네트워크 오류 주입. 로컬 Queue 보존. 물리적인 네트워크 어댑터 차단은 아님 |
| Service Worker 재시작 | 실제 worker 정지 후 미전송 Visit ID·Queue 복원 |
| Chrome 재시작·인증 만료 | 독립 Credential 실제 만료→401→독립 Chrome 종료→공식 동일 권한 Credential 갱신→같은 프로필 재시작·재인증→같은 Visit ACK, pending0 |
| ACTIVE 복귀 | 기존 로컬 Session·배정으로 resume. 다른 Session 생성으로 우회하지 않음 |
| FE6/BE7 | 실제 v6 확장을 같은 독립 확장 경로에 로드해 수집 차단·기존 Queue ID 보존. v7 파일 복원 후 재개 |
| FE7/구 정책 응답 | 실제 브라우저에 v6 정책 API 응답 fixture로 차단·Queue 보존 확인. 실제 구 BE 바이너리 전체 구동은 미실행 |
| 동적/본문 실패 | 2.5초 지연 렌더링 통제 문서 성공. 인용 Credential 페이지 제외 후 실제 MDN 수집 성공, Session ACTIVE/CLEAR 유지 |

앱 검사는 native 계산기를 실제 전면에 올리고 Chrome을 최소화한 뒤 정해진 시간만큼 기다렸다. 비활성 중 후보가 유효 임계값에 도달하지 않았는지 검사했다. 스트레스 Session은 의도적으로7개로 종료해 `RECOLLECT_REQUIRED`가 맞으며 이를 실제10 성공으로 세지 않았다. 공개10의 `RAW_COLLECTED`와 구분한다.

검증 도중 발생한 실패를 숨기지 않는다:

- 네이버 일부 검색은 실제 검색 결과 없음 또는 `cookie=…` 형태 코드 snippet의 Credential 보호 제외였다. DOM 진단으로 분류했고 이를 개인정보 검열로 단정하지 않았다. 해당 값은 로그/보고서에 기록하지 않았다.
- MySQL CLI의 기본 문자셋 때문에 한글 비교 출력이 `?`로 보였다. DB UTF-8 HEX는 정상이었고 검증 클라이언트를 utf8mb4로 고쳤다. 수집 데이터 오류로 보고하지 않는다.
- 설치 실행기의 기본 `--disable-extensions`, 실제 링크 리디렉션을 빠뜨린 URL 기대값, Blogger의 오래된 selector, 잘못된 native 창 선택을 수정했다. 이미 저장한7개는 같은 세션으로 이어10을 완료했다.
- 첫10초 앱 검사는 최소화 뒤 검증 도구가 Chrome을 다시 올려 활성 시간이 늘어나 실패했다. 그 실패 로그를 보존하고 같은 pending 데이터를 복구한 뒤 새 후보에서10/60/300초를 모두 다시 통과했다.
- 통제 HTML의 charset 누락을 UTF-8로 바로잡았다. 해당 fixture의 이전 깨진 한글을 실제 사이트 추출 오류로 분류하지 않는다.
- 첫 백업 복원은 초기화 중인 MySQL을 준비 완료로 판단해 실패했다. 정상 서버 port·DB 준비까지 기다린 재시도에서37개 테이블 전체 행 지문·50개 FK가 일치했다. 네트워크 none, 호스트 포트0, tmpfs의 별도 복원 DB만 사용했고 원본은 그대로였다.

## 8. 운영 C 보존·전환 준비와 남은 조건

운영은 **읽기 전용**으로 확인했다. v6 SHA·config·FE 파일 hash·BE runtime source·Chrome 버전·Extension ID·DB 집계/Attempt 상태·동의/감사 기록·MySQL Volume/시작 시각/재시작 횟수가 작업 전후 같았다. 운영 DB에는 테스트 데이터를 넣지 않았다. 프로필 파일의 OS 읽기 제한을 해제하지 않았다. 이미 열린 확장 DevTools의 IndexedDB readonly transaction으로만 현재10/ACK10/pending0/ENDED/end ACK를 확인했고 수집·재수집·동의 API는 호출하지 않았다.

| 운영 항목 | 상태 |
|---|---|
| Chrome / Extension ID | 157.0.8103.51 / `aocfmndihdfimoocmdafcbkgifbpdhbl` |
| 정책 | v6, 원문·config SHA31db… 일치 |
| FE source | `63251de9f6633131295ee4e23c5bf885d5c534f6` |
| BE runtime source / 실행 | `cc42a954e15b0067641143f5a724b075ce06f017` / 중지 상태,9443 불가 |
| Credential / 동의 | Credential 만료, 기존 v6 동의1건 유지. v7 자동 동의 없음 |
| DB / Volume |33101 / `focus-local-cddfab90d1f8_local-db`, 컨테이너 재시작0·기존 시작 시각 유지 |
| 현재 Queue | readonly 확인 local10/ACK10/pending0, `ENDED / CLEAR`, end ACK=`acked` |
| 과거003 / 최신006 |003의10개와 잘못된 재수집 상태 그대로 보존. 최신006은10개·ENDED/CLEAR/PENDING 유지 |

운영 프로필 전체의 바이트 백업·전체 행 보존 증명까지 수행한 것은 아니다. 운영 초기 SQL 지문은 기본 GROUP_CONCAT 제한이 있어 전체26개 Visit의 완전한 지문이라고 주장하지 않는다. 독립 환경 정상30개 Visit의 모든 열 보존 검사는 별도 증거다.

운영 전환 전에 별도 승인할 범위는 다음과 같다.

1. C의 프로필을 안전하게 멈춘 상태에서 프로필/IndexedDB/Queue/확장 파일·설정·정책·암호화 DB를 새 백업하고, 같은 MySQL 버전의 격리 복원을 검증한다. 이번37-table 복원은 독립 테스트 DB에 대한 검증이다.
2. 기존 ID/경로/Volume을 유지하면서 FE·BE·정책을 함께 적용한다. `setup --preview-policy`로 기존 v6 보존을 확인하고, 명시적인 `setup --upgrade-policy --preview-policy`의 v7 선택 범위를 검토한 후에만 실제 업그레이드한다. 자동 정책 승계는 없다.
3. 먼저 pending0·종료 ACK를 다시 확인한다. CLI는 브라우저의 로컬 Queue를 읽지 않으며, BE의 ACTIVE 정책 전환 차단만으로 종료 후 로컬 ACK까지 입증하지 못한다. 업그레이드 전 운영 절차에서 이 조건을 확인해야 한다.
4. 만료된 C Credential을 공식 갱신하고 사용자가 직접 v7 재동의한다. 그 후 운영 C에서 새1→5→10을 검증한다. 기존 완료 데이터를 재수집 대상으로 만들지 않는다. 과거003 복원은 별도 대상/사유/감사 계획이 필요하다.

파일 설치 중 오류가 나면 원래 정책/config 바이트를 보존하고 digest 불일치로 차단한다. DB가 이미 새 정책을 적용했을 수 있으므로 config만 수동으로 되돌려 수집을 강행하지 않는다. 명시적인 검토된 policy 파일·SHA로 재시도한다. 롤백은 기록한 기존 FE·BE·정책을 함께 복원하되 기존 데이터/새 v7 동의/철회 기록을 삭제하거나 과거 DB 백업으로 덮어쓰지 않는 별도 계획이 필요하다. v6 FE로 v7 Queue를 전송해 소진하려 하지 않는다.

## 9. PR 판단

GitHub Actions workflow와 check run은 없으며 로컬 성공을 CI 성공으로 표시하지 않는다. 검토에서 지적한 두 결함과 추가 권한/업그레이드 문제는 코드·자동화·새 실제 수집으로 검증했다. 이 결과로 Draft 해제와 코드 리뷰 진행이 가능하다. 병합·Issue 종료·운영 배포는 수행하지 않는다.

남은 것은 운영 전환 승인과 직접 재동의, 운영에서의 새 실제 검증, Windows/정확히 같은 일반 Chrome 패치 버전의 완주, 실제 구 BE 바이너리 혼용 검사, 과거 #123의 정확한 이벤트 원인 및 운영 상태 복원이다. 현재 방어 검증의 통과와 이 제한을 함께 보고한다.
