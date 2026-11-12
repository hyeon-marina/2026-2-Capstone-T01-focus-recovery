# Issue #112 수집 안정화 검증

2026-11-12~13 KST. 공식 main과 최초 작업 트리 HEAD는 모두 `bb3cb46375fcc97be946d69b2b6a9a1f22b174f3`였고 최초 작업 트리는 깨끗했다. #112는 open, 댓글 0건이었다. #99·#101·#103과 PR #111의 기존 수집 경로를 기준으로 `fix/112/collection-stability`에서 검증했다. 이 보고서의 A/B/C는 한 Mac의 서로 다른 테스트 디렉터리·MySQL 볼륨·Source ID·소유자·브라우저 프로필이다. 실제 팀원 실적은 0이다.

## 원인과 회귀 검증

|장애|원인과 재현|수정 및 확인|
|---|---|---|
|공개 기사 연락처|extractMainContent가 모든 후보를 publicText로 검사했다. 사용하지 않는 후보의 가상 이메일 하나로도 SENSITIVE_CONTENT 예외가 발생했다. 새 FE 테스트가 수정 전 실패했다.|고위험 검사를 먼저 수행하고 선택한 본문, 제목, 허용 검색어, 결과 제목·설명을 메모리에서 마스킹하고 재검사한다. raw URL은 HMAC에만 사용한다. 모바일 형식 이외의 감지된 전화번호는 Visit 제외로 처리한다.|
|유료·접근 제한 페이지|real/content가 공개 페이지의 제외 신호를 일괄 sensitive로 표시해 browser가 세션을 격리했다.|접근 제한·구독 제한·지원하지 않는 문서는 원문이 없는 실패 관측으로 보낸다. 통제된 구독 제한 페이지 다음 정상 Visit이 저장됐다.|
|0/N Visit 격리|queueRetractions는 Visit ID별 요청만 만든다. 0건이면 서버에 신호가 없고, 일반 END는 격리 후 전송할 수 없었다. 0건 격리 후 신규 시작 회귀 테스트가 수정 전 실패했다.|인증된 소유자용 격리 확인·마감 경로를 추가했다. 서버가 세션을 잠그고 미처리 Visit에 기존 회수 서비스를 적용한다. 로컬은 접수되지 않은 요청을 보존하며 모든 접수와 서버 마감 ACK 뒤에만 이전 상태를 세션 키로 보관한다. 서버 회수 전파는 별도로 지속된다.|
|연속 세션과 재수집|local 전용 recollect API가 이미 있었지만 ENDED/CLEAR만 선택했다. 중복 호출은 감사 기록을 다시 썼다. 같은 탭에서 신규 세션을 시작할 때 브라우저의 포커스 캐시와 새 수집기의 foreground가 다를 수 있었다.|소유자·배정·동의·마감 상태를 확인하고 같은 사유의 재전송을 멱등 처리한다. 다음 start에서 새 Attempt/Session을 만든다. 브라우저가 새 수집기의 foreground를 대조하고 같은 탭의 캐시를 세션별 URL HMAC으로 구분하며, ACK가 유실된 시작 요청은 배정 키를 보존한다.|
|정책 갱신·과거 정상 데이터|동의 ID 동등성 검사와 Import의 APPROVED 상태 요구가 공식 정책 갱신 후 과거 데이터를 배제했다. setup의 활성 세션 검사도 같은 정책으로 재시작하는 경우를 차단했다.|공식 v5/v6 두 SHA 조합에 대해서만 서버가 과거 수집 당시 권한과 현재 동의를 결합해 최신 privacy 응답에 허가를 표시한다. 과거 동의 ID와 철회·Tombstone·revision 검사를 유지한다. 동일 정책 재시작을 허용한다.|
|Import와 학습 검수|가상 이메일이 담긴 정상 형식 Export를 Import했을 때 새 거절 테스트가 실패했다. 개인정보 텍스트 검사가 training-review에만 있었다.|Import와 독립 검수 변환기가 같은 검사를 사용한다. 파일 경로와 Python 직접 호출 양쪽에서 최신 privacy의 형식·시각·revision을 검사한다.|
|참가자 안내|pageContent 빌드에도 제목·본문·검색어를 저장하지 않는다는 메타데이터 안내가 표시됐다.|빌드 모드와 서버 정책 버전에 맞는 안내, 격리 마감 상태, 오류 원인과 재수집 조건을 표시한다.|

## 변경 파일과 역할

