# Issue #105 검증 보고

실행일: 2026-11-11 KST. macOS27.2 arm64/JDK21/Node25.9/Python3.11/MySQL8.4/Chrome for Testing 임시 프로필에서 실행했다. **실제 참여자 수집은 BLOCKED, 실제 실적은 0이다.** 아래 PASS는 명시한 합성/읽기 전용 검증 범위에 한정한다. FAILED는 수정 전 실패, SKIPPED는 환경 조건으로 실행하지 않은 테스트, NOT_TESTED는 실제 실행하지 않은 경로, BLOCKED는 실제 증거/외부 조건 부재다.

## 1. 작업 전 Git 상태

cwd는 전용 `4d15` Worktree. HEAD `6e15dd3`의 detached 상태였고 수정·미추적 파일은 0개였다. 기존 다른 Worktree/DB/Volume/개인 Chrome 프로필을 사용하거나 삭제하지 않았다. `origin`은 hyeon-marina Fork, `upstream`은 SKHU-AI-Projects-Archive 공식 저장소다. AGENTS.md 검색 결과 저장소 내 규칙 파일이 없고 상위 ~/.codex/AGENTS.md는 빈 파일이었다. `.github/pull_request_template.md`를 적용한다.

## 2. 공식 main과 작업 브랜치

upstream/main을 실제 fetch해 `a096bfd1585c1c382f48ce9c3b66e9dc6c87dd34`를 확인하고 `feat/105/v2-real-collection-policy`를 생성했다. 공식 main 직접 Push, force Push, reset --hard, git clean, 다른 Worktree 수정, 기존 Migration 원문 수정, PR 자동 Merge는 하지 않는다.

## 3. Issue 및 선행 작업 분석

