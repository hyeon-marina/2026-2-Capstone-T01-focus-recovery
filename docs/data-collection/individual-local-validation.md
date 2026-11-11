# Issue #101 개인 PC 원본 수집·3인 통합 검증 보고

2026-11-11 KST. **실제 참여자 수집 개시는 BLOCKED이며 실제 실적은0입니다.** 기술 구현·실행한 합성 검증·미실행/외부 조건을 구분합니다. 원본 전용 Chrome/Spring/MySQL 경로는 AI 없이 검증했습니다. Windows·실제 승인/참여자·Chrome OS 신뢰 설치·전체 개인정보 삭제 완료를 주장하지 않습니다.

## 1. 작업 전 Git 상태

- 작업트리: 현재 Codex worktree `3252/2026-2-Capstone-T01-focus-recovery`.
- `git status --short`: 출력 없음. 기존 수정/미추적 파일0.
- 현재 브랜치: detached HEAD, `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`.
- origin: `https://github.com/hyeon-marina/2026-2-Capstone-T01-focus-recovery.git`.
- upstream: `https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git`.
- 다른 main/Issue별 브랜치·worktree는 보존했습니다. reset --hard/git clean/force push/기존 볼륨 삭제/운영 DB 접근을 하지 않았습니다. 기존3397 테스트 DB도 재사용/변경하지 않았습니다.
- 저장소·상위 AGENTS.md를 확인했습니다. 상위 파일은 빈 파일이었고 추가 저장소 규칙은 없었습니다. `.github/pull_request_template.md`를 사용합니다.

## 2. 공식 main과 선행 변경 확인

작업 시작 때 `git ls-remote upstream refs/heads/main`과 fetch로 확인한 공식 main은 **`7839c7bbb5c95283cb6783a55b158edf530e4fbc`**입니다. 여기서 `feat/101/v2-individual-local-collection`을 새로 만들었습니다. 공식 main에 직접 Commit/Push하지 않습니다.