|영역|파일|변경 이유|
|---|---|---|
|FE 추출|fe/src/shared/privacy.ts, fe/src/content/extraction.ts, fe/src/content/search.ts|연락처 마스킹, 후보 전체 고위험 검사, 검색어·제목·스니펫 처리 및 길이 계약|
|FE 실제 수집|fe/real/content.ts, fe/real/url.ts, fe/vite.real.config.ts|수집 권한 확인 후 메모리 내 정제, HMAC과 검색어 구분, 제한 페이지 실패 코드, DOM 준비 시점에 수집 시작|
|FE 상태|fe/src/v2/runtime.ts, state.ts, repository.ts, browser.ts (모두 fe/src/v2)|격리 우선 전송과 마감 ACK, IndexedDB 원자적 보관, 세션 간 포커스·배정·전송 상태 분리|
|참가자|fe/participant/index.tsx|버전별 수집 설명, 마감·동의·인증·재수집 표시|
|FE 테스트|fe/tests/page-content.test.ts, search-extraction.test.ts, v2-runtime.test.ts (모두 fe/tests)|마스킹·고위험 우선순위·검색 HMAC·격리 및 늦은 ACK·재시작 검증|
|브라우저 검증|fe/scripts/local-https-browser-test.mjs, fe/scripts/quarantine-browser-test.mjs|실제 서로 다른 문서 방문, 확장 새로고침, 통제된 격리·재수집과 공개 기사 확인|
|BE 수집|CollectionPlanService.java, LocalCollectionStatus.java|소유자별 동시 활성 세션 방지, 종료된 격리 Attempt 재수집 및 감사 기록 멱등성|
|BE 배포·저장|LocalCollectionSetup.java, MetadataPage.java|동일 정책의 재시작, 개인정보 패턴의 저장 직전 검증|
|BE 개인정보|PrivacyRetractionController.java, PrivacyRetractionService.java|격리 요청 접수·마감, 소유권·V2 Gate·서버 Visit 회수|
|BE Export·테스트|CollectionExportService.java, CollectionRawTest.java|공식 정책별 과거 이용 권한, 소유권과 격리 마감 회귀|
|DB|DDL 변경 없음|기존 work_session 상태·privacy_revision, 회수·Tombstone 테이블과 Flyway 이력을 사용|
|Python|tools/individual-local/local.py, dataset.py, test_local.py, test_dataset.py|공식 v5 pin 자동 갱신, Import/검수 검증, 기존 커스텀 정책 보존 및 회귀|
|AI 검수|ai/training/raw_review.py, ai/tests/test_raw_review.py|독립 변환기에서도 민감 텍스트와 격리 세션 거절|
|통합 검증|tools/individual-local/run-quarantine-upgrade-e2e.py|새 테스트 Source에서 v5 백업·v6 갱신·기사·격리·재수집·암호화 통합 재현|
|정책|TEAM_POLICY.json, TEAM_POLICY.sha256|마스킹 및 v5 정상 세션의 후속 이용 범위, 새 버전·빌드·SHA. Plan revision 1 및 배정 체크섬 보존|
|운영 문서|page-content-collection.md, merge-guide.md, individual-local-setup.md|팀원별 실행·재동의·마감·재수집·암호화 및 privacy 확인|
|기존 가이드|collection-procedure.md, policy-application-guide.md, public-web-navigation.md, real-collection-policy.md, page-content-validation.md|현재 운영 절차와 v5 당시 검증 기록을 구분|
|참가자 운영 문서|README.md, participant-guide.md, readiness-checklist.md|실제 제목·본문·허용 검색어 수집 및 재동의 안내|
|검증 도구와 보고|run-external-site-e2e.py, collection-stability-validation.md|기존 프로세스와 충돌하지 않는 HTTPS 포트 선택, 결과와 미검증 범위 기록|

## 이번 실행 결과

macOS arm64, JDK 21, Docker MySQL 8.4, Chrome for Testing 151, Node 25, Python 3.11 환경이다. 아래 명령의 `$CHROMIUM_PATH`는 실제 테스트 브라우저 실행 파일, `$OUT`은 실행마다 새로 만든 전용 디렉터리다. Gradle 회귀에서만 기존 테스트용 mock AI 서버를 실행했다. 실제 수집과 검수 경로는 AI 실행 없이 통과했다.

