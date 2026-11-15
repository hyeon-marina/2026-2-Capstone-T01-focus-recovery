# Issue #124 — v7 RAW 수집 수정 및 실제 검증

검증일: 2026-11-15 KST. **최종 판단: 부분 완료.** 수정된 수집 기능은 독립 환경에서 실제 공개 웹 1 → 5 → 10 Visit, 서버 ACK, MySQL 저장, 복구까지 통과했다. 다만 과거 운영 #123의 두 `LOCAL_RECOLLECT` 요청이 시작된 정확한 이벤트는 재현·확정하지 못했다. 이를 해결 완료로 간주하여 #123/#124를 닫거나 운영 C에 배포하지 않았다.

## 1. 작업 기준 및 보존

| 항목 | 기록 |
|---|---|
| Issue | [#124](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/124), #123 포함 |
| 작업 브랜치 | `fix/124/raw-collection-continuity` |
| 시작 HEAD | `e088f03780b76404e4bba17138670e40d47600d8` (detached) |
| 구현 기준 HEAD | `5e6a6f091a509cf66e8896ace6084fda76870d84` (확인한 upstream/main) |
| 시작 변경 사항 | 추적 파일 변경 및 미추적 파일 없음 |
| 원격 | origin: 개인 fork, upstream: 공식 저장소; 원격 이력 확인 후 Issue 전용 브랜치 생성 |
| 구현 Commit | `290d5da8cbfe31056bf0a2ffd8d9b9fc0d3c9c90` |
| 최종 Commit | 본 보고서가 포함된 Git 이력과 최종 사용자 응답에 기록. self hash를 문서에 순환 삽입하지 않음 |
| DB 변경 | 스키마/DDL 변경 없음 |

저장소 및 상위 디렉터리에서 적용할 `AGENTS.md`는 발견되지 않았다. TEAM_POLICY, 본문 수집·공개 문서 검증·API 문서를 먼저 확인했다. Issue/PR #120, #121, #122, #123, #124 및 PR #120/#122의 병합 상태를 확인했다. 시작 HEAD에는 최신 병합 내용이 없었으므로 최신 upstream/main을 기준으로 했다. #123이 닫혀 있다는 사실을 해결 코드의 증거로 사용하지 않았다. PR #122의 동적 본문 재시도, iframe 검증, 진단 및 ACK 보존은 재사용했다.

기존 운영 C의 Chrome Profile, Extension ID, IndexedDB/Queue, Credential, Session/Attempt/Visit, 동의/철회/격리/Tombstone, MySQL Volume, 설정 및 사용자 파일을 변경하지 않았다. 운영 C 컨테이너를 정지하거나 초기화하지 않았고, 테스트 데이터를 삽입하지 않았다. 운영 데이터 전체에 대한 새 백업·체크섬 검사는 수행하지 않았으므로 해당 검증까지 했다고 주장하지 않는다. 별도 worktree와 `/private/tmp/focus124-evidence` 아래의 신규 기술 검증 환경만 사용했다.

## 2. 확인한 원인과 수정

| 문제 | 확인한 코드/재현 근거 | 수정 및 재검증 |
|---|---|---|
| 공개 글·검색어의 오탐과 격리 | v6 `highRiskText`, `publicText`, `safeSearchIntent`, DOM의 민감 입력 탐지, 연락처 마스킹, BE `MetadataPage`가 중복 적용됨 | 직접 동의한 v7 `CONSENTED_RAW`에서 의미·연락처 필터를 해제. 가상 연락처/민감 표현 FE·BE 테스트 및 실제 Extension 통제 문서 저장 성공 |
| ACTIVE/PENDING 재수집 안내 | 기존 UI는 RAW_ONLY에도 AI 품질 `status`를 주로 표시했고 ACTIVE와 종료 후 검토 PENDING을 같은 차단 안내로 처리 | 로컬 RAW에서는 `rawStatus`를 표시. 같은 로컬 ACTIVE 배정/세션을 서버에 재확인하고 이어서 수집. 다른 프로필 세션은 임의 인수하지 않음 |
| 복귀 후 짧은 Visit 소실 | `RETURN_MS=4000` 이후 미완료 후보도 닫힘. 인증 중단/worker 초기화는 후보와 탭 연결을 닫음 | v7에서 같은 탭·문서·페이지의 미완료 후보만 유지. cursor는 지워 비활성·worker 세대 사이 시간을 더하지 않음. 실제 탭 30초/앱 약126초 복귀 성공 |
| 이미 유효한 Visit 재방문 | 기존 4초 경계와 미완료 합산을 구분해야 함 | 유효 Visit의 4초 재방문 규칙, 5초 기준, 최대 관찰 간격1500ms 유지. 회귀 테스트 성공 |
| 실패 진단 누락 가능성 | 로컬 compact가 서버 실패 영수증 전에 제외 후보를 제거할 수 있음 | v7 제외 후보의 실패 ACK를 영속화한 뒤 compact. 저장/Queue/ACK 오류와 본문 실패를 구분하여 표시 |
| 같은 탭의 worker 복원 | 이전 POST 후보를 닫으면서 새 미완료 후보의 탭 연결까지 삭제할 수 있음 | 현재 매핑이 해당 후보 ID인 경우에만 삭제. 이전 POST + 새 후보 복원 회귀 테스트 성공 |
| 티스토리·일반 문서 추출 | PR #122의 알려진 root만으로 모든 스킨/빈 semantic wrapper를 처리하지 못함 | `.article-view`, `.area_view`, `#article-view` 추가. 빈 일반 wrapper는 인접 문단 fallback 허용; 알려진 빈 article body는 렌더링 대기. 메뉴/광고/댓글/폼 제외와 유효 본문 최소50자 유지 |
| 잘못된 재수집 대상 | 기존 UI의 `key={index}`, 같은 이름 버튼, reason만 있는 요청은 대상 확인·중복 방어가 부족함. 단, 이것이 과거 두 요청의 직접 원인이라는 증거는 없음 | 안정적인 attempt key, 명시적인 대상 dialog, attempt/session/assignment tuple, 중복 클릭 방어, stale 응답 차단. BE 소유자 잠금·상태 재검증·완료 재수집 별도 확인·멱등 audit. MySQL 및 실제006 재수집에서003 보존 성공 |

### 과거 #123의 미확정 부분

관련 과거 작업 기록의 좁은 범위를 추가 확인했다. 2026-11-14 03:31Z 기록에서 선택된 AX 항목805는 `PLAN-006` **배정 선택 옵션**이었다. 당시 재수집 버튼은 별도 항목이었다. 따라서 그 한 번의 옵션 선택을 재수집 API 요청으로 단정할 수 없다. 실제 두 `USER_REQUEST` 요청이 생성된 시점의 브라우저 이벤트/Network 기록은 확보하지 못했다. React key가 원인이라고 확정하거나 사용자 오조작으로 돌리지 않았다. 새로운 방어는 자동·MySQL·실제 UI 검증을 통과했지만, 과거 요청 발생 원인과 운영 상태 복원은 미완료다.

## 3. 실제 데이터 경로와 상태 경계

| 단계 | 구현/검증 경계 |
|---|---|
| 1 인증 | Credential로 서버 access 확인. 만료/소유자 불일치는 관찰·전송 정지, 로컬 보존 |
| 2 정책·동의 | policyVersion/buildId/전체 SHA-256 일치, 현재 직접 동의·만료·기관 개시 조건 확인. v6 동의를 v7로 승계하지 않음 |
| 3 배정 | 인증된 소유자의 확정 Goal/배정만 선택 |
| 4 Session/Attempt | 기존 생성·멱등 요청 경로 유지. 같은 로컬 ACTIVE session은 서버 상태 재확인 후 resume |
| 5 Extension | manifest 권한 범위 내, 승인된 policy/build에서만 수집 활성화 |
| 6 방문 | `browser.ts` Chrome 활성 탭/창·문서 identity 확인. webNavigation/SPA 탐색 및 content pulse |
| 7 URL/검색/본문 | HMAC URL 식별자, Google q/Naver query, organic 카드, 본문 root/fallback. 폼 값을 읽지 않음 |
| 8 콘텐츠 보호 | v7 공개 PII/민감 의미는 허용. Credential 형식/비공개·인증·결제·내부망 경계는 유지. 개별 페이지 거절은 세션 격리로 확장하지 않음 |
| 9 체류 | foreground·visibility·focus 및1500ms 이내 같은 epoch 관찰만 더함. 비활성 시간 제외 |
| 10 후보 | tab/document/target에 연결. v7 미완료 동일 문서는 복귀 합산, 다른 문서와 섞지 않음 |
| 11 유효 Visit | 실제 활성5000ms 이상 + 형식에 맞는 제목/본문/검색 결과. 조건을 강제 통과시키지 않음 |
| 12 로컬 | `V2Repository` IndexedDB 영속화. 저장 실패는 안전 중지, Extension 삭제 안내 금지 |
| 13 Queue | POST/PATCH/end checkpoint를 영속화하고 재시작 시 복구 |
| 14 전송 | 기존 VisitDelivery/BehaviorDelivery의 순서·idempotency 및 인증 검증 유지 |
| 15 ACK | ID/sequence/버전 확인 후 수신 상태 반영. 실패 영수증도 서버 ACK 후 정리 |
| 16 MySQL | `PageVisitService` 소유자/현재 동의/세션/DTO/opaque URL·중복 무결성 검증 후 transaction 저장 |
| 17 집계 | localVisits / validVisits(ACK) / pending / 후보·제외 / 서버 rawStatus를 구분. AI 미실행을 RAW 실패로 표시하지 않음 |
| 18 종료 | ACTIVE → END_PENDING: POST/PATCH drain 및 종료 ACK 후 ENDED. network/auth 오류는 기존 데이터 보존 |
| 19 RAW 완료 | ENDED/CLEAR, 현재 허용된 동의 이력, 유효 Visit≥10, 중복 없는 증가 sequence, delivery count/through 일치, 명시적 실패/재수집 제외. RAW_ONLY AI NOT_RUN 허용 |
| 20 복구·재수집 | retry/resume은 동일 세션·Queue. 종료된 부족 Attempt의 재수집은 대상 tuple 및 현재 상태를 재검증하고 과거 Visit/audit 보존 |

HELD(소유자 연결 확인), STOPPING/END_PENDING, 인증·동의 중단, 네트워크 실패, 격리/철회는 서로 다른 경로다. v7는 철회·Tombstone을 제거하지 않는다. 특정 본문 추출 실패, 입력 포커스 및 Credential 형식 페이지 제외는 전체 세션 종료 사유가 아니다.

## 4. 정책·동의와 호환성

| 항목 | v6 | v7 |
|---|---|---|
| 버전/build | 6 / focus-page-content-v6 | 7 / focus-page-content-v7 |
| 공개 텍스트 검사 | 의미/PII 차단 및 연락처 마스킹 | CONSENTED_RAW, 연락처·민감 표현을 검사/마스킹하지 않음 |
| 활성 구간 합산 | 짧은 복귀 경계로 미완료 후보 종료 | 같은 문서 미완료 후보는 복귀 후 활성 구간 합산 |
| 인증·동의·권한·철회·Credential/폼 보호 | 유지 | 유지 |
| 기존 동의의 새 범위 적용 | 불가 | 사용자 직접 새 동의 필수 |

v7 SHA-256: `4c5fe813d703a3ae1d6bf95f3de3aca8ae12c94a5c4a8ca4a161ad29d6dd11f9`.
기존 v6 원문을 `TEAM_POLICY.v6.json`로 보존했으며 SHA-256은 `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982`다. v7 notBefore는 `2026-11-15T01:30:00Z`다.

FE 빌드와 BE는 v7/RAW_ONLY/CONSENTED_RAW/pageContent/maskContacts=false 조합을 검증한다. 기존 v6 경로의 필터를 전역 해제하지 않았다. 정상 v5/v6 세션의 읽기 권한은 과거 유효 동의와 정확한 정책 hash, 새 v7 직접 동의를 모두 확인하는 명시적 호환 경로를 사용한다. 과거 consent/scope/Visit을 수정하지 않는다. 철회·격리·Tombstone은 여전히 제외된다. custom 정책 pin을 자동 덮어쓰지 않는다.

현재 동의 UI의 정책 원문 항목과 패키지 범위 설명이 새 범위를 보여 준다. 검증 중 사용자가 동의 화면을 찾는 데 도움을 요청하여 해당 화면을 열어 안내했고, **사용자가 직접 체크하고 저장한 뒤** 서버 동의를 확인했다. 자동 동의 호출이나 동의 우회는 사용하지 않았다.

## 5. 자동화 검증

| 검증 | 최종 결과 | 명령/조건 |
|---|---|---|
| FE unit/integration | 1087 성공, 기본 opt-in HTTP2개 skip | `npm test --prefix fe` |
| opt-in HTTP | 2개 별도 성공 | 아래 BE 전체 회귀가 `v2-auth-http.test.ts`, `v2-retraction-http.test.ts` 실행 |
| TypeScript | 성공 | `npm run typecheck --prefix fe` |
| 실제 Extension build | 성공 | `VITE_API_BASE_URL=https://localhost:19425 COLLECTION_SITE_POLICY_FILE=/private/tmp/focus124-evidence/live-C-final/site-policy.json npm run build:real --prefix fe` |
| 패키징/manifest | 성공 | `cd fe && npm run package:collection -- real`; 기존 storage/alarms/webNavigation/tabs 권한 및 HTTP/HTTPS 범위 유지, all_frames=false |
| BE 전체 | 62 classes /1197 성공 /실패0 /오류0 /skip0 | 독립 MySQL + 실제 HTTP/Chrome + mock AI/retraction, 아래 명령 |
| AI 회귀 | 289 성공, TestClient deprecation warning1 | 독립 Python venv `python -m pytest ai/tests -q`; 모델 다운로드/로딩 없음 |
| 로컬 운영 도구 | 42 성공 | `python3 -m unittest discover -s tools/individual-local -p 'test_*.py'` |
| diff | 성공 | `git diff --check` |

BE 전체 명령(인증정보는0600 fixture 파일로만 전달):

```sh
JAVA_HOME=$(/usr/libexec/java_home -v 21) python3 tools/individual-local/run-regression.py \
  --mysql-fixture /private/tmp/focus124-evidence/full-fixture/fixture.json \
  --output /private/tmp/focus124-evidence/full-regression-final \
  --ai-python /private/tmp/focus124-evidence/python/bin/python \
  --chrome '/Users/hyeon/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
```

API/요청 검증, POST/PATCH 중복 방지·버전·END ACK, 상태 전이, 재수집 tuple/완료 보호/한 audit, v6 동의 보존·새 동의 필요·철회, 공개 문서/iframe/동적 추출, 3초+30초+3초 미완료 Visit 단위 회귀를 포함한다.

실패를 성공으로 집계하지 않았다. 초기 BE 전체 실행에서 synthetic AI 화면의 주 상태까지 RAW로 바뀌어 Chrome 계약2개가 실패했다. RAW 기본 표시는 local RAW_ONLY에 한정하도록 수정한 뒤 전체1197개를 다시 통과했다. 기존 FE permission feedback timer 테스트가 한 번 실패했으며 해당 구현을 바꾸지 않고 독립 재실행 및 최종 전체 실행에서 통과했다. 초기 v7 초안의 notBefore가 v6와 같아 업그레이드 검증이 거절되었고, 직접 동의 전에 새 시각/hash로 바로잡았다. 최종 로그와 실패 로그를 모두 별도 보존했다.

## 6. 실제 Chrome → Backend → MySQL 결과

| 항목 | 실제 결과 |
|---|---|
| 검증 환경 | macOS, 별도 Chrome for Testing151.0.7922.34 프로필, 별도 test C, HTTPS19425/MySQL33425 |
| Extension | 0.4.0 / `gnjlmifgccbnljfjifakofcpdfokmllm` / v7 hash 일치 |
| 시작 상태 | 신규 프로필·새 DB, 기존 세션/Visit/Queue 없음. 직접 동의 후 검증 시작 |
| Google 검색 | 성공: 실제 입력/결과 표시/q 추출/organic 카드 본문/결과 클릭 및 landing host 확인 |
| 네이버 검색 | 성공: 실제 입력/결과 표시/query 추출/organic 카드 본문/결과 클릭 확인 |
| 티스토리 | 성공: goddaehee와 notice의 다른 스킨 및 게시글 본문 |
| 네이버 블로그 | 성공: 실제 same-origin mainFrame 본문 |
| 기타 공개 사이트 | 성공: WordPress, Blogger, semantic root 없는 공개 문서 |
| 1 Visit | local1 /ACK1 /MySQL1 /pending0 |
| 5 Visits | local5 /ACK5 /MySQL5 /pending0 |
| 10 Visits | local10 /ACK10 /MySQL10 /pending0 |
| 앱/탭 복귀 | 성공; 동일 미완료 ID, 비활성 시간 미포함 |
| 인증·네트워크·worker·Chrome 복구 | 성공; 동일 미전송 ID 복구 후1회 저장 |
| 최종 Session/Privacy | ENDED /CLEAR, END acked |
| 최종 RAW/AI | RAW_COLLECTED /NOT_RUN, deliveryConfirmed=true |
| 데이터 직접 대조 | IndexedDB archive/receipt와 MySQL의10개 ID·sequence·activeDuration·tabSwitch·behaviorVersion 일치, 중복0, 최소 활성5470ms |

최종 동일 PLAN-006 흐름의 방문 순서:

1. `https://goddaehee.tistory.com/199`
2. Google 검색 `site:martinfowler.com microservices`
3. Google organic 결과 `https://martinfowler.com/articles/microservices.html`
4. 네이버 검색 `site:notice.tistory.com 티스토리 공지`
5. 네이버 organic 결과 `https://notice.tistory.com/` (실제 landing 기준)
6. `https://blog.naver.com/insaweb/221650456057`
7. `https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/` (WordPress)
8. `https://blog.python.org/` (Blogger)
9. `https://paulgraham.com/avg.html` (일반 공개 문서)
10. `https://notice.tistory.com/2706`

정책상 실제 유기적 결과 카드 본문과 검색어가 추출되고 활성5초를 충족한 검색 결과 페이지는 Visit 대상이다. 검색어가 있다는 사실만으로 Visit을 만들지 않았다. Google과 네이버를 각각 확인했으며 결과 페이지와 결과 클릭 후 문서를 별도 Visit으로 검증했다.

초기 Google 사전 확인에서 너무 이른 결과 점검/접근 제한 화면으로 실패했다. 실제 UI 검색에서 결과가 표시되는 것을 확인하고 실제 카드 렌더링 대기를 적용했다. 현재 Google의 `/goto` redirect는 클릭 후 실제 landing host로 확인했다. 성공하지 않은 사전 점검은 성공으로 포함하지 않았다. 네이버 첫 수동 입력에서 한글 입력이 일부 빠진 시도도 보존하고 최종 흐름에서 정확한 query를 다시 검증했다.

Playwright가 기본적으로 focus emulation을 켠다는 사실을 중간 검증에서 발견했다. 그 이전 실행을 실제 포커스 복귀의 증거로 사용하지 않았다. **최종 실행은 새 문서 탐색 후마다 `Emulation.setFocusEmulationEnabled(false)`를 적용**하고 실제 Chrome 전면 탭/창으로 방문했다. 시계 변경, 가짜 focus=true, 강제 dwell, 수집 API로 Visit 직접 삽입을 사용하지 않았다.

## 7. 장애·격리 문서·재수집 재검증

| 시나리오 | 실제 결과 |
|---|---|
| 탭 전환30초 | 활성3991ms → 비활성30000ms → 같은 ID 활성5090ms. 비활성 시간 미합산 |
| 실제 다른 앱 | Chrome 실제 창 최소화 후 Calculator 앱 활성화·복귀. 비활성125818ms 동안 후보 보존, 같은 ID 활성4001→5042ms |
| 네트워크 중단 | 실제 Visit POST1회 중단. local1/ACK0/MySQL0/pending>0를 보존. 복구 후 같은 ID ACK1/MySQL1, 중복 없음 |
| Service Worker 재시작 | 미전송 checkpoint/후보 유지, worker 세대 간 활성 시간 합산 없음 |
| 인증 만료 | 격리 테스트 계정의 실제 Credential TTL 만료로401 확인. Chrome 종료 후 공식 local.py Credential rotate, 재로그인 후 기존 동의/Session/Queue 복구 |
| Chrome 재시작 | 같은 독립 프로필·Extension ID에서 미전송 원본 ID 복구 후 전송 성공 |
| 본문 실패 | 초기 실제 추출 실패 기록은 보존되고 같은 세션에서 다음 실제 공개 페이지 수집 가능. Credential 문서 제외도 ACTIVE/CLEAR 유지 |
| 가상 PII | 별도 통제 문서의 가상 이메일·전화번호·민감 표현을 마스킹 없이 저장. 폼/textarea/password 값은 본문에 없음 |
| Credential 보호 | 가상 Credential 형식 본문은 페이지만 제외. 기존 Visit/세션 보존, 다음 실제 공개 문서는 정상 저장 |
| 재수집 대상 | 정상00310개 + 종료된 부족0061개. UI에서006만 확인하여 한 LOCAL_RECOLLECT audit 생성. 003은 RAW_COLLECTED 및10개 원문/ID/seq hash 불변 |

가상 PII/입력 보호/실제 앱 전환은 별도의 PLAN-009 통제 테스트다. 응답을 통제한 fixture 페이지를 실제 공개 웹10개로 보고하지 않았다. 통제1개+실제 공개문서1개로 종료하여 그 Attempt의 `RECOLLECT_REQUIRED`는 **의도한2 Visit 부족 판정**이다. 기존 두 정상 RAW 완료 배정에는 영향이 없었다.

최종 테스트 DB 물리 Visit은23개다: 기존00310 + 복구 검증용 부족0061 + 최종00610 + 별도0092. 이것을 한 세션의10개로 섞어 집계하지 않았다. 기존 정상10개를 삭제하거나 재수집할 필요는 없었고, 최종006은 대상 확인 후 의도적으로 새 Attempt를 생성한 것이다. 이 모든 test C 데이터는 **기술 검증용이며 사람 연구 표본으로 자동 사용하지 않는다**. 운영 원본 Export/통합을 수행하지 않았다.

## 8. 수정 파일

| 경로 | 변경 목적 |
|---|---|
| `docs/data-collection/TEAM_POLICY.json`, `.sha256`, `TEAM_POLICY.v6.json` | v7 범위·직접 동의·활성 합산, v6 원문 보존 |
| `docs/data-collection/page-content-collection.md` | 현재 v7와 역사적 v6 안내 구분 |
| `docs/contracts/collection-operations-api.md` | resume·v7·재수집 tuple 계약 |
| `fe/vite.real.config.ts`, `fe/real/policy.ts` | exact v7 RAW build/server 정책 일치 |
| `fe/real/content.ts`, `fe/real/url.ts` | raw 공개 텍스트, handshake 복구, URL/입력/Credential 경계 |
| `fe/src/content/extraction.ts`, `search.ts` | Tistory·공통 fallback·Google/Naver raw 검색 추출 |
| `fe/src/shared/privacy.ts`, `url.ts`, `messages.ts` | 의미 검사와 Credential 보호 분리, opaque/raw URL 호환 |
| `fe/src/v2/collector.ts`, `runtime.ts`, `state.ts` | 미완료 활성 합산, 세션 복구, 영속 실패 ACK |
| `fe/src/v2/browser.ts` | raw scope 전달·페이지 단위 제외·재수집 tuple·상태 표시 |
| `fe/participant/index.tsx`, `Attempts.tsx` | 이어서 수집/상태 구분/안정적인 대상 확인·중복/stale 방어 |
| `be/.../collection/CollectionSitePolicy.java`, `LocalCollectionPolicy.java`, `MetadataPage.java` | FE·BE raw 정책·Credential·데이터 무결성 일치 |
| `be/.../collection/CollectionDataAuthorization.java` | pinned 과거 동의의 명시적 읽기 호환, 철회 경계 유지 |
| `be/.../collection/LocalCollectionStatus.java` | 정확한 재수집 대상·완료 보호·소유자 잠금·멱등성 |
| `fe/tests/raw-v7.test.ts`, `attempts.test.tsx`, `v2-runtime.test.ts` | 정책/폼/검색/합산/복구/재수집 회귀 |
| `be/src/test/java/com/focusrecovery/domain/collection/CollectionConsentProgressTest.java`, `CollectionSitePolicyTest.java`, `MetadataPageTest.java`, `LocalRecollectTest.java`, `LocalRecollectMySqlTest.java` | v6/v7 동의·BE raw·MySQL 대상/중복/보존 회귀 |
| `tools/individual-local/local.py`, `test_local.py` | 공식 v6→v7 upgrade pin 허용, custom pin 보존 |
| `tools/individual-local/run-self-setup-validation.py`, `fe/scripts/quarantine-browser-test.mjs` | 새 tuple 요청 계약 반영 |
| `fe/scripts/issue124-live.mjs`, `issue124-recovery.mjs`, `issue124-app-fixture.mjs` | 격리 경로/포트로 제한한 opt-in 실제 검증 절차. 자동 동의 없음 |
| `docs/data-collection/raw-collection-v7-results.json`, 본 문서 | 민감 원문·Credential 없이 공개할 수 있는 검증 결과 |

## 9. 증거와 남은 조건

기계 판독 요약은 [raw-collection-v7-results.json](raw-collection-v7-results.json)이다. 로컬 상세 증거는 권한을 제한한 `/private/tmp/focus124-evidence`에 보존했다. `fe-final-release.log`, `full-regression-final.log`, `ai-tests.log`, `tools-release.log`, 최종 `live-C-final/recovery-result.json`, `app-fixture-result.json`, `final-idb-mysql.json`을 사용했다. 실패 로그도 남겼다. 실제 수집 당시 빌드는 기준 HEAD에 작업 트리 수정을 포함한 빌드였으며, 구현 커밋 후 최종 HEAD로 다시 빌드·패키징한다. 마지막 비로컬 AI 정보 표시 보존 수정 후 FE 전체 테스트도 다시 통과했다. 미사용19424/33424 초안 환경과33111 전체 회귀 fixture는 정지했고 볼륨은 보존했다. 최종19425/33425 환경은 종료된 검증 데이터 확인용으로 유지한다. 프로필·설정·원본/인증정보 파일은 Git에 넣지 않았다. 임시 디렉터리는 장기 보관 장소가 아니므로 필요하면 별도 승인된 암호화 보관 절차를 사용해야 한다.

- 미확정: 과거 #123의 두 요청 생성 원인. 과거 Network/event trace 또는 동등한 재현이 필요하다. 운영 완료 상태를 추측으로 복원하지 않았다.
- 미실행: 운영 C 배포/정책 전환/재동의. 사용자 승인 없이 수행하지 않았다.
- 범위 제한: macOS Chrome for Testing151 검증. 운영 Chrome157 및 Windows 설치/재시작은 별도 미실행이다.
- TLS: 기술 검증 Chrome은 해당 localhost 인증서의 scoped SPKI pin을 사용했다. OS trust 설치 경로를 이 결과로 성공 처리하지 않는다.
- 실제 웹 전체/모든 Tistory 스킨을 지원한다고 주장하지 않는다. 접근 불가·cross-origin 제한 iframe·유료/비공개 문서는 별도 진단/제외될 수 있다.

운영 전환이 승인되면 FE/BE/TEAM_POLICY를 함께 적용해야 한다. 먼저 운영 활성 세션을 기존 정책으로 안전하게 종료하고 pending=0을 확인한다. 승인된 암호화 백업과 복구 검증 후 기존 프로필/Extension 경로·ID/DB Volume을 보존한 채 공식 setup/build 절차를 사용하고, 사용자가 v7에 직접 동의해야 한다. DDL은 필요 없다. 배포 후 기존 완료 실적·Queue·동의 이력, 신규1→5→10/ACK/DB를 다시 대조한다. v7 데이터가 생긴 뒤 v6 코드를 단순 재설치하면 정책/읽기 권한이 맞지 않으므로 수집을 정지하고 호환되는 수정 릴리스로 복구하며, 전체 DB를 옛 백업으로 덮어쓰지 않는다. 과거 이력 재분류/복원은 대상별 별도 근거와 승인이 필요하다.

**판단:** 새 구현의 실제10 Visit 수집과 저장·복구 목표는 독립 환경에서 성공했다. 과거 #123의 정확한 요청 발생 원인까지 포함한 전체 Issue 종결은 아직 부분 완료로 남긴다.
