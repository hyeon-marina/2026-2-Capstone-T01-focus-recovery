# 공개 블로그·본문 프레임 지원 검증 — Issue #121

기준 main: 70f9f9c4bd84b3cf7f8208a2ec9fff4b5dbfa236 (PR #120 병합).
현재 상태: 코드 수정·전체 회귀·독립 Chrome MV3 E2E 및 **실제 C Chrome157의 새10 Visit/END ACK/RAW_COLLECTED PASS**. 기존 PLAN-003 검토 상태의 예상 밖 변경은 원인 미확인으로 후속 #123에서 추적한다. 수집 경로 PASS와 이 미해결 사항을 구분한다.
작업 브랜치: `fix/121/public-document-support`. 실행 코드 기준 `bd10802ab563c3407b873f8be5d13d6874eb5b6b`; 이후 `594ceff6cf561d8a1649bab51ee597e2bbc22d11`은 외부 E2E 도메인 검증만 보완했다.

## 원인과 수정 범위

- 네이버 재현 URL의 바깥 문서는 본문0, 같은 출처 mainFrame 내부는 기존 .post-body에서 2,006자 추출됐다. 내부 선택자 부재라는 초기 가설은 기각했다. 실제 원인은 최상위 문서만 관찰하던 경계다.
- 일반 블로그의 비시맨틱 본문과 오래된 테이블/줄바꿈 글을 인식하지 못했다. 알려진 본문 루트와 일관된 문단 그룹/텍스트 밀도가 있는 국소 컨테이너를 지원한다. body 전체 fallback/메뉴·링크 목록 수집은 하지 않는다.
- 공개 뉴스레터의 수동 email autocomplete 필드가 전체 layout 제외를 유발했다. 입력값은 읽지 않고 모든 폼/입력을 제외하며, 포커스 시 관찰을 제외한다. 로그인/카드/주소/OTP·Token 등 보호는 유지한다.
- 티스토리의 익명 댓글 작성·닫힌 수정/삭제 password UI가 공개 본문까지 격리했다. 별도 읽을 수 있는 공개 본문이 있고, 알려진 댓글 범위의 정확한 비활성 컨트롤인 경우만 구분한다. 댓글 범위 전체를 본문에서 제외한다. 일반 password 마커, autocomplete 인증정보, 열린 수정창, 실제 password 포커스, 카드/Token 등은 계속 차단한다. 값은 읽지 않는다.
- 큰 wrapper를 본문보다 우선하거나 빈 로딩 본문을 주변 글로 대체할 수 있었다. 구체적인 본문 루트를 우선하면서 모든 기존 루트의 고위험 검사는 유지한다.
- iframe 교체 직전의 미확인 관찰 구간이 이전 문서 체류로 더해질 수 있었다. 마지막 확인 cursor까지만 종료한다. 4초 상태에서 실제 iframe 교체·내부 SPA 후 이전 Visit이 생성되지 않는 회귀를 추가했다.
- 지원 불가 프레임을 매 pulse마다 재결합하면 실패가 반복 저장될 수 있었다. 기존 excluded 후보는 유지하고, 아직 로딩 중인 프레임은 종료 실패 후보를 만들지 않는다. 실제 6.5초 반복 관찰에서 실패1건·정상10 Visit 보존을 확인했다.

## 변경 파일과 호환성

|영역|주요 파일|영향|
|---|---|---|
|문서 인식|`fe/src/content/extraction.ts`, 신규 `article-frame.ts`|블로그/레거시 본문, 폼·댓글 제외, 검증 가능한 본문 프레임 선택|
|연결/수명|`fe/real/content.ts`, `fe/src/v2/browser.ts`|별도 child grant, 전경·문서·URL 재검증, 교체/SPA/캐시 무효화, 확인된 체류만 인정|
|진단|`fe/src/v2/local-status.ts`|원문 없는 고정 프레임 실패/대기 안내|
|회귀|`page-content`, `article-frame`, `real-content-lifecycle`, `real-browser-foreground` 테스트|수정 전 실패, 입력값 getter 금지, 개인정보·늦은 응답·교체·제외 멱등성|
|독립 E2E|`raw-browser-test`, `local-https-browser-test`, `quarantine-browser-test`, `public-document-probe`, 공개10페이지 fixture 및 Python runner3개|실제 MV3/BE/MySQL, 실제 공개 페이지, 프레임 개인정보 및 복구 검증|

BE·AI 구현/공통 개인정보 regex는 변경하지 않았다. FE/BE/AI 공통 fixture 및 검수는 기존 회귀로 검증한다. 새 DB migration/IndexedDB format 변경/권한 추가/정책 변경은 없고 불변 Visit ID·sequence·POST/PATCH/END 멱등 계약을 유지한다.

## 문서·개인정보 경계

Manifest all_frames=false와 권한은 유지한다. Content Script의 소유자는 최상위 문서이며, 공개 본문이 없을 때만 화면에 보이는 주된 같은 출처 프레임 하나를 검토한다. Worker는 서버 인증/동의/정책·전경 탭·최상위 문서와 실제 Chrome child frameId/documentId/URL/parent/lifecycle을 검증해 별도 본문 grant를 준다. 추출 전후·비동기 검증 후 현재 문서를 재확인한다.

본문 프레임의 URL은 일시적으로만 사용하고 기존 세션 HMAC 설명으로 변환한다. 원문 URL/프레임 출처 객체는 Visit/진단/Export에 저장하지 않는다. 실제 본문 문서의 제목·텍스트를 사용하고 연락처 마스킹/고위험 검사·상위 문서의 개인정보/유료/접근 제한도 유지한다. 실제 자식 탐색은 후보를 무효화하고, 다른 광고 프레임의 탐색은 건드리지 않는다.

교차 출처·sandbox/srcdoc·중첩/여러 큰 프레임·준비되지 않은 문서는 우회하지 않는다. FRAME_UNAVAILABLE/UNSUPPORTED/AMBIGUOUS/POLICY_BLOCKED/SOURCE_STALE 고정 진단을 제공한다. 기존 BE failure code·IndexedDB format2·Visit ID/sequence·POST/PATCH/END/ACK·5초/4초/1.5초·본문50/5000 계약은 유지한다. 새로운 DB migration/정책 SHA/권한 확대는 없다.

## 사전 명시한 최종 검증 계획

1. FE 전체/TypeScript/공식 real build/package와 실제 대규모 DOM 관찰 예산을 확인한다. 기존 opt-in HTTP2건은 실제 BE 전체 회귀에서 별도 실행한다.
2. 최종 코드 고정 후 신규 프로필·합성 Participant/동의·별도 MySQL Volume **3회 × 10 Visit**: 같은 출처 프레임·프레임 내부 SPA·지연 DOM·일반/레거시 본문·수동 입력·비활성 광고·Worker/Chrome/네트워크·ACK 유실·멱등성·END/RAW·Export/Import/검수 계약. 실제 관찰 시간을 쓰며 시계를 늘리지 않는다.
3. 실제 공개 사이트 목록은 `fe/tests/fixtures/public-document-pages.json`에 고정한다. 네이버/티스토리/Blogger/WordPress/레거시 에세이/일반 기술 글 **신규3환경 × 10 실제 Visit**을 검증한다. 공개 페이지를 mock으로 대체하지 않고 자동 기술 검증 데이터를 사람 행동 데이터로 채택하지 않는다.
4. 별도 새 HTTPS 환경에서 프레임 안의 실제 합성 고위험 텍스트 → 0/N Visit 격리·공식 마감·재수집·이전 행/동의 보존을 확인한다. 운영 세션은 사용하지 않는다.
5. BE 전체/실제 MySQL·HTTP/회수 receiver·AI/데이터셋 검수를 실행한다. 최초 실패를 보존하고 최종 실행과 분리한다.

## 최종 독립 검증 결과

증거 디렉터리 `/private/tmp/focus121-evidence` (원문/Secret/실제 참여자 데이터는 Git에 포함하지 않음).
수정 전 iframe/layout7 FAIL, 바깥 paywall 우회1 FAIL, newsletter/legacy2 FAIL, 줄바꿈1 FAIL,
댓글 생성/수정 UI·반복 문서 스캔·본문 우선순위2 FAIL·프레임 체류1 FAIL·실패 중복/로딩2 FAIL을 각각 보존했다. 수정 중 `synthetic-documents-first`와 `synthetic-documents-final`도 PASS지만 최종 동일 실행 코드 증거와 구분한다. 최종 재시도만으로 최초 실패를 덮어쓰지 않았다.

|검증|실제 결과와 증거|
|---|---|
|FE 전체|`fe-full-dedup.log`: **1,065 PASS, 기존 opt-in HTTP2 SKIP**. skip을 성공으로 계산하지 않는다. 실제 HTTP2 사례는 BE 통합 실행 대상이다. TypeScript PASS.|
|공식 real build/package|`real-build-c-origin.log`, `real-package-c-origin.log`: PASS. 기존 C origin `https://localhost:9443`, 공식 v6 SHA 유지. Manifest는 기존 C와 동일하며 `all_frames=false`; 권한 storage/alarms/webNavigation/tabs 유지. 초기 일반 빌드의 다른 localhost origin 산출물은 배포 후보에서 제외한다.|
|BE 전체|최신 전체 재실행 `be-release.log`/`be-release-summary.json`: **60 classes/1,164 PASS, FAIL/ERROR/SKIP0**. 실제 MySQL 새 스키마·HTTP·Chrome·FastAPI MOCK 모델/별도 실제 privacy-only receiver를 구분한다.|
|AI/도구|`ai-full.log`: **289 PASS**, 경고1. `tools-release.log`: **42 PASS +4 subtests**. 개인정보·Window·순서/참조·라벨 분리·회수 제외·Export/Import 검증.|
|제어 페이지3×10|`synthetic-documents-release/validation.json`: **PASS 30 Visit**, 실제 CFT151 MV3 Content Script·Spring Boot·독립 MySQL3개·신규 프로필3개. iframe5개 이상/내부 SPA·실제4초 교체·지연 DOM·일반/레거시·입력 제외·광고·재방문·탭 이동. 시계 증가/가짜 Visit/본문 대체 없음.|
|실제 공개 사이트3×10|`external-public-release/summary.json`: **PASS 30 Visit**, 네이버 동일 재현 URL/티스토리2/Blogger/WordPress2/레거시2/기술 글2. mock 없음. 각 실행10개 MySQL 저장, 브라우저 제목 hash 일치, 본문50~5000 계약, extractionFailures0, 탭/Worker/Chrome 재시작·재인증. 모든 세션 ENDED/CLEAR·END ACK acked·pending0·RAW_COLLECTED·AI NOT_RUN·DB 실제 Window0.|
|프레임 개인정보·재수집|`frame-privacy-release.log`: **PASS**, 0/N Visit 고위험 합성 문자열 격리·공식 마감, paywall 제외 후 다른 정상 글 계속, 중복 재수집 요청 멱등, 부족 Attempt 보존 후 새 Session/Attempt. v5→v6 DB 행/원래10 Visit·Credential 보존; 이후 sessions5/attempts5/consents2/visits23/retractions2/tombstones2. 격리2 Visit 제외 Export21, 검수20 Visit/16개 검수 Window.|
|대규모 DOM|최종 MV3 각 환경 `large-dom-pulses.json`: 최대 **1107.9/1100.8/1100.4ms**, 모두 기존1500ms 이하. 별도 사전 50,030 DOM 요소 전체 추출316.7ms, 순회선형성 검증. 필요한 위험 검사는 생략하지 않는다.|
|장애·무결성|제어3환경 모두 POST/PATCH/END ACK 유실·오프라인 Queue·Worker/Chrome 재시작·재인증·동일 ID 재전송·서버/MySQL 재시작 PASS. 각10개 고유 Visit, sequence1~10, pending0/END acked. Import 중복3개 멱등, ID 충돌/plan 불일치/과거 privacy replay 거절, 철회 후 해당 합성 세션 제외20 Visit.|

실제 사이트 DOM 사전 점검10 ready는 Visit 성공의 대체 증거로 쓰지 않았다. 초기 Tistory/레거시 실패와 probe 작업 디렉터리 오류는 로그에 남겼다. 외부 E2E의 Export 도메인 assertion은 기존 표준 corpus만 기대하던 테스트 도구 오류를 실행 전 실제 고정 corpus와 일치하도록 확장했으며, 다른 시나리오의 기대값은 유지했다.

독립 환경의 모든 동의는 `AUTOMATED_TEST_ONLY` 기술 검증 소유자만 사용했다. 실제 C 동의를 대신 생성하지 않았고, 이 테스트 데이터를 실제 연구 참여자 데이터셋으로 사용하지 않는다. 전체 팀 계획160개 중3개만 검증한 합성 merge의 `PARTIAL`은 정상이며 전체 수집 완료를 뜻하지 않는다. 검수의24개 Window는 크기3/stride1의 학습 검수 결과로, RAW_ONLY 수집 DB의 실제 AI Window0과 다르다. v1 크기5 학습기/사람 라벨 생성/모델 학습은 변경·실행하지 않았다.

재현 명령(독립 디렉터리·포트·서브넷, JDK21/CFT151 및 Python 의존성 필요):

```sh
npm --prefix fe test
npm --prefix fe run typecheck
python3 tools/individual-local/run-synthetic-e2e.py --output <new-private-output> --chrome <CFT> --page-content --public-documents
python3 tools/individual-local/run-external-site-e2e.py --automated-test-only --public-articles --output <new-private-output> --chrome <CFT> --test-subnet-prefix <unused-prefix> --tls-port-base <unused-port>
python3 tools/individual-local/run-quarantine-upgrade-e2e.py --output <new-private-output> --chrome <CFT> --test-subnet <unused-subnet> --public-documents
python3 tools/individual-local/run-regression.py --mysql-fixture <retained-SYNTHETIC-101-fixture> --output <new-private-output> --ai-python <venv-python> --chrome <CFT>
```

독립 DB/Volume·실패 증거·암호화 번들은 보존했고 운영 로그/설정/원문/키는 Git에 포함하지 않았다.

## 운영 반영 경계와 남은 범위

현재 실제 C 세션은 사용자 탐색 중일 수 있다. 자동 종료/새 동의/재수집/Export/확장 교체/reload/Backend·MySQL 재시작을 하지 않는다. 최종 후보 검증 후 세션 종료·Queue drain·암호화 백업/복구·동일 확장 ID/경로/Profile/정책 확인과 별도 승인을 받은 FE만 반영한다. 운영 반영 전까지 실제 C에서 새 기능이 검증됐다고 표시하지 않는다.

읽기 전용 확인: C Git `ops/c-retraction-guard-20261114`/`8d590b3`, FE `21826627b7f0`, 기존 미추적 `team-data-collection-manual.pdf` 유지. 해당 C 커밋과 이번 코드의 BE·AI·정책 diff0이므로 BE/회수 서비스/MySQL 재시작은 반영 대상이 아니다.

운영 변경은 별도 승인 후 아래 순서로 진행해야 한다.

1. 사용자에게 진행 중 실제 세션을 직접 정상 종료하도록 안내한다. 로컬/서버 Visit·POST/PATCH/END ACK·pending0·privacy를 비교하고, pending/격리/저장 오류가 있으면 반영을 중단한다.
2. 현 FE8파일·설정/실행 버전과 현재 C DB를 새 비공개 디렉터리에 일관되고 암호화된 백업으로 보존한다. 독립 네트워크 없는 MySQL에서 복호화·참조/행 무결성을 검증한다. Chrome 프로필/IDB는 Chrome 정상 종료와 OS 접근 허용 경계 안에서만 일관된 백업/검증한다. 이전 프로필 백업만으로 현재 복구를 보장하지 않는다.
3. 기존 운영 브랜치를 유지한 별도 ops 브랜치에 검증된 FE tracked 변경만 반영한다. `/Users/hyeon/Project/2026-2-Capstone-T01-focus-recovery/fe/dist-real`의 `background.js`, `content.js`, `participant.js`, `build-info.json`, `manifest.json`, `checksums.json`, `participant/index.html`, 기존 `assets/participant-ckjKSp79.css`만 검증 후보로 반영한다. 동일 Default/로드 경로/ID `aocfmndihdfimoocmdafcbkgifbpdhbl` 유지. 정책 SHA `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982` 및 Manifest/권한 비교. 별도 새 프로필 설치나 재설치 금지.
4. 승인된 기존 확장 reload 후 사용자가 직접 재인증한다. 새 동의·세션·재수집은 별도 사용자 직접 조작이다. 기존 미전송 Queue/과거 Session/Attempt/Consent/회수 저널·Tombstone 보존을 재확인한다.
5. 승인된 실제 수집에서 네이버/일반 블로그를 포함해 1→5→10 Visit의 실제 활성 시간·ID/sequence·IDB·POST/PATCH ACK·MySQL을 비교하고 공식 END/RAW까지 확인한다. 운영 Export는 이 반영 승인에 포함하지 않는다.
6. 실패 시 새 수집/전송 상태를 먼저 확인한다. 검증한 이전 FE 파일만 복구할 수 있으며, DB/프로필/Queue/ACK를 과거 백업으로 자동 덮어쓰지 않는다. 현재 상태와 원인을 보존한 뒤 호환되는 코드 복구와 후속 변경 승인을 판단한다.

모든 웹사이트 수집을 보장하지 않는다. 유료·로그인·개인/민감 페이지, PDF/이미지 전용 글, 검증 불가 프레임은 정상 제외/진단 대상이다. 다른 OS·브라우저/외부 구조 변경과 공개 댓글 컴포넌트 변경은 별도 위험이다. 미확인 상태를 PASS로 쓰지 않는다.

## 승인 후 C 반영 기록 (2026-11-14 KST)

수집 실행 코드/공식 real 후보는 `63251de9f6633131295ee4e23c5bf885d5c534f6`으로 고정했다. 이후 이 문서만 수정하며 FE 코드를 재변경하지 않는다. 후보 Content Script SHA256은 독립 E2E와 같은 `bfc2243388ed26bbd1974e0aade9593427d0a7fce405ae87ec929828f2c97c84`다.

- 사용자는 암호화 백업·FE8파일 교체·동일 확장 reload만 승인했다. 실제 수집 시작/재수집/새 동의/운영 Export/PR 병합은 승인 범위에서 제외했다. 기존 세션은 이미 ENDED/POST·PATCH0/END acked였으며 사용자가 직접 Chrome을 정상 종료하고 이후 기존 Credential 파일로 재인증했다.
- 새 `ops/c-public-documents-20261114` 브랜치에서 검증 후보를 기존 `fe/dist-real`에 반영했다. 기존 운영 브랜치5개·미추적 PDF·설정/JAR/인증서·ID/로드 경로/Chrome157 Default를 보존했다. 실제 Chrome UI에서 동일 확장의 명시적 reload 완료와 `63251de9f663` 표시를 확인했다.
- 새 `.collection/rollout-backups/ISSUE121-public-documents-20261114`에 현재 DB 및 기존 운영 파일21개를 age 암호화했다. network=none/host port0/tmpfs MySQL에서 복구한 뒤 **37테이블의 모든 필드·행 및 외래키50개**를 비교했다. Chrome 재인증 후에도 다시 같은 반영 전 백업과 비교하여 PASS했다. 운영 Volume에는 복원하지 않았다.
- 현재 확장의 IndexedDB/Local Extension Settings만 파일14개를 암호화 백업했다. 인증 복호화·파일 범위/길이·LevelDB CURRENT/MANIFEST 참조2개 검증 PASS. 평문 파일을 쓰지 않았다. **백업본을 실제 Chrome에 논리 복원하는 시험은 NOT_TESTED**이며 기존 프로필을 덮어쓰지 않았다.
- 백업 도구의 기존 경로 보호 검사 중단 및 macOS 프로필 읽기 거절은 실패 로그로 보존했다. 기존 백업/사용자 파일은 변경하지 않았다. 사용자 Terminal의 Chrome 앱 데이터 개별 권한만 임시 사용한 뒤 OFF로 복원했다. 전체 디스크 접근은 사용하지 않았다.
- 재인증 후 UI의 기존 로컬5/서버5 Visit, ENDED, pending0, END acked 및 기존 정상·격리·부족 Attempt가 복원됨을 확인했다. 인증 전 표시0을 데이터 유실이나 새 수집 성공으로 해석하지 않았다. 기존 부족 Attempt를 성공 처리하지 않았다.
- BE/회수 서비스의 기존 PID·nonce 및 loopback, MySQL container/start/Volume 일치 PASS. 검증된 회수 target3개와 저널3행/revision3 일치 및 부모 실패 이력 보존 PASS. 기존 정상10 Visit RAW 세션/AI NOT_RUN/실제 Window0과 동의도 유지한다. 새 Session/Attempt/Consent/Export는 생성하지 않았다.

운영 증거는 비공개 `/private/tmp/focus121-evidence/rollout/`의 `fe-rollout.json`, `runtime-verification.json`, 프로필 검증 및 암호화 백업 디렉터리의 `post-apply-integrity.json`에 있다. 실제 C에서 새 블로그의 1→5→10 Visit/ACK/RAW 검증은 사용자의 새 수집 결정과 직접 시작 이후 수행해야 한다. 따라서 C의 신규 블로그 수집 성공 또는 Issue 전체 완료로 표시하지 않는다.

## 실제 C 새 세션 검증 (2026-11-14 KST)

이 절은 위 반영 시점의 NOT_TESTED를 갱신하는 후속 실측 결과다. 사용자가 실제 C 10 Visit 검증을 요청하고, 공식 재수집 사유 기록과 PLAN-006 새 세션 시작을 직접 수행했다. 기존 동의는 유효했으며 새 동의/자격정보/설정/배포는 생성·변경하지 않았다. 탐색·종료는 에이전트 보조로 수행한 **운영 기술 검증**이다. 이를 자연스러운 사람 행동, AI 정답 라벨 또는 합성 독립 테스트 세션으로 혼동하지 않는다. 학습 데이터 채택은 별도 검수 대상이다.

기존 Chrome157 Default·확장 ID/로드 경로·실행 코드63251de를 사용했다. 고정 공개10페이지 corpus와 같은 실제 글을 전경에서 관찰했고 Naver iframe 원문 제목 hash를 포함해 **저장된 제목 hash10개 모두 독립 실측 corpus와 일치**했다. 원문/입력값/URL/ID를 진단 결과로 Export하지 않고 개수·길이·시간·SHA 및 고정 진단만 기록했다.

|단계|UI 로컬 Visit|UI 서버 ACK|실제 MySQL|UI pending|세션/Privacy|결과|
|---|---:|---:|---:|---:|---|---|
|시작|0|0|0|0|ACTIVE/CLEAR|PASS|
|첫 Naver Visit|1|1|1|0|ACTIVE/CLEAR|PASS|
|5 Visit|5|5|5|0|ACTIVE/CLEAR|PASS|
|10 Visit|10|10|10|0|ACTIVE/CLEAR|PASS|
|공식 종료|10|10|10|0|ENDED/CLEAR·END acked|PASS|

- Naver1/Tistory2/WordPress2/Blogger1/레거시2/기술 글2. 각 실제 활성 체류5초 이상, 최종 저장값 최소26,751ms. Naver 본문1,884자. 본문/제목 길이 및 전처리 계약 유지. 직접 시계를 늘리거나 가짜 본문/Visit을 만들지 않았다.
- 서버 `deliveryConfirmed=true`, `RAW_COLLECTED`, `AI NOT_RUN`, 실제 AI Window0, 새 세션 격리·회수·Tombstone0. Visit ID 해시와 sequence1~10은 모든 중간 관측과 최종 DB에서 동일하며 중복/충돌0이다. UI END_PENDING/draining 이후 ENDED/acked 전이를 확인했다.
- **실패3건을 숨기지 않는다.** 8번째 글 주소 입력의 첫 문자 누락으로 Google 검색 화면이 열린 검증 조작 오류가 있었다. 초기에는 AX 요소 번호를 HTTP 상태로 잘못 판별했으며 그 게이트웨이 오류 설명을 철회했다. 새로고침 포함 잘못된 주소 관찰 중 고정 `EXTRACTION_RENDER_TIMEOUT`3건(동일 observedAt2건 포함)이 기록됐다. 모두 정확한 글 URL 진입 이전 시각임을 확인했고 삭제하지 않았다. 이들을 3개의 독립 페이지 실패로 간주하거나 정상 글 추출 결함으로 단정하지 않는다.
- 주소를 원자적으로 paste한 뒤 주소 입력값·실제 주소를 정확히 검증하도록 조작 절차를 보완했다. 정확한 실제 글에서 다음 Visit이 정상 생성됐고, 최종 RAW 판정은 실패 이력을 포함한 실제 서버 결과다. 오류 검색어/본문을 정상 Visit으로 대체하지 않았다.
- 보존 기준점은 37테이블 기존310행의 **SQL 서버 SHA256만** 기록했고 저장 전64hex를 강제 검증했다. 시작/종료 후 기존310행 전부 존재, 이전 Visit16개 동일, 새10개 추가 후 총26개다. Session/Consent/Source·Participant/Credential·격리/회수/Target/Tombstone의 기존 원본 필드는 일치한다. BE/회수 서비스 PID·nonce·loopback 및 MySQL container/start/Volume, VERIFIED3/저널3/revision3·부모 실패 이력도 유지한다.
- 기준점/감사 조회의 최초 두 스크립트는 자동 승인 검토에서 평문 메타데이터 가능성을 이유로 거절되어 실행되지 않았다. API 레코드 저장을 제거하고 모든 행을 SQL SHA256으로 제한·검증했으며, 감사 사유도 SQL CASE의 고정 whitelist와 숫자 시각만 출력하는 안전한 대안으로 검증했다. 원문/자격정보를 우회 출력하지 않았다.

### 별도 미해결 사항 #123

세션 시작 과정에 PLAN-006 이전5 Visit Attempt 외에 PLAN-003 이전 정상10 Visit Attempt도 USER_REQUEST로 바뀌었다. 서버에는 약8초 간격으로 해당 두 공식 LOCAL_RECOLLECT 감사 기록이 있지만 사용자는 PLAN-006만 눌렀다고 확인했다. 두 기존 Attempt의 review_status/reason_code만 변경됐고 다른 원본 필드는 동일하다. 정상003의 RAW 집계 제외를 강제 복원하거나 감사 이력을 삭제하지 않았다.

BE는 단일 UUID만 갱신하며 현재 소스에서 일괄 갱신은 확인되지 않았다. FE의 동일한 버튼 이름, RAW_ONLY에서도 AI 포함 재수집 상태가 먼저 보이는 점, 정상 RAW 행의 즉시 재수집 허용 UI는 개선 필요가 확인된다. 그러나 이번 두 요청의 UI 인과는 아직 재현하지 못했다. **원인 미확인 상태를 해결 완료/사용자 실수로 표시하지 않는다.** 후속 [Issue #123](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/123)에 조사·대상 확인 보호·회귀 범위를 분리했다. 운영 복구/추가 반영은 별도 승인 대상이다.

원문 없는 비공개 증거는 `/private/tmp/focus121-evidence/c-live-20261114/`의 `plan.json`, `metrics-*.json`, `collection-result.json`, `failure-timeline.json`, `preservation-result.json`, `service-identity.json`에 보존한다. 새 실제 C 데이터의 Export·Import/AI 학습 검수 및 Chrome 백업 논리 복원은 이번에도 NOT_TESTED/미실행이다. Issue #121은 자동 종료하거나 PR을 병합하지 않는다.