|검증|실행 명령|실행 결과 및 증거 파일 (/private/tmp)|
|---|---|---|
|수정 전 재현|fe에서 `npx vitest run tests/page-content.test.ts`, `npx vitest run tests/v2-runtime.test.ts`의 대상 사례|공개 연락처와 0 Visit 격리 회귀가 수정 전 FAIL. focus112-mask-red.log, focus112-close-red.log|
|FE 타입·실제 번들·단위|fe에서 `npm run build:real && npm test`|PASS 932, 실패 0, 기본 실행에서 opt-in 2건 skip. focus112-accept-fe.log, focus112-final-vitest.log|
|참가자·잠금 배포·기존 브라우저|fe에서 `npm run test:participant:browser`, 빈 사이트 정책과 localhost:9443로 build:real 후 `npm run test:real:locked`, `npm run test:browser`|3개 스크립트 PASS. 최초 real:locked 실행은 다른 포트의 실제 수집 번들이어서 실패했고 잠금 번들을 다시 빌드해 통과했다. focus112-participant-locked.log, focus112-real-locked.log, focus112-generic-browser.log|
|BE·MySQL·Flyway·브라우저|레포 루트에서 `python3 tools/individual-local/run-regression.py --mysql-fixture /private/tmp/focus112-synthetic-b/B/fixture.json --output "$OUT" --ai-python /private/tmp/focus-content-ai-venv/bin/python --chrome "$CHROMIUM_PATH"`|내부 실행은 be에서 `./gradlew test --rerun-tasks --console=plain bootJar`. V2·실제 HTML·수집 브라우저를 Spring HTTP와 확인. 최종 XML 55개 클래스, PASS 1,087, 실패·오류·skipped 0. focus112-regression-release.log|
|Python 로컬 도구|루트에서 `python3 -m unittest discover -s tools/individual-local`|PASS 39, 실패 0. focus112-python-final.log|
|회수 도구|루트에서 `python3 -m unittest discover -s tools/collection`|PASS 5, 실패 0. focus112-collection-python.log|
|AI 및 학습 검수|ai에서 가상환경으로 `python -m pytest -q`|PASS 251, 실패 0, 의존성 deprecation 경고 1. focus112-verified-ai.log|
|통제된 A/B/C 합성 E2E|루트에서 `python3 tools/individual-local/run-synthetic-e2e.py --output "$OUT" --chrome "$CHROMIUM_PATH"`|PASS. 내부 test:raw:browser 포함. 3 Source, 30 Visit, 중복 3건, 철회 후 2세션 20 Visit. 예전 privacy·ID 충돌 거절. focus112-synthetic-b/validation.json|
|실제 기사 및 v5/v6 복구|루트에서 `python3 tools/individual-local/run-quarantine-upgrade-e2e.py --output "$OUT" --test-subnet 10.253.233.0/28 --chrome "$CHROMIUM_PATH"`|PASS. focus112-recovery-final.log. 기사와 9개 문서 실제 HTTPS. 격리·구독 제한·부족 재수집은 통제한 페이지|
|암호화 백업·철회 후 복구|루트에서 `python3 tools/individual-local/verify-restore.py --fixture /private/tmp/focus112-synthetic-b/A/fixture.json --output "$OUT" --recipient "$TEST_RECIPIENT"`|PASS. 별도 스키마에서 Visit 10, 격리 1, 전체 철회 1, 활성 Release 0, Export Audit 2. focus112-restore/validation.json|

## 실제 웹과 통제된 장애

- E2E-01·05. Korea Herald 기사 DOM에서 이메일 존재 여부를 확인하고 5초 이상 활성 Visit으로 수집했다. Export의 기사 본문에 `[EMAIL]`이 있고, 해당 세션은 9개 후속 Python 문서를 포함해 10 Visit, END ACK, RAW_COLLECTED를 달성했다.
- E2E-02·03·04. 통제된 구독 제한 페이지에서는 유효 Visit가 0이었다. 같은 세션에서 안전한 두 페이지를 수집한 뒤 가상 인증정보로 격리했다. 첫 Visit 전 격리한 별도 세션과 함께 안전 마감했고, 다른 배정 시작과 같은 배정 재수집이 가능했다.
- E2E-06. 격리된 Attempt에 같은 사유로 두 번 요청했다. 후속 Attempt를 1 Visit에서 마감해 전송 확인 및 RECOLLECT_REQUIRED를 확인한 뒤 다시 재수집해 10 Visit를 달성했다. 기존 Attempt와 Session 식별자는 보존됐다.
- E2E-07. v5 인증 파일과 테이블 건수가 업그레이드 직전·직후 동일했다. 재동의 전 서버 consentValid=false를 확인했다. 최종 Export에 기존 Visit의 각 행과 기존 Session/Attempt/Consent ID가 포함됐다. 격리 Visit 2건은 원본 Export에서 제외됐다. 부족 Attempt의 안전한 Visit 1건은 Export에 보존되고 완료 세션만 사용하는 training-review에서는 제외됐다.

## 검증 Source의 보존 비교

|테이블|v5 백업 시점|v6 설치 직후|재동의·격리·재수집·Export 후|
|---|---:|---:|---:|
|Session|1|1|5|
|Visit|10|10|23|
|Attempt|1|1|5|
|Consent|1|1|2|
|Privacy Retraction|0|0|2|
|Tombstone|0|0|2|
|Collection Failure|0|0|1|
|Export Audit|1|1|2|

