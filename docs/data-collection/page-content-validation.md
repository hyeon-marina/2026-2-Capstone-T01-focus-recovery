> 아래는 PR #111의 v5 검증 기록이다. Issue #112 실행 결과는 [v6 검증 기록](collection-stability-validation.md)을 참조한다.

# 페이지 원본 수집 구현·검증 보고

기준 공식 main: `1bfe57f6bdd74348166022da4b22c63d585bf95c` (PR #110 이후). 작업 브랜치: `feat/ai-training-page-content-collection`. 자동 Merge/main Push는 하지 않는다. Commit/공식 PR 링크는 최종 PR head와 작업 결과 응답에서 확인한다.

## 구현 결과

| 요구 | 결과 |
| --- | --- |
| METADATA_ONLY 원인 | local-policy를 metadataOnly로 고정하고 FE snapshot/BE MetadataPage가 고정 tuple만 허용했다. v5의 pageContent를 별도로 검증해 HMAC 식별 계약과 원문 수집을 함께 지원한다. 과거 경로는 호환용으로 유지한다. |
| 실제 제목 | document.title/og:title, 공백·제어문자 정리, Unicode500자. 빈 제목/Loading은 성공 처리하지 않는다. 제목 변경이 같은 문서에서 새 Visit을 만들지 않는다. |
| 실제 본문 | 기존 main/article/문서·블로그·기사 영역 추출기를 확장. 메뉴/광고/숨김/폼/입력/댓글을 제외하고 실제 주요 영역만 추출한다. 알 수 없는 DOM은 실패로 남긴다. |
| 5,000자 | FE 전개 배열, Java codePointCount, Python len. 제한 전 텍스트 안전성 검사. 실제 분량만 보존한다. |
| 검색어 | Google q/Naver query, 실제 결과 경로·단일 파라미터·Unicode500자·정규화 및 민감어 검사. 검색 결과는 허용된 유기적 제목·설명만 추출한다. |
| 개인정보 | URL/호스트/인증·결제·비공개/유료 DOM/활성 입력 선검사 + 제목/본문/검색어 텍스트 검사·의료/금융 등 민감 검색 의도 차단 + 기존 격리·철회·최신 privacy. 검수는 별도이며 정규식의 완전성을 주장하지 않는다. |
| API/DB | pageContent boolean과 원문 검증 추가. 기존 DTO 필드·MySQL TEXT/utf8mb4·Visit/Session 연결·행동 PATCH·END ACK 유지. 신규 DDL이 필요하지 않아 기존 Migration을 수정하지 않았다. 원문 없는 추출 실패 reason enum만 확장한다. |
| 정책 | 버전5, build `focus-page-content-v5`. SHA `2d54a38acb72f8e39d84313f1ba5d807ff39971cf53eff4ba6d615a6da669d67`. Plan SHA `73ae8c69e16559c95c15f1d4f37a4e2a835dc19367a280285306a64da41238cf`. |
| 이전 데이터 | 공식 v2/v3/v4 bytes 검증 후 갱신. 사용자 지정 pin 보존. DB/계정/실적/Participant/Credential을 삭제하지 않는다. 이전 동의는 v5에 자동 승계하지 않는다. 기존 metadata Import를 지원하되 학습 텍스트로 취급하지 않는다. |
| A/B/C | 독립 MySQL8.4·Spring HTTPS·실제 Chrome 확장·고유 가명 계정/프로필. 각10방문, 총30방문. A에서 실제 공식 v4 설치·자동 테스트 동의 후 v5 자동 갱신, 동일 Credential bytes와 재동의 차단 확인. |
| 실사이트 | docs.python.org, blog.python.org, news.ycombinator.com, books.toscrape.com, search.naver.com. 문서→블로그→공개 뉴스 목록→다른 주제→문서 복귀, SPA/뒤로가기, 탭전환, Worker/브라우저 재시작. |
| MySQL 실제 저장 | 브라우저 실제 제목 SHA와 Export한 DB 제목 SHA가 30/30 일치. 본문 길이는 슬롯별 `[1478,1604,3809,53,1478,5000,5000,5000,4986,236]`. Naver 실제 검색어 저장 확인. 모든 Visit SUCCESS·활성5초 이상, 순서·탭전환 유지. |
| RAW_ONLY | 각 RAW_COLLECTED / AI NOT_RUN, 원본 수집에서 모델 실행하지 않음. 자동 기술 테스트이며 실제 사람 동의/160 연구 세션 실적은 0이다. |
| age | 각 Export/Manifest/SHA/Source/Participant 확인, 통합3세션·30방문, 중복 Import3건 멱등. 원문은 메모리에서 암호화하며 평문 파일/본문 로그를 생성하지 않음. |
| 학습 검수 | focus-training-review/1, 3세션·30방문·24개3방문 구간. 모든 원본 Visit 필드 무손실 비교 PASS. 라벨 null/UNLABELLED, privacyReview REQUIRED. goal별 split; 실제20목표 기준 train16/validation3/test1 목표. 이번 동일GOAL-003 예시는 validation에만3행이며 임의로 분할을 채우지 않음. |
| 철회 | 새 원문 A 데이터에 실제 자동 테스트 철회202. 이후 Export 차단, 기존3세션 Import에서 A 제외하여2세션·20방문으로 재생성. 학습 검수도2세션·20방문·16구간, stale privacy 재Import 거절. 철회 전 테스트 산출물은 이용 중지 대상으로 보존한다. |

기존 AI의 legacy5방문 알고리즘·모델 학습·라벨 loader는 변경하지 않는다. 현재 v2의3방문/stride1을 검수 입력 구조로 연결하며 계획된 scenarioType을 정답으로 사용하지 않는다. 실제 학습과 수동 정답/개인정보 검수는 이번 자동 실행 범위에 포함하지 않는다.

## 실행 검증

- FE: `npm run typecheck --prefix fe`, `npm test --prefix fe`, `npm run build --prefix fe` 및 각 실제 정책 real Extension build PASS. Vitest 924 PASS, 별도 HTTP 연동2개는 일반 단위 실행에서 SKIP하고 Backend LiveHttp가 별도로 실행한다.
- AI: 격리 Python venv에서 `PYTHONPATH=ai python -m pytest ai/tests -q`: 249 PASS. 실제 모델 다운로드/학습 없음.
- Python: individual-local 38 PASS, collection 5 PASS.
- BE 전체: JDK21·실제 MySQL 조건부 테스트(85/89/93/95/97/101)·실제 FastAPI MOCK·Chrome/FE HTTP 연동 포함 test+bootJar: 1086 PASS, 0 SKIP, failures 0, errors 0.
- 기존 합성 MySQL/Chrome/age E2E: A/B/C 각10방문, 재시작·철회·ID 충돌/Plan 불일치·privacy replay 거절 PASS. 실제 연구 실적과 분리.
- 실제 외부 E2E: `run-external-site-e2e.py --automated-test-only --verify-v4-upgrade` PASS. 원문/키/토큰/DB는 Git에 포함하지 않는다. [비식별 요약](evidence/page-content-v5-summary.json).

초기 실험에서 JDK25를 선택한 실행, Docker 기본 주소풀 소진, 일반 Chrome의 확장 로드 제한, Google CAPTCHA로 인한 검색 방문 시간초과를 확인했다. JDK21/독립 명시 subnet/설치된 Chrome for Testing으로 검증 환경을 정정했고 Google 제한은 우회하지 않고 Naver로 실제 검색을 검증했다. Google parser는 단위 fixture 검증이며 **Google 실검색 E2E PASS로 표시하지 않는다**. 추가 MySQL 조건부 회귀 활성화 때 발견한 기존 테스트의 고정 비밀번호는 격리 fixture 환경변수로 수정했다.

뉴스 실사이트는 Hacker News의 공개 뉴스 목록이다. 실제 유료 뉴스·로그인·접근 제한 기사를 수집하거나 우회하지 않았다. Windows와 OS 인증서 신뢰 설치 자체는 NOT_TESTED다. HTTPS는 올바른 테스트 인증서 SPKI pin과 잘못된 pin의 거절로 검증했다. 실제160 사람 세션, 수동 라벨, 모델 학습, 장시간 부하/OS 강제종료를 수행했다고 주장하지 않는다.

## 팀원 실행·전달

진행 중인 이전 세션을 종료하고 END ACK를 확인한 다음 [v5 설치·재동의·수집·Export/Import·학습 검수 명령](page-content-collection.md)을 따른다. 추가 정책 작성/기관 판단/관리자 승인은 필요 없다. 새 정책을 읽고 참여자가 직접 동의해야 한다. 원본을 외부 공개하거나 이 테스트의 가명 계정을 실제 연구 계정으로 재사용하지 않는다.

## 수정 파일

- `README.md`
- `ai/README.md`
- `ai/tests/test_raw_review.py`
- `ai/training/raw_review.py`
- `be/README.md`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionPlanService.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionProgressService.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionSitePolicy.java`
- `be/src/main/java/com/focusrecovery/domain/collection/MetadataPage.java`
- `be/src/test/java/com/focusrecovery/domain/collection/PageContentTest.java`
- `be/src/test/java/com/focusrecovery/domain/identity/AuthConsentMySqlTest.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2RetractionMySqlTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V13MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V14MigrationTest.java`
- `docs/contracts/collection-operations-api.md`
- `docs/data-collection/TEAM_POLICY.json`
- `docs/data-collection/TEAM_POLICY.sha256`
- `docs/data-collection/collection-procedure.md`
- `docs/data-collection/evidence/page-content-v5-summary.json`
- `docs/data-collection/individual-local-setup.md`
- `docs/data-collection/merge-guide.md`
- `docs/data-collection/page-content-collection.md`
- `docs/data-collection/page-content-validation.md`
- `docs/data-collection/policy-application-guide.md`
- `docs/data-collection/public-web-navigation.md`
- `docs/data-collection/real-collection-policy.md`
- `fe/README.md`
- `fe/real/content.ts`
- `fe/real/policy.ts`
- `fe/real/url.ts`
- `fe/scripts/local-https-browser-test.mjs`
- `fe/src/content/extraction.ts`
- `fe/src/shared/messages.ts`
- `fe/src/shared/privacy.ts`
- `fe/src/v2/browser.ts`
- `fe/src/v2/collector.ts`
- `fe/src/v2/state.ts`
- `fe/tests/page-content.test.ts`
- `fe/vite.real.config.ts`
- `tools/individual-local/dataset.py`
- `tools/individual-local/local.py`
- `tools/individual-local/run-external-site-e2e.py`
- `tools/individual-local/run-regression.py`
- `tools/individual-local/test_dataset.py`
- `tools/individual-local/test_local.py`