GitHub API로 [Issue #101](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/101) 본문/댓글(댓글0), 선행 #79/#81/#83/#85/#87/#89/#91/#93/#95/#97/#99를 읽었습니다. [PR #100](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/100)의 실제82파일 변경과 병합 Commit을 확인했습니다. main에 병합된 #99의 정책/독립 Release/빌드·세션 경계를 기준으로 확장했습니다.

요청한 공통 수집·분석 계약, 결정/승인 대장, v2 Schema/Fixture, 인증·운영 API, plan/목표 후보, 기존7개 수집/검증/운영 문서와 FE/BE/AI/DB 코드를 확인했습니다. P1~P6 PROPOSED/P2·P6 BLOCKED를 승인으로 바꾸지 않았습니다.

## 3. 요구사항 분석과 구현 범위

| 영역 | 구현/판정 |
| --- | --- |
| 개인 PC 실행 | 신규 loopback MySQL Compose·persistent volume·individual-local HTTPS Profile·Python 실행 도구 |
| 원본 수집 | 기존 v2 POST/PATCH/END/ACK 경로, 별도 RAW_COLLECTED·원본 진행률, AI 미실행과 분석 완료 분리 |
| Chrome | 기존 real Adapter/Collector/IndexedDB/Queue·인증/동의/철회 재사용, 로컬 HTTPS 빌드·ZIP·추가 원본 상태 표시 |
| 계획 | 기존 DRAFT20·160배정/A54B53C53 유지, 분포 훼손 저장 거절·실행 이력 잠금 보존 |
| Export | 본인/운영자 권한·일관성 snapshot·안전 필드·V17 source/audit·JSONL/Manifest/해시·age |
| Import | 독립 파일·발신자 해시·최신 privacy·Schema/계획/소유권/ID/FK·멱등·원자 게시·부분/전체 판정 |
| 개인정보 | 최신 철회/격리/동의 제외·단조 금지 레지스트리·오래된 상태 재유입 차단, 외부 사본 전체 회수는 별도 BLOCKED |
| 매뉴얼 | macOS/Windows 설치·27단계 팀원 실습·관리자 통합·9개 실제 화면·실행/미검증 보고 |

## 4. 기존 코드 재사용과 의미 보존

FE 실제 Content Script와 v2 browser/runtime/collector/repository 및 기존 Visit/Behavior/END 전송 코드를 재사용했습니다. 생산 수집기를 새로 만들지 않았습니다. 5초·4초·최초5분·IndexedDB·ACK/재전송·권한/인증/동의·개인정보 철회를 유지했습니다. UI에 원본/AI 지표만 추가했습니다.

BE는 Authentication/Consent/Owned Session/WorkSession/PageVisit·CollectionPlan/Progress·V2StorageGate·Retraction/Withdrawal·기존 AI composition/analysis/notification을 재사용했습니다. `CollectionSitePolicy.realProfile()`에 정확한 단일 individual-local을 추가했으며 동일한 Artifact/DB Release/Build·Session Scope/사이트 검증을 적용합니다. flag 하나로 열지 않습니다.

기존 `QUALITY_PASSED`와 `Progress.completed`는 종료·10 Visit·ordered Window·AI/최신 판단·전송·privacy 의미를 그대로 유지합니다. `rawStatus`/`rawQuality`/`Progress.raw`를 별도로 추가했습니다. `analysisState`는 원본10 Visit 조건과도 독립입니다. 예를 들어9 Visit의7개 Window가 분석 완료되면 AI 완료일 수 있지만 원본 최소량은 미달입니다. 배포 준비 판정에서 AI Dispatcher 의존만 제거했습니다.

DB는 V17만 추가했습니다. V1~V16의 파일 바이트가 공식 main과 동일함을 확인했습니다. V16 테스트 helper는 신규 Migration이 V16 검사에 섞이지 않도록 target16을 명시했고 V17 보존/멱등/무Seed 테스트를 추가했습니다. 기존 합성 MySQL4개 테스트의 고정 비밀번호는 테스트 환경변수도 수용하도록 수정하여 새 랜덤 비밀번호 DB에서 회귀했습니다.

## 5. 변경 파일

전체 목록은 이 문서 마지막의 자동 생성 목록에 있습니다. 핵심 경로는 `deploy/individual-local/compose.yml`, `application-individual-local.properties`, CollectionProgress/ExportService/ExportController, V17, `tools/individual-local/`, `fe/participant/index.tsx`, 실제 Chrome 테스트와 아래 매뉴얼입니다. 기존 v2 공통 Schema/Fixture·원본 Migration은 변경하지 않았습니다.

## 6. 실제 로컬 환경 실행

macOS27.2 arm64, JDK21.0.10/Gradle9.7.1, Docker29.2, MySQL8.4, Chrome for Testing151.0.7922.34, Node25.9.0, Python3.11.16, age1.3.2를 사용했습니다.

`local.py --directory .collection/local-guide101 init --slot A`로 신규 Secret/PKCS12/localhost SAN 인증서/DRAFT 정책을 만들고 db/start/status/verify/build/backup/stop·동일 볼륨 재시작을 실행했습니다. HTTPS health200, participant0, credential/동의/승인 Seed0, Flyway17, MySQL loopback33101, HTTPS loopback9443을 확인했습니다. 초기 서버 실행은 설치된 Java25에서도 확인했고, 가이드 재시작은 PATH/JAVA_HOME의 JDK21로 검증했습니다.

Python은 자기 공개 인증서를 CA로 명시해 **TLS 검증을 유지**했습니다. Chrome 사용자 키체인/Windows 신뢰 저장소 설치는 하지 않았습니다. 미신뢰 상태에서 실제 Chrome 연결 실패/수집 차단 화면도 캡처했습니다. 인증서 검증 무시 옵션은 사용하지 않았습니다.

## 7. AI 비의존 원본 수집 검증 — PASS (SYNTHETIC)

`run-synthetic-e2e.py`는 신규 MySQL 컨테이너3개·Spring JVM3개·임시 Chrome 프로필3개만 시작했습니다. FastAPI/모델 프로세스를 시작하지 않았고 BE의 AI 주소는 연결 불가 loopback port1, Dispatcher=false였습니다. 별도의 AI 회귀 실행은 이 검증을 종료한 뒤 수행했습니다.

각각 인증·합성 동의·배정 시작·실제 HTML10개×실측5초 이상·IndexedDB·Visit POST/전송 ACK·END/최종 행동·delivered·원본 완료를 통과했습니다. 단위 통합 테스트는 실제 Behavior PATCH300000ms와 멱등 replay도 검증했습니다. 각 DB의 실제 Window/Analysis 행은0이며 NOT_RUN입니다.

## 8. Chrome Extension 빌드·설치 — PASS / 한계 구분

v1/synthetic/participant/pilot/real 빌드와 로컬 real ZIP 생성이 성공했습니다. DRAFT localhost 패키지는 사이트 권한0·collectionAllowed=false이며 실제 Chrome에서 설치/시작 차단을 확인했습니다. 허용된 통제 HTML Adapter는 별도의 controlled-web 합성 빌드로 실제 실행했습니다.

프로필은 자동화가 새로 만들었고 MV3를 `--load-extension`으로 설치했습니다. 화면의 실제 버튼으로 로그인/동의/배정/시작/종료/철회를 수행했습니다. 일반 사용자의 수동 ‘압축 해제 로드’ 클릭·OS 인증서 신뢰 설치는 NOT_TESTED입니다. ZIP은 Git에 넣지 않고 로컬 `fe/packages`에 생성합니다. 화면은 Commit 전 작업트리에서 촬영해 footer에 기준 SHA/dirty가 표시됩니다. 최종 Commit의 패키지는 별도로 재빌드해 인계합니다.

## 9. 실제 MySQL A/B/C 저장 — PASS (SYNTHETIC)

새 컨테이너 `focus101-f909ba6ae6fc-a/b/c`를 만들고 포트33111/33112/33113, 각각 `focus101_synthetic` DB와 독립 볼륨을 사용했습니다. 같은 DB에 세 명의 원문을 넣어 독립 PC처럼 표현하지 않았습니다. 각 DB에는 본인 PLAN의 Visit10·Window0·Analysis0·Flyway17이 확인됐습니다. 컨테이너/볼륨·실행 파일은 검증 후 보존하고 이 작업에서 시작한 서비스만 중지했습니다.

## 10. 원본 품질·진행률 — PASS

각각 `raw.syntheticCompleted=1`, `attempt.rawStatus=RAW_COLLECTED`, `analysisState=NOT_RUN`, 이론상8, 생성0, 기존 syntheticQualityPassed0/실제 completed0이었습니다. source는 SYNTHETIC이며 실제160 실적을 늘리지 않았습니다.

원본 조건은 정상 종료·최소10 유효 Visit·추출·실측·ID/증가 sequence·서버 저장/전송 확인·현재 동의/개인정보입니다. 최소량/참조·전송 불충족은 완료가 아니며 개인정보 격리가 우선합니다. 최신 PLAN별 시도로 집계합니다. 기존 QUALITY_PASSED의 분석 요구는 그대로입니다.

## 11. A/B/C Export — PASS

인증된 실제 Backend snapshot API에서 받은 원본을 JSONL·Manifest/파일별 해시/행 수로 만들고 age로 암호화했습니다. Source Instance는 DB에 영속 저장되고 Export 감사 행이 남습니다. 실명/이메일/identity hash/Token/request key/Secret은 포함하지 않았습니다. 암호문과 개인키·Credential은 `.collection` 안에만 보존했습니다.

| 합성 출처 | 세션 / Visit | 실제 암호문 SHA-256 |
| --- | --- | --- |
| A | 1 / 10 | `99bfe73a2ba76d624f821408fa2eea5f8f0b57a71737077b535674c46934f8e3` |
| B | 1 / 10 | `55491cd5d496b904b2618d1f49ef339be21e18e683822f499661f876aeebb5e7` |
| C | 1 / 10 | `7047c8a76cdf1f3159fdbf918f01f2fe91fd29861de221ecba86a1535bbaa0b6` |

내부 파일/Manifest checksum은 [실행 증거 JSON](evidence/issue101-summary.json)에 있습니다. snapshot 감사는 서버 추출을 뜻하며 파일 전달/모든 사본 삭제를 증명하는 기록은 아닙니다.

## 12. Import·중복·충돌·FK — PASS

통합 결과3세션30 Visit/이론상24/생성0/AI0/PARTIAL. 같은 Export3개 재Import는 중복3건이며 행 수가 늘지 않았습니다. 동일 Visit ID의 다른 내용, 다른 Source UUID 충돌, 종료 시각 변경, Export ID 재사용, Plan revision/체크섬 불일치, 참조/sequence/본문/Behavior 불량, 중첩 미허용 필드와 잘못된 암호키는 차단했습니다. 실제 E2E와 Python fixture 검증 범위는 구분했습니다.

검증은 무결성 플래그를 그대로 믿지 않고 원본/참조·서버 전송 보고·동의·최신 시도에서 재계산합니다. 실패한 Import는 성공본을 게시하지 않고 기존 출력/원본을 덮지 않습니다. 발신자가 별도로 확인한 암호문 해시와 최신 privacy 해시를 요구합니다. registry는 원문 없이 멱등/출처/단조 금지 기록을 유지합니다.

## 13. 개인정보 철회·격리·복원 — PASS 범위 / 외부 BLOCKED

실제 합성 A의 전체 철회 UI 요청 뒤 서버 소유 세션이 QUARANTINED, 원본 완료0으로 바뀌었습니다. 새 privacy로 재통합하면 A를 제외해2세션20 Visit/이론상16·privacyExcluded1이며 철회 전 상태 replay는 거절됩니다. Tombstone 우선 제외·후속 잘못된 CLEAR 주장에 의한 재유입 차단도 Python fixture로 검증했습니다. 일시적인 Credential 만료는 포함을 막되 영구 철회를 발명하지 않습니다.

A의 Spring/MySQL을 실제 중지·재시작해 동일 볼륨의10 Visit·Credential·진행률을 복구했습니다. 추가 `verify-restore.py`는 A를 읽기 전용 dump→age 암호화→**새 schema** 복원→최신 원장/기존 restore-quarantine 도구 적용으로 검증했습니다. 복원 결과 Visit10·격리1·철회 참여자1·활성 Release0·Export 감사2, 원본 행 보존, PURGED=false였습니다. 실제 운영 DB를 덮어쓰지 않았습니다.

로컬 빈 DB에서도 `local.py backup`의 실제 암호화/복호화와 V17 schema를 확인했습니다. source PC/전달 사본/통합본/학습/로그/백업/전 AI Worker·모델 영향의 **전체 삭제/운영 훈련은 BLOCKED**입니다. 과거 파일을 자동 삭제하지 않으며 수신자 대장과 실제 회수 증거가 필요합니다.

## 14. 최종 데이터셋 품질 — PASS (부분 합성)

- 초기 합성 결과: `.collection/validation-101-final/merged.tar.age` — 3/160, 30 Visit, 이론상24. A 철회 이후 이용 중지/격리 대상입니다.
- 철회 반영본: `.collection/validation-101-final/after-withdrawal.tar.age` — 2/160, 20 Visit, 이론상16, PARTIAL.
- 두 결과 모두 생성 Window0/AI 완료0, Manifest/파일 checksum/행 수/FK 재검증 PASS. 없는 AI 예측·라벨 파일을 만들지 않았습니다.
- 전체 판정 fixture:160세션1600 Visit/이론상1280/생성0/AI0, A54/B53/C53·시나리오40씩 PASS. **Chrome에서160개를 수집한 결과가 아닙니다.**

## 15. macOS 결과

PASS: 새 로컬 설정·DB/JAR·명시적 인증서 pin·Health·저장 집계·로컬 Extension 빌드/ZIP·실제 임시 Chrome 합성 수집/복구/철회·age/통합/복원. 기존 개인 Chrome 프로필을 사용하지 않았습니다. OS 프로그램 신규 설치 전체·로그인 키체인 신뢰 설치·실제 참여자/실제 인터넷 사이트 수집은 NOT_TESTED/BLOCKED입니다.

## 16. Windows 결과

**NOT_TESTED.** PowerShell 명령, Gradle .bat, Python CLI, ntfs owner ACL/최초 Java Credential 생성 경로, 현재 사용자 인증서 신뢰 절차를 제공했습니다. 실제 Windows/Docker/Chrome/NTFS/인증서·프로세스 종료 검증은 수행하지 않았습니다. macOS 결과를 Windows PASS로 확대하지 않습니다. Linux 실행도 NOT_TESTED입니다.

## 17. 팀원용 문서

- [개인 PC 설치](individual-local-setup.md): macOS/Windows 준비·Secret/TLS·최초 운영자·실행/종료/재시작·로그·빌드/설치·백업.
- [27단계 팀원 실습](participant-guide.md): 실제 버튼·동의/배정·5초/4초/5분·Visit/Queue·종료/원본 완료·실패·Export/전달·철회.
- [통합 관리자 실습](merge-guide.md): 수신·암호화·외부/내부 해시·privacy·Import/충돌/FK·부분/전체·최종 Manifest/회수.
- collection-procedure/data-flow-and-storage/data-verification/operator-guide/readiness-checklist 및 수집 관리 API도 현재 로컬 경로와 기존 AI 활성 경로를 구분해 갱신했습니다.

## 18. 실제 캡처 목록

`docs/data-collection/images/team-guide/`의 다음9장은 실제 Chrome/실제 코드 화면입니다. 생성 이미지/Mock UI를 실제 화면처럼 표시하지 않았습니다. 앞8장은 SYNTHETIC controlled-web, 마지막은 DRAFT 잠금 패키지의 연결 실패 테스트입니다. Token 입력은 촬영 전에 비웠고 합성 본문만 사용했습니다.

1. extension-install.png — 실제 MV3 설치/활성 상태, 개발자 로드 옵션 설치.
2. extension-login.png — 로그인 전.
3. consent.png — SYNTHETIC 정책 확인.
4. collection-goal.png — GOAL-001 / PLAN-001·목표 유지.
5. collection-start.png — ACTIVE.
6. collection-progress.png — 5 Visit 시점.
7. collection-complete.png — ENDED/ACK/10 Visit/RAW_COLLECTED/NOT_RUN.
8. withdrawal.png — 실제 전체 철회 접수/격리.
9. connection-error.png — 인증서 미신뢰로 실제 연결 실패, 수집 차단 유지.

서버 터미널·Export 터미널·Manifest 화면의 스크린샷은 **NOT_CAPTURED**입니다. 실제 CLI 출력/Manifest/checksum JSON과 표로 검증했고 터미널 이미지를 생성하지 않았습니다. 수동 인증서 신뢰 성공·실제 참여자 화면도 NOT_CAPTURED이며 미실행입니다.

## 19. 매뉴얼 재현 검증

새 로컬 디렉터리/전용 볼륨과 새 Chrome 프로필에서 문서의 check/init/db/start/status/verify/build/backup/stop/재시작 명령, 실제 UI 로그인/합성 동의/배정/시작/종료/복구/철회, dataset export/verify/merge/inspect를 재현했습니다. A/B/C 각각 실제 Extension을 사용했습니다. 버튼/시나리오 표시가 문서와 일치하며 시나리오 자유 선택 UI를 발명하지 않았습니다.

부분 검증: OS 패키지 설치부터 사람의 수동 Chrome 로드/키체인 신뢰·실제 위임/참여자/정책 등록까지 문서만 보고 수행한 인간 사용성 평가는 NOT_TESTED/BLOCKED입니다. 최초 관리자 POSIX bootstrap은 기존 자동 테스트가 검증하며 실제 위임 없이 운영자를 만들지 않았습니다. Windows 경로도 미실행입니다. 실제 수집 승인 전/후와 합성 화면을 문서에 구분했습니다.

## 20. 테스트 명령·결과

| 실행 | 실제 결과 |
| --- | --- |
| FE `npm run typecheck`, `npm test` | PASS:908, 환경 HTTP2 SKIPPED |
| BE 전체 `run-regression.py` | PASS:1020건 중942 PASS·78 SKIPPED, failure/error0. 실제 FastAPI/Mock 모델·H2/새 MySQL schema·V17·Chrome HTTP 포함 |
| 최종 BE 원본/Gate/Bootstrap/V17 선별 | PASS:29건 중28 PASS·MySQL env1 SKIPPED. 위 전체 실행과 중복되므로 합산하지 않음 |
| AI `python -m pytest -q` | PASS:244, 실제 Qwen 추론은 아님 |
| 새 로컬/통합 Python 단위 | PASS:27, 실제 age roundtrip/잘못된 키 포함 |
| 기존 collection Python 단위 | PASS:5 |
| Chrome v1 | PASS, 네이티브 다중 창/최소화 HEADED1 SKIPPED |
| Chrome v2 synthetic Mock HTTP | PASS: 인증/동의·실제 IndexedDB·SPA/reload/Worker·알림UI·철회/재인증 |
| Chrome participant / real DRAFT | PASS: 실제 설치·최소 권한/사이트0·수집 차단 |
| Chrome 원본 A/B/C / MySQL3 / AI0 | PASS:각10 Visit·네트워크 재전송·Worker/Chrome 재시작·END/RAW·타인404 |
| V1/synthetic/participant/pilot/real 빌드·ZIP | PASS. 최종 Commit 기준 real ZIP은 별도 재빌드 |
| 계약 validator | PASS:30defs/80schema/139reference/216규칙/κ4, 제품 실행과 별도 |
| 신규 MySQL backup/restore + 최신 원장 | PASS:새 schema만 사용, 격리/철회·활성 Release0·원본 보존 |
| 기존 V1~V16 원문 / diff / 문서 링크·fence | PASS(최종 파일 점검 기준) |

재현 명령(저장소 루트, 각 명령의 사전 조건을 가이드대로 준비):

```sh
cd fe
npm ci
npm run typecheck
npm test
npm run build
npm run build:synthetic
VITE_API_BASE_URL=https://localhost:9443 npm run build:participant
VITE_API_BASE_URL=http://127.0.0.1:8097 npm run build:pilot
cd ..
python3 tools/individual-local/local.py build
python3 -m unittest discover -s tools/individual-local -p 'test_*.py'
python3 -m unittest discover -s tools/collection -p 'test_*.py'
python3 -m venv .collection/ai-regression-venv
.collection/ai-regression-venv/bin/python -m pip install -r ai/requirements-test.txt
.collection/ai-regression-venv/bin/python docs/contracts/v2/validate.py
python3 tools/individual-local/run-synthetic-e2e.py --output .collection/NEW-RUN --chrome "$CHROMIUM_PATH"
# AI regression은 원본 검증을 종료한 뒤 위 Mock-only test venv로 별도 실행.
python3 tools/individual-local/run-regression.py \
  --mysql-fixture .collection/NEW-RUN/A/fixture.json --output .collection/NEW-REGRESSION \
  --ai-python .collection/ai-regression-venv/bin/python --chrome "$CHROMIUM_PATH"
cd be
./gradlew test --tests '*CollectionRawTest' --tests '*CollectionSitePolicyTest' --tests '*CollectionBootstrapTest' --tests '*V17MigrationTest' bootJar
cd ../ai
../.collection/ai-regression-venv/bin/python -m pytest -q
cd ../fe
npm run test:browser
npm run test:v2:browser
npm run test:participant:browser
npm run test:real:locked
```

`CHROMIUM_PATH`는 설치된 Chrome for Testing 실행 파일의 절대경로, JAVA_HOME/PATH는 JDK21로 지정했습니다. `NEW-*`는 **기존에 없는 새 경로**로 바꾸며 검증 runner에 `python -O`를 사용하지 않습니다. Windows는 Python/Gradle/venv 경로를 Windows 형식으로 바꾸고 실제 실행은 NOT_TESTED입니다. requirements-test는 Mock 모델 검증용이며 원본 수집의 런타임 의존성이 아닙니다.

초기 실패도 숨기지 않습니다: 첫 raw Chrome harness는 장애 화면 캡처로 활성 탭을 바꾼 뒤 탐색 탭으로 복귀하지 않아 timeout이 났고 수정 후 새 환경에서 통과했습니다. 기존 v1 Chrome의8500ms 고정 대기는 실제 제외 상태를 유한 대기하도록 고쳤습니다. 회귀 runner의 v1 모델 health503 준비 확인 및 기존 합성 MySQL 고정 비밀번호로 인한90건 실패도 실행 환경/테스트 코드를 수정해 최종 전체 실행 failure0을 확인했습니다. 최종 정리 중 사용 중인 변수 제거로 발생한 Python 테스트 오류도 즉시 복원 후27건 재통과했습니다. 미실행을 PASS로 바꾸거나 제품 Gate/정책을 완화하지 않았습니다.

## 21. 미검증·BLOCKED·운영 한계

- NOT_TESTED: Windows/NTFS/현재 사용자 인증서·네이티브 프로세스 종료, Linux, OS 신규 설치 전체·사람의 수동 설치 사용성, Chrome OS 신뢰 설치 후 승인된 실제 HTTPS 수집.
- NOT_TESTED: 실제 Qwen 가중치 로드/추론, 원래 공용 BE/AI 전체 Docker 배포·공용 DNS/TLS. 원본 전용 실행에는 AI 프로세스가 필요하지 않습니다.
- BLOCKED: 실제 위임 담당자/3명 등록·Credential 전달·동의·목표20/사이트·기관/심의·보존/회수·개시 승인·독립 Release·실제 파일럿.
- BLOCKED: 모든 외부 사본/백업/학습/전 Worker·GPU·모델 영향의 전체 회수/삭제 증거. 파일을 새로 통합한다고 이전 배포 파일이 자동 삭제되지 않습니다.
- privacy는 인증된 원본 PC 상태를 별도 신뢰 해시로 확인한 기준 시점까지 유효합니다.15분 freshness는 보존기간이 아니며 미래 철회까지 증명하지 않습니다. 새 사용/배포 전 다시 확인하고 지속적인 사본 대장을 유지해야 합니다.
- Export/통합은256MiB 범위의 메모리 snapshot입니다. 대규모 Export는 별도 분할/streaming 검토가 필요하고 현재 상한을 끄지 않습니다.
- 기존 npm audit 개발 의존성3건은 이번 변경에서 major 강제 업그레이드하지 않았습니다. 잠금 파일은 보존했습니다.

## 22. 실제 수집 개시 가능 여부

**BLOCKED. 실제 참여자 세션0, 실제160세션 완료0.** 합성 E2E·Mock 모델·형식 검증·이 PR은 사람의 동의/기관·정책/전체 회수/운영 인수를 대신하지 않습니다. 승인 파일/Release/목표/동의가 준비되기 전에는 Gate가 닫힌 상태를 유지합니다. 실수집 DB에는 테스트 계정/정책/승인 Artifact를 자동 등록하지 않았습니다.

## 23. 후속 작업과 인계

담당자가 Windows와 OS 인증서 신뢰/수동 설치를 실제 검증하고, 실제 수집 범위의 위임·정책/기관·보존/전체 회수·목표20·사이트/Build·시작 승인/독립 Release를 확보합니다. 각 PC의 신뢰된 초기화/가명 등록·Credential 안전 전달·명시적 동의와 동일 계획 checksum을 확인한 뒤 A/B/C각1개 실제 파일럿을 수행합니다. 성공/사본 회수 확인 후160개 실제 수집을 별도 개시합니다. 원본 모드의 AI 미실행 범위를 승인 근거에도 정확히 기록합니다.

Commit/Push/PR은 요청한 브랜치→개인 Fork→공식 main PR 순서로 수행하며 자동 Merge하지 않습니다. 최종 SHA/PR URL은 제출 후 최종 응답과 PR 메타데이터에서 확인할 수 있습니다.

## 변경 파일 전체

- `be/Dockerfile`
- `be/build.gradle`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionController.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionExportController.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionExportService.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionOperatorBootstrap.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionPlanService.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionProgressService.java`
- `be/src/main/java/com/focusrecovery/domain/collection/CollectionSitePolicy.java`
- `be/src/main/java/com/focusrecovery/domain/consent/ConsentService.java`
- `be/src/main/resources/application-individual-local.properties`
- `be/src/main/resources/db/migration/V17__individual_local_exports.sql`
- `be/src/test/java/com/focusrecovery/domain/collection/CollectionRawTest.java`
- `be/src/test/java/com/focusrecovery/domain/collection/CollectionSitePolicyTest.java`
- `be/src/test/java/com/focusrecovery/domain/collection/IndividualLocalSyntheticServer.java`
- `be/src/test/java/com/focusrecovery/domain/integration/V2MySqlIntegrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V12MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V16MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V17MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2MigrationTest.java`
- `be/src/test/java/com/focusrecovery/domain/storage/V2MySqlStorageTest.java`
- `deploy/individual-local/compose.yml`
- `docs/contracts/collection-operations-api.md`
- `docs/data-collection/collection-procedure.md`
- `docs/data-collection/data-flow-and-storage.md`
- `docs/data-collection/data-verification.md`
- `docs/data-collection/evidence/issue101-summary.json`
- `docs/data-collection/images/team-guide/collection-complete.png`
- `docs/data-collection/images/team-guide/collection-goal.png`
- `docs/data-collection/images/team-guide/collection-progress.png`
- `docs/data-collection/images/team-guide/collection-start.png`
- `docs/data-collection/images/team-guide/connection-error.png`
- `docs/data-collection/images/team-guide/consent.png`
- `docs/data-collection/images/team-guide/extension-install.png`
- `docs/data-collection/images/team-guide/extension-login.png`
- `docs/data-collection/images/team-guide/withdrawal.png`
- `docs/data-collection/individual-local-setup.md`
- `docs/data-collection/individual-local-validation.md`
- `docs/data-collection/merge-guide.md`
- `docs/data-collection/operator-guide.md`
- `docs/data-collection/participant-guide.md`
- `docs/data-collection/readiness-checklist.md`
- `fe/package.json`
- `fe/participant/index.tsx`
- `fe/scripts/browser-test.mjs`
- `fe/scripts/raw-browser-test.mjs`
- `fe/scripts/real-locked-browser-test.mjs`
- `tools/collection/manage.py`
- `tools/individual-local/dataset.py`
- `tools/individual-local/local.py`
- `tools/individual-local/run-regression.py`
- `tools/individual-local/run-synthetic-e2e.py`
- `tools/individual-local/test_dataset.py`
- `tools/individual-local/test_local.py`
- `tools/individual-local/verify-restore.py`