v5 백업은 age로 암호화했다. 최종 혼합 Export는 Visit 21건, 실제 검수 결과는 2세션·20 Visit·16윈도다. 해당 신규 검증 Registry의 최종 읽기 전용 조회 결과는 Source 1, Export 1, records 30, denied 2, runs 1이다. 별도의 3 Source 테스트에서는 같은 Registry에 재Import했고 중복 3건을 확인했다. 운영 DB·IndexedDB·Registry는 열지 않았으며 실제 팀원 장비의 데이터 보존은 NOT_TESTED다.

## 남은 검증 범위

실제 세 팀원의 직접 동의와 장비별 OS 인증서 신뢰 설치, Windows 전체 설치, 실제 연구 실적 160세션, 이미 배포한 외부 사본의 물리적 회수는 NOT_TESTED다. 로컬 HTTPS 검증은 테스트 인증서의 공개키 지문을 고정했고 다른 지문은 거부되는지 확인했다. 모든 사이트의 DOM·연락처 형식, 실제 디스크 고갈 및 모든 DB 중단 타이밍까지 재현하지는 않았다. 자동화 결과는 연구 실적에 합산하지 않는다.

## 최종 공개 웹 A/B/C 실행

루트에서 python3 tools/individual-local/run-external-site-e2e.py --automated-test-only --test-subnet-prefix 10.253.237 --tls-port-base 19643 --output /private/tmp/focus112-abc-verified --chrome "$CHROMIUM_PATH" 명령이 PASS했다. 기본 포트 충돌 후 전용 포트와 브라우저 테스트 설정을 일치시켰다. setup 실패 때에도 해당 테스트 컨테이너를 정지하는 finally 처리를 보완했고 볼륨은 보존했다.

증거는 /private/tmp/focus112-abc-verified/summary.json 및 /private/tmp/focus112-abc-verified.log다. A/B/C 각각 실제 공개 HTTPS 페이지 10개, 총 30 Visit, RAW_COLLECTED 및 AI NOT_RUN, 중복 Import 3건, 암호화 검수 3세션·30 Visit·24윈도다. Manifest·SHA 및 Source/Participant/Attempt/Visit 참조를 검증했다. Python Docs·Python Blog·Hacker News·Books to Scrape·Naver 검색을 사용했다. A/B/C 모두 동일 Mac의 독립 테스트 Source이며 실제 세 팀원 PC 검증은 NOT_TESTED다.

최종 격리·재수집 실행은 /private/tmp/focus112-recovery-final.log다. 종료한 문서를 열린 채 두고 재수집해도 이전 세션의 캐시된 HMAC 스냅샷을 재사용하지 않는 경우를 포함한다. 기사 연락처 마스킹·0/N 격리·부족 Visit 재수집·v5/v6 혼합 Export 모두 PASS했다.

최종 BE 재실행은 /private/tmp/focus112-regression-release.log에서 BUILD SUCCESSFUL을 확인했다. XML 합계 1,087건, skipped·실패·오류 0건이다. 최종 FE는 /private/tmp/focus112-final-vitest.log에서 932건 PASS, opt-in 2건 skip이다. 공식 v6 정책과 기본 localhost:9443을 지정한 실제 Extension 빌드는 /private/tmp/focus112-official-build.log에 기록했다. 팀원은 본인의 local.py build로 자신의 포트·정책에 맞춰 빌드해야 한다.

## Issue 체크리스트 대조

|Issue 요구|이번 실행 상태|
|---|---|
|뉴스 연락처 마스킹·수집 제외 후 지속|PASS. 실제 기사 및 통제된 구독 제한|
|0/N Visit 격리 마감·다음 배정|PASS. 통제된 고위험 페이지와 실제 HTTPS 서버|
|동일 배정 재수집·Attempt 보존|PASS. 중복 요청과 부족 Visit 재수집 포함|
|실제 10 Visit 이상·POST/PATCH/END·완료 상태|PASS. A/B/C 각 10건|
|Chrome·Backend 재시작|PASS. 기존 브라우저 및 합성 E2E, 회귀|
|기존 데이터·회수 기록 보존|검증 DB에서 PASS, 운영 데이터 NOT_TESTED|
|A/B/C 암호화 통합·Manifest·SHA·참조·중복|독립 테스트 Source에서 PASS, 세 팀원 장비 NOT_TESTED|
|과거 정상 데이터·철회 재유입 차단|PASS. v5/v6 혼합과 철회 후 오래된 privacy 거절|
|FE·BE·AI·Python 회귀|위 명령과 로그의 실행 범위 PASS|

남은 실제 장비·직접 재동의·운영 데이터 확인을 포함한 Issue 전체의 현장 완료 여부는 확인되지 않았다.
