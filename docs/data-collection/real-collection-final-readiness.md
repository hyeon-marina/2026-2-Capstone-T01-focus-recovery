# 실제 수집 최종 준비 — Fix #105

TECHNICALLY_READY와 COLLECTION_AUTHORIZED를 분리한다. 실제 팀/기관 증거는 제공되지 않았고 외부 사이트에서 참여자 수집을 실행하지 않았다. 현재 COLLECTION_AUTHORIZED=BLOCKED. 기술 검증 결과는 아래에 실제 실행 범위대로 기록한다.

1. 작업 전 Git: 수정/미추적0, 기존 feat/105 브랜치. 다른 Worktree/DB/Chrome 프로필 변경 없음. 저장소 AGENTS 없음, 상위 빈 AGENTS 확인. PR 템플릿 유지.
2. 최신 upstream/main: `b41b41023c7fabe67cf51b7dd5b31af39702229f`. fetch 후 `fix/105/real-collection-ready` 생성.
3. #106 미완료: 증거 입력·확정 파일 생성 수동, Plan revision0, 접근 불가5쌍, 실제 팀/기관/동의 부재. 원래 합성 HTTPS/pin 검증과 실제 OS 신뢰/외부 수집은 달랐다.
4. 이번 보완: 증거 파일 SHA 확인→공통 정책 생성→기존 Java 검증→신규 파일/SHA 발행 명령. 관리자/동의/DB 쓰기 없이 진행. 미확인 증거는 생성하지 않는다.
5. 정책: A/B/C 로컬 RAW_ONLY, 목표 유지/우회·복귀/점진·명확 이탈, 캡스톤 연구·학습·평가·결과 분석. 메타데이터만 저장, 원본 외부 공개/무단 제공 금지. 최종 평가 종료일+90일을 공통 정책으로 채택. 자동 전체 삭제 스케줄러는 미구현이며 실제 담당·기한·사본대장·확인 기록을 요구한다.
6. 목표20: 원문/완료 기준/시나리오 유지. 채택 계획 revision1. 팀 전체 검토 증거 확보 전 Goal DRAFT. 생성 도구는 실제 goalReviewRef 파일을 확인한 뒤 CONFIRMED로 연결한다.
7. 160세션: 기존 PLAN/Goal/type/repetition/slot 그대로, A54/B53/C53. 새로운 배정표 생성 없음. Java/Python 검증.
8. 사이트: 기존 실제 Chrome smoke 통과15쌍으로 목록 축소. Smithsonian2/USGS/Maangchi403·NL 대표404는 제외, 접근 제한 우회 없음. 현재 목록도 실제 siteReviewRef의 목적별 검토 전 수집 승인 아님.
9. 블로그/일상: 정확한 notice.tistory.com, D2를 유지. 부족한 과학/생활/교통·문화 경로는 접근 가능한 ko/en Wikipedia 공개 학습 문서를 보조 경로로 사용한다. 원문·댓글·사용자/토론/편집 영역은 제외. 목표별10 소주제는 기존 상세 목표 문서를 사용한다. 사람의 실제 완료 기준/페이지 유효성 검토는 남아 있다.
10. 검색/동영상: Google/Naver/YouTube/Naver Blog의 URL parser는 기존 합성 테스트를 보존한다. 실제 허가·운영 적용 판단 부재로 정책 sites에 미포함. 검색결과·영상 원문을 수집하지 않는다. 제외된 서비스 없이 공개 문서/블로그/백과를 직접 탐색할 수 있으므로 전체 수집이 이 서비스에 의존하지 않는다.
11. URL: 기존 exact origin/prefix, 인코딩/민감키/미검토 Query 차단, Unicode 앵커 제거, HMAC session identity, SPA frame URL 대조 유지. 기존 AI 활성 Adapter와 구분.
12. 개인정보: 원URL·원제목·본문·검색어·Cookie/Token/폼값 비저장, 고정 Topic/METADATA_ONLY. 미탐/오분류 한계 유지. 철회 즉시 중단/격리, QUARANTINED는 전체 삭제가 아님.
13. JSON: focus-local-policy/1 RAW_ONLY, revision1, status DRAFT/기관 UNRESOLVED 유지. 실제 문서가 없어 CONFIRMED 파일은 생성하지 않았다. `policy-records.template.json`과 아래 절차로 실제 기록을 입력하면 정책 생성·설치 가능.
14. Plan checksum: TEAM_POLICY.json의 planChecksum과 Java 검증/정렬 UTF-8 canonical checksum 대조.
15. 전체 파일 SHA: TEAM_POLICY.sha256에 기록. 실제 확정 시 Goal evidence/status가 바뀌므로 두 hash를 재계산한다.
16. A/B/C: 기존 자기 슬롯 setup·Credential 자동 발급/회전·동일 정책 SHA/Plan·권한 검증 재사용. 새 합성 실행 결과는 실행 증거에 별도 기록.
17. Chrome HTTPS: 실제 Chrome/로컬 Spring/MySQL 합성 pin 검증을 재실행한다. OS 키체인을 변경하지 않으며 이를 OS 신뢰 설치 성공으로 표시하지 않는다. Windows/Linux NOT_TESTED.
18. 외부 사이트 파일럿: BLOCKED(실제 승인/개별 동의 부재). 대신 실제 Chrome 읽기 전용 호환성 점검. 참여자 데이터 저장은0.
19. RAW_COLLECTED/NOT_RUN: 기존 규칙5초/4초/최초5분 PATCH/최소10 Visit·END ACK 유지. AI 실행 필수 아님.
20. Export/Import: age/Manifest/행SHA/소유권/Source/계획/FK/중복/충돌/최신privacy/철회 replay 보호 유지. 평문 기본 Export 없음.
21. 회귀: 최종 실행 결과는 아래 표/증거에 기록. 이전 #106 결과를 이번 PASS로 재사용하지 않는다. V1~V18 원문 변경 없음.
22. 문서: 필수12개 정책/설치/참여/운영/통합 가이드에 현재 경로와 증거 생성·보존·삭제 절차를 연결한다. 기존 검증 문서는 당시 결과로 보존.
23. 실제 개시: COLLECTION_AUTHORIZED=BLOCKED. 증거 확보·Java 통과·각 PC TLS/동의/파일럿 완료 후 추가 관리자 계정이나 수동 DB Release 없이 진행한다. TECHNICALLY_READY는 검증한 macOS 합성 경로에 한정, 모든 PC/모든 외부 사이트 성공을 보증하지 않는다.
24. 외부 확인: A/B/C가 전체 목표/정책 의결·각자 동의, 기관 연락 담당자가 실제 적용/비적용 문서, 통합 담당자와 PC 소유자가 보존일/연락·원본/Export/통합/백업/파생 사본대장·삭제 확인, 사이트 검토 담당자가 허용 범위/권리·목표별 공개 경로 기록을 확보한다. 임의 사람 이름/학교 결과를 만들지 않는다.
25. Commit: 구현 및 결과 기록은 이 브랜치의 한국어 Commit/PR 목록 참조.
26. PR: 공식 main 대상, Related Issue #105/PR #106. 링크는 게시 후 기록한다. 자동 Merge 없음.