[Issue #105](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/105) 본문과 댓글(0개)을 직접 조회했다. #99/#101/#103과 PR #100/#102/#104 본문을 확인했다. main의 merge 이력도 #100→#102→#104와 일치했다. #99의 사이트/Build/Session scope·인증/동의/철회·real Adapter, #101의 RAW_COLLECTED/NOT_RUN·age/출처/통합/rollback, #103의 셀프 setup/owner/정책/슬롯·파일 로그인을 재사용한다.

## 4. 기존 차단 원인

`local-policy.draft.json`: schema focus-local-policy/1, RAW_ONLY, 정책/20목표 DRAFT, revision0, 빈 sites/근거/기간, institution UNRESOLVED. Java LocalCollectionPolicy는 CONFIRMED·실제 근거 참조·기간·확정 목표/revision/Checksum을 요구한다. CollectionSitePolicy는 정확한 HTTPS sites와 설치한 owner/Plan/Release/Build/Session digest를 요구한다. 본인 동의도 별도다. 이 차단을 삭제하거나 실제 증거를 만들어 통과시키지 않았다.

## 5. 정책 권고안

[정책](real-collection-policy.md): A/B/C 3명, 목표 유지·이탈·복귀 분석, 캡스톤 AI 학습/평가, 명시적 Session, 로컬 Spring/MySQL, RAW_ONLY, 최소 행동/주제 메타데이터, 원본 공개/외부 배포 금지, age 전달, 민감정보 제외, 본인 명시적 동의·즉시 중단/격리/전체 사본 처리. 보존 기본 제안은 최종 평가 종료일부터90일이다. 실제 기산일/삭제일/담당/연락·사본대장·기관 판단·개시 승인·동의는 미확정으로 남겼다.

## 6. 목표 20개 검토

[상세 검토안](confirmed-goals-proposal.md)에 원문·완료 기준·4시나리오 지시문을 그대로 보존하고 각 목표의 난이도 예상·관련 사이트/경로·10개 소주제·12~15 Visit 권장·개인정보 위험·실제 확인 절차를 기록했다. Python/Java로 기존 원문과 정책 Plan의 동일성을 검사했다. 실제 사람 수행 난이도와 목표별10개 의미 있는 공개 페이지 파일럿은 NOT_TESTED다. 특히 국내 분리배출·용기 재질·한글·도서관·교통·식물 교육의 정확한 공개 자료/경로 추가 확인이 필요하다. 보조 공개 백과 후보를 추가했고 목표 원문을 단순화하지 않았다. 팀 승인 상태는 DRAFT다.

## 7. 160세션 유지

PASS: 기존 assignments 전체와 동일한 PLAN-001~160/Goal/type/repetition/slot, 20×4×2, 목표당8/시나리오별2회, A54/B53/C53. 공통 slots의 participantId는 null, revision0과 원래 상세 목표를 유지한다. 실제 승인 후 revision>=1/목표 evidence를 반영하고 checksum을 새로 계산한다. 이후 실적 Plan 변경은 기존 잠금을 유지한다. 시나리오는 실제 관찰 결과/AI 정답으로 자동 변환하지 않는다.

## 8. 사이트별 검토

[사이트 표](site-collection-review.md)와 [읽기 전용 Chrome 증거](evidence/issue105-site-smoke.json). 20개 exact HTTPS origin/pathPrefix 후보, 최대30쌍 상한 유지. 최종 smoke는15개 통과·5개 보류(Smithsonian2/USGS/Maangchi403, 국립중앙도서관 prefix 대표 URL404). The Met는 실제 한국어 redirect `/ko/art`를 반영했고 DOE의 root redirect는 scope를 root로 넓히지 않고 후보 목록에서 제외했다. 초기 smoke에서는 과도한 일반 폼 차단/미검토 경로로13개가 막혔으며, 본문/값을 읽지 않는 메타데이터 모드의 별도 DOM 검사와 실제 redirect를 적용해 재검증했다. 403/404를 우회하지 않았다. 전부 실제 수집 허용은 DRAFT/BLOCKED다.

smoke는 대표 페이지 HTTP200/허용 범위/HTML/제목 존재/DOM 검사만 확인한다. history API 존재를 SPA 성공으로 간주하지 않는다. 사이트별10 Visit·Extension 실제 외부 탐색·권리/허가·로그인 상태별 전체 검증은 NOT_TESTED/BLOCKED다.

## 9. 블로그·일상 지원

Tistory의 정확한 `notice.tistory.com /`와 공개 D2 `/helloworld`는 읽기 전용 DOM smoke 통과. 요리 Maangchi `/recipe`는 이번 Chrome403으로 보류. 여행 블로그 경로 검사404, 개인 취미/제품 사용기·리뷰/현대 Naver Blog는 정확한 경로/권리/Chrome 확인 전 활성화하지 않는다. 모든 tistory/블로그 wildcard 허용은 없다. 공개 글의 원문·댓글·제3자 정보는 수집하지 않는다.

## 10. YouTube

공개 `/watch?v=11자ID`를 검증하고 HMAC 식별자로 전환하는 합성 단위 테스트 PASS. 영상/오디오/자막/댓글/계정/추천 원문을 읽지 않는다. playlist/shorts/embed/미검토 Query는 차단한다. 약관의 자동 접근 제한과 실제 허가 판단이 미완료여서 TEAM_POLICY sites에 미포함이다. 실제 YouTube Extension 수집은 NOT_TESTED/BLOCKED이며 지원 완료라고 표시하지 않는다.

## 11. Google/Naver

Google `https://www.google.com /search`, Naver `https://search.naver.com /search.naver`, Naver Blog `/PostView.naver` 공개 식별 Query의 합성 정규화 테스트 PASS. q/query/blogId/logNo 원문을 저장하지 않는다. 실제 서비스 추가 Query/모바일/다른 origin/현대 블로그 URL은 차단될 수 있다. 정책/검색결과 수집 제한·실제 허가 판단 전 sites에 미포함, 실제 외부 Extension 테스트 NOT_TESTED/BLOCKED다.

## 12. URL 정규화 구현과 SPA 수정

`fe/real/url.ts`는 exact origin/path 경계·민감 URL·userInfo·중복/미검토 Query·인코딩/상대 경로 우회를 검사한다. 허용 기능키만 정렬·HMAC하고 알려진 tracking/일반 앵커는 제거, hash SPA 라우트는 차단한다. 설치별 무작위 비밀키와 sessionId를 사용해 다른 페이지/세션/PC의 충돌·연결을 줄인다. 키는 trusted-context 로컬 저장소에 있고 Export하지 않는다. 비밀키 유출·가명 데이터의 재식별 위험은 남는다.

원문 URL은 transient 메시지/메모리에서 검증하며 IndexedDB/POST/DB/Export에는 `origin+prefix+/__focus_page__/64hex`만 저장한다. 서버는 HMAC 원문을 복원하거나 검증하지 않으며 신뢰된 Extension의 원래 웹페이지 진위를 재검증하지 못한다. 저장될 안전 형식·범위·Session/Build scope를 독립 검증한다.

수정 전 HTTPS Chrome 통합은 A의 SPA Visit2에서 FAILED(SENSITIVE_CONTENT 격리)했다. Chrome sender.url이 pushState 후 최초 문서 URL을 유지하는 조건에서 context 식별자가 달라졌다. context에 관찰 URL을 전달하고 현재 webNavigation frame/document ID와 일치하는지 재확인하도록 수정했다. 응답 대기 중 navigation도 버린다. 신규 A/B/C 환경에서 실제 SPA/재시작을 포함한 전체 HTTPS 수집·통합·철회 재검증 PASS다. 실패 환경의 DB/프로필은 보존했다.

## 13. 개인정보 보호 검증

PASS: 원제목/본문/검색어를 보내면 Backend 로컬 정책 거절, 이메일/전화/인증/계정/결제/의료·허용 밖 경로·HMAC 형태/Query/host 우회·중복키 차단. 고정 Topic vocabulary만 문서 밖으로 나가며 content는 METADATA_ONLY, 검색어는 [NOT_COLLECTED]다. Cookie/Token/폼 값/비디오/댓글/추천 원문을 읽지 않는다. 공개 페이지에 비활성 검색/설문/댓글 폼이 있어도 값/본문을 읽지 않으며 입력을 사용하거나 인증/결제 DOM이 있으면 차단한다. GitHub 공개 Pages 문서의 `survey-token` 필드만 정확한 origin/path에서 값 미열람 예외를 적용했다. 다른 Token 필드는 차단하고 unit/실제 smoke로 확인했다.

정규식/제목/DOM은 완전한 민감정보 검출기가 아니다. 페이지 주제/로그인 형태 변경·제3자 개인정보·미탐이 남아 실제 승인 공개 주제만 탐색해야 한다. Topic 오분류/OTHER와 원문 의미 정보 부족도 남는다. 메타데이터만으로 본문 기반 AI 학습이 충분하다고 보장하지 않는다. Dataset title/content를 실제 원문으로 해석하지 않는다.

## 14. 공통 JSON과 Java 검증

[TEAM_POLICY.json](TEAM_POLICY.json), [파일 SHA](TEAM_POLICY.sha256). 기본 정책 문장을 구체화하고20개 사이트 후보/기존Plan을 포함했다. 실제 teamDecisionRef/retentionRef/privacyEvidenceRef/startAuthorizationRef/기간은 빈 값, institution UNRESOLVED, Goal DRAFT, revision0이다. 빈 기존 양식도 보존했다. `local.py policy-validate`는 Spring/DB를 시작하지 않는 JavaExec로 실제 LocalCollectionPolicy/CollectionPlanService/CollectionSitePolicy를 재사용한다. DRAFT 명령은 배정/hash 검사 뒤 LOCAL_POLICY_DRAFT로 예상 차단했고 합성 CONFIRMED 파일은 별도로 검증했다. 검증기는 참조 문법을 검사하며 실제 증거 존재/권한을 보증하지 않는다.

## 15. Checksum

DRAFT Plan checksum: `c851b1457df44535abbdb12a690be4b2c0d00bed3ac74bf8b5931939d3dc25fa`.

최종 제안 파일 SHA-256: `e4dd3766553d266027fb040145c7354e5885c45e76cdf79677bae14b68f5f9a9`.

이는 확정 수집 정책 SHA가 아니다. 실제 근거/기간/CONFIRMED/revision을 반영하면 두 checksum을 다시 계산하고 파일 bytes/hash를3명이 동일하게 사용해야 한다. Java 보존 테스트가 기존 상세 목표/Plan/분포와 파일SHA를 비교한다.

## 16. A/B/C 적용 테스트

PASS(SYNTHETIC): 새 MySQL3개, 정확한 individual-local/HTTPS/OS-owner setup, 각자 참여자/Source UUID, 운영자0·owner1·Flyway18, 동일 policy SHA/Plan checksum, A54/B53/C53. 자기 슬롯만 접근, 잘못된 owner/슬롯/hash/만료/build 차단, 동일 setup 멱등/기존 데이터 보존, Credential 회전/기존 Token401, 본인 명시적 테스트 동의 전409, 정책 변경 후 재동의, 철회 후 수집 거절·조회용 재발급 유지. 실제 사람 동의는 생성하지 않았다.

## 17. 실제 Chrome 실행

PASS(SYNTHETIC HTTP): 별도 Chrome3/Backend3/MySQL3, 각10실측 Visit, 메타데이터로 Query 페이지10개 구분, IndexedDB/POST/END/ACK, Worker·브라우저·서버/DB 재시작, 네트워크 재전송, 타인404·철회/격리. 실제 개인 프로필은 사용하지 않았다.

PASS(SYNTHETIC HTTPS): A/B/C 각각10실측 Visit, 파일 로그인·현재 슬롯/정책/SHA 표시·SPA·Worker/브라우저 재시작·END ACK·RAW_COLLECTED/NOT_RUN, 동일정책/독립 UUID·Export/통합·철회/old privacy 거절. [축약 실행 증거](evidence/issue105-collection-summary.json)와 [실제 Chrome 캡처](images/team-guide/issue105-https-metadata-complete.png)를 기록했다. 캡처는 A의 합성 테스트/dirty 빌드이며 실제 승인/최종 clean 빌드 화면이 아니다. 이 경로는 실제 individual-local HTTPS/파일 로그인/SPA/원본 수집을 **합성 인증서의 정확한 SPKI pin**으로 시험한다. 잘못된 pin의 인증서 거절도 검사한다. 사용자 OS 키체인을 변경하지 않았고 OS 신뢰 설치 성공으로 표시하지 않는다. 라우팅된 `https://example.org/public` 문서는 모두 합성으로 실제 외부 수집이 아니다. 내부 source=PARTICIPANT인 운영 Profile fixture도 전부 SYNTHETIC TEST이며 실제 실적0이다.

## 18. AI 비의존 원본

원본 E2E에서 FastAPI/Qwen은 미실행, 각 세션 RAW_COLLECTED/AI NOT_RUN, 실제 생성 Window/분석0, 10 Visit당 이론상8을 확인했다. 300000ms PATCH는 별도 HTTPS API 합성 시험으로 확인했고 체류시간을 실제 Chrome 실측5분이라고 주장하지 않는다. 기존 QUALITY_PASSED/AI 완료 의미를 바꾸지 않았다. UI의 AI 포함 품질 미완료/RECOLLECT_REQUIRED와 원본 RAW_COLLECTED를 혼동하지 않는다. RAW_ONLY에서 원본 성공은 rawStatus/rawQuality/END ACK로 확인한다.

## 19. 암호화 Export/Import

PASS(SYNTHETIC): age 실제 암복호화, 3출처/3세션30 Visit/이론상24·생성0/AI0 PARTIAL. Manifest/파일별SHA/행 수/출처·참여자·계획·FK 검사, 중복Import3, ID충돌·Plan불일치·old privacy 거절, A철회 후2세션20 Visit/격리1. 전체160 합성 Fixture는 Python 테스트로 별도 검증하며 실제160세션 수집이라고 집계하지 않는다. 평문 Export를 기본값으로 추가하지 않았다. Windows 실제 암복호화/ACL/설치는 NOT_TESTED다.

## 20. FE/BE/AI/Python 회귀

| 검증 | 결과 |
| --- | --- |
| FE typecheck/최종 Vitest | PASS: 917, 환경2 SKIPPED |
| BE 전체 MySQL/Mock FastAPI/Chrome 연동 | 최종 PASS: 1030 중952 PASS·78 SKIPPED·failure/error0 (MySQL/Mock FastAPI/Chrome 포함) |
| 최종 정책/metadata/제안 파일 focused | PASS; 위 전체와 중복 합산하지 않음 |
| AI 기존 Mock/API | PASS: 244; 실제 Qwen NOT_TESTED |
| Python local/dataset | PASS: 32, age 실제 암복호화 포함 |
| Python 기존 collection | PASS: 5 |
| 공통 Schema/Fixture | PASS: 30defs/80cases/139scenarios/216rules/κ4 |
| Flyway | V1~V18 원문 동일; H2/새 MySQL migration 회귀 |
| local.py build/real 패키징 | PASS(SYNTHETIC 정책, dirty 소스); 실제 승인 배포물 아님 |
| 실제 Windows/Linux/OS 신뢰 설치 | NOT_TESTED |
| 실제 팀 동의·기관·외부 파일럿 | BLOCKED |

초기 FE 신규 validPost 테스트1건은 snapshot.identity를 POST에 포함한 잘못된 fixture로 FAILED한 뒤 wire 필드만 사용해 수정·최종 전체 PASS했다. HTTPS SPA 실패와 수정은12절에 기록했다. 초기/중간/최종 테스트 수를 서로 더하지 않는다. 보안/정책 보존 변경 뒤 전체 FE 및 Backend 연동을 다시 실행해 PASS를 확인했다. 마지막 Unicode 일반 앵커/식별자 인식·기존 real Adapter Query 경계 보존 보정은 FE 전체를 추가 재검증했다.

## 21. 문서 수정

신규: real-collection-policy / confirmed-goals-proposal / site-collection-review / policy-application-guide / 이 보고서, TEAM_POLICY JSON/SHA 및 실행 증거. 기존 individual-local-setup / participant-guide / collection-procedure / operator-guide / readiness-checklist / merge-guide와 collection-operations API의 로컬 메타데이터 의미를 갱신했다. age 공개키/개인키 역할과 팀원이 반복할 Export/privacy2명령, macOS/PowerShell 구분, NOT_TESTED·오류 복구·철회/사본 처리·실제 개시 조건을 연결했다.

## 22. 미완료 외부 확인

BLOCKED: 실제 A/B/C 의결/목표20개 검토, 보존 기산일/삭제일/담당자/연락·사본대장, 기관 적용 필요 여부 판단/실제 근거, 개시 승인, 개인별 명시적 동의, 사이트 약관/필요 허가·실제 공개 경로/10의미 Visit 파일럿. NOT_TESTED: Windows/Linux·각 PC OS 인증서 신뢰 설치/전체 수동 온보딩·실제 외부 Extension 수집·실제 Qwen. 외부 사본/백업/모델 영향의 전체 회수를 자동 보장하지 않는다.

## 23. 실제 개시 가능 여부와 남은 문제 분류

**현재 PR 병합만으로 바로 본 수집을 시작할 수는 없다.** 승인 조건을 갖춘 뒤 추가 관리자 계정/수동 DB Release 작업 없이 공통 파일 적용→재빌드→각자 동의→파일럿으로 진행하는 기술 경로를 제공한다.

- 코드/설정: 검증 범위에서 미해결 필수 코드 결함은 발견되지 않았다. 각 PC JDK21/Docker/Chrome/로컬 TLS 신뢰·동일 확정 JSON/hash·Extension 적용은 필요하다. Hash SPA·미검토 서비스/Query는 지원 범위 밖으로 차단한다. Windows/Linux는 실행 검증이 남아 있다.
- 실제 사용자/팀: 목표와 의미 있는 페이지 구성 검토·팀 의결·보존/삭제/연락/회수 대장·개인 동의·실제10 Visit 파일럿이 필요하다. Topic만 남기는 AI 활용 한계를 검토한다.
- 학교/기관·외부 사이트: 실제 기관 판단·허가 필요 여부/근거·사이트 권리 검토, 403/404 후보와 미포함 Google/Naver/YouTube/블로그/추가 교육 경로를 확인한다. 확인되지 않은 사이트는 사용하지 않고 검토된 후보만 확정 파일에 포함한다.

## 24. 재현 명령·Commit·PR

```sh
npm --prefix fe run typecheck
npm --prefix fe test
python3 -m unittest discover -s tools/individual-local -v
python3 -m unittest discover -s tools/collection -p 'test_*.py' -v
# 테스트 의존성을 격리 venv에 설치한 뒤:
.collection/venv105/bin/python -m pytest ai/tests -q
.collection/venv105/bin/python docs/contracts/v2/validate.py
python3 tools/individual-local/local.py policy-checksum --policy docs/data-collection/TEAM_POLICY.json
python3 tools/individual-local/local.py policy-validate --policy docs/data-collection/TEAM_POLICY.json
# 위 DRAFT 검증의 nonzero/LOCAL_POLICY_DRAFT는 예상 차단이다.
# JDK21 JAVA_HOME/PATH 선택 후 매번 NEW 출력 경로:
python3 tools/individual-local/run-self-setup-validation.py --output NEW_API_OUTPUT --synthetic-only
python3 tools/individual-local/run-synthetic-e2e.py --output NEW_HTTP_CHROME_OUTPUT --metadata-only --chrome CHROME_EXECUTABLE
python3 tools/individual-local/run-self-setup-validation.py --output NEW_HTTPS_CHROME_OUTPUT --synthetic-only --chrome CHROME_EXECUTABLE
python3 tools/individual-local/run-regression.py --mysql-fixture NEW_HTTP_CHROME_OUTPUT/A/fixture.json --output NEW_REGRESSION_OUTPUT --ai-python TEST_VENV_PYTHON --chrome CHROME_EXECUTABLE
```

재현용 테스트 스크립트는 신규 볼륨/파일만 생성하고 종료 시 이 실행의 프로세스/컨테이너만 중지하며 볼륨/DB/프로필을 보존한다. 합성 승인·동의·기관 값은 실제 정책/참여자 환경으로 복사하지 않는다. 실제 실행 출력은 `.collection/issue105-*`, 공개 가능한 축약본만 evidence에 기록했다. 구현 Commit과 최종 문서 기록은 별도 한국어 Commit으로 남긴다. 최종 SHA/Push/PR URL은 아래 실행 기록 및 PR 본문에서 확인한다.

### 최종 게시 기록

- 구현 Commit: `16501357e12e9d8a50689c5f7ce28223326bb8e2` (`feat: 실제 수집 메타데이터 정책과 안전한 URL 식별 환경 구축 (#105)`). 이 Commit의 clean tree에서 real 메타데이터 Extension/ZIP 재빌드 PASS, sourceCommit 일치·dirty=false·metadataOnly=true·제안 sites20·policyDigest 일치 확인.
- 로컬 DRAFT 제안 ZIP SHA-256: `511a9ea1a99b897ab8179489755ebe90ca0c554c2ff6ad2a80c07bc7e447cebe`. 실제 승인 배포물이 아니며 ZIP/원본 데이터/개인키/Credential은 Git에 넣지 않았다.
- 원본 목표/Plan/빈 정책 양식과 Flyway V1~V18 bytes 동일 PASS, docs19개 상대 링크/코드 fence·diff/Secret 혼입 검사 PASS.
- 개인 Fork `origin/feat/105/v2-real-collection-policy` 일반 Push 성공. 공식 main 직접 Push·force·자동 Merge 없음.
- [공식 main 대상 PR #106](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/106), 요청한 제목과 Repository 템플릿 적용. GitHub 연결 도구의 생성 권한403은 인증된 hyeon-marina 로컬 CLI로 처리했다.
- 이 최종 게시 기록만 별도 한국어 문서 Commit으로 추가한다. 최종 HEAD SHA는 PR의 Commit 목록과 최종 보고를 참조한다.