## 실제 기록부터 실행까지

팀의 기록 담당자가 비공개 `.collection/records/`에 실제 기록 파일들을 보관한다. 템플릿을 `.collection/records/records.json`으로 복사하고 각 file(상대 경로 가능)/sha256, 실제 유효 기간, institutionDecision, 승인된 sites 부분집합을 입력한다. `confirmedByRecordOwner=true`는 그 사람이 실제 원문/권한/날짜·목표20개 전체/사이트 검토를 대조한 뒤 설정한다. 체크박스 자체나 파일 존재/SHA가 사람 승인 사실을 증명하지 않는다. 동일 문서가 여러 항목을 포함할 수 있지만 해당 내용을 실제로 포함해야 한다. 비공개 원문을 Git에 넣지 않는다.

retentionRef 파일에는 최종 평가일(미정이면 확정 담당/확정 절차), PC별/통합 담당자·연락, 대상 경로/사본, 삭제 실행자/확인자·확인 방법/일시를 기록한다. 날짜 확인 후 finalEvaluationDate에 ISO 날짜를 넣으면 생성 도구가 +90일을 계산한다. 원본·Chrome IndexedDB/키·Export·통합·백업·파생 사본과 이용 가능한 학습 사본을 처리하고 증거를 기록한다. 미래 작업이 이미 완료되었다고 표시하지 않는다. 철회는 즉시 중단/격리 후 같은 대장으로 회수/삭제한다.

macOS (JDK21):

```sh
mkdir -p .collection/records
cp docs/data-collection/policy-records.template.json .collection/records/records.json
# 실제 기록 입력 후:
python3 tools/individual-local/local.py policy-prepare --records .collection/records/records.json --output .collection/TEAM_POLICY.json
python3 tools/individual-local/local.py setup --slot A --policy .collection/TEAM_POLICY.json --policy-sha256 TEAM_CONFIRMED_SHA256
python3 tools/individual-local/local.py build
```

Windows PowerShell (NOT_TESTED):

```powershell
New-Item -ItemType Directory -Force .collection/records
Copy-Item docs/data-collection/policy-records.template.json .collection/records/records.json
py -3 tools/individual-local/local.py policy-prepare --records .collection/records/records.json --output .collection/TEAM_POLICY.json
py -3 tools/individual-local/local.py setup --slot A --policy .collection/TEAM_POLICY.json --policy-sha256 TEAM_CONFIRMED_SHA256
py -3 tools/individual-local/local.py build
```

B/C는 자기 슬롯. 생성 명령은 기존 출력 덮어쓰기를 거절한다. 팀 공통 JSON bytes와 별도 확인 SHA만 동일 전달하고 기록 원문/Owner Key/개인 Secret/Credential은 공유하지 않는다. 인증서 신뢰→Extension 설치→participant.json 파일 로그인→슬롯/정책 확인→본인 동의→배정→10~15 Visit→종료/ACK/RAW_COLLECTED/NOT_RUN→기존 merge-guide의 age Export/privacy·검증/통합 순서다.

## 이번 실행 결과

- PASS: FE typecheck·917 Vitest, 2 SKIPPED; AI244; Python33.
- PASS: BE 기본 전체995 중855 PASS·140 환경 SKIPPED, failures/errors0. 최종 정책 focused도 별도 PASS(중복 합산 안 함).
- PASS: 생성 CLI의 합성 기록→기존 Java 검증→CONFIRMED 파일/체크섬 발행. 실제 승인 파일은 생성하지 않음.
- PASS: 이번 실제 Chrome 읽기 전용15/15. 실제 사이트 수집은 BLOCKED.
- PASS: 공통 계약30defs/80cases/139scenarios/216rules/κ4.
- NOT_TESTED: 실제 모델·Windows/Linux·OS 신뢰 설치. HTTPS 합성 pin과 OS 신뢰를 구분.

현재 DRAFT Plan SHA-256: `52e28a4fd9a6717f10f18c2cfef3f4f649761491922836ac4c293a73b9f13b02`. 현재 JSON SHA-256: `3a8f2cb51be3a9b02a2fb05a8c870b273c66f2f4f158f6aba2021b3bc081fcb0`. 실제 증거 반영 후 별도 파일에 새 SHA를 발행한다.

기존 collection 도구 회귀5건 PASS. 실제 기록 양식은 [비공개 기록 양식](decision-record-template.md)을 참조한다. 이후 정책 변경 시 기존 실적 Plan의 goalReviewRef 문서/해시는 유지하고 새 policyVersion·기간·재빌드·재동의를 적용한다. 승인 기록을 다시 쓰거나 과거 증거 해시를 바꾸어 기존 실적을 인수하지 않는다.

- PASS(SYNTHETIC): 새 A/B/C HTTPS Chrome 각각10 Visit·SPA·Worker/Chrome 재시작·슬롯/파일 로그인·END ACK·RAW_COLLECTED/NOT_RUN, 독립 UUID·동일 정책/Plan·회전/보존·정책 변경 재동의·age 암복호화/3출처 통합·중복3·철회 후2출처·old privacy 거절. [이번 실행 증거](evidence/final-ready-https.json). 실제 OS 신뢰와 외부 수집은 미검증이다.

## 현재 경로별 읽기 전용 검사

| Origin | Prefix | 이번 Chrome 검사 | 실제 수집 승인 |
| --- | --- | --- | --- |
| https://docs.github.com | /en/pages | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://developer.mozilla.org | /en-US/docs | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://docs.python.org | /3 | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://git-scm.com | /docs | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://www.w3.org | /WAI/ | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://science.nasa.gov | / | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://www.epa.gov | /recycle | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://www.metmuseum.org | /ko/art | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://www.hangeul.go.kr | / | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://philharmonia.co.uk | /resources/ | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://www.noaa.gov | /jetstream | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://notice.tistory.com | / | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://d2.naver.com | /helloworld | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://ko.wikipedia.org | /wiki | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
| https://en.wikipedia.org | /wiki | COMPATIBLE_SMOKE | BLOCKED: 실제 기록 필요 |
