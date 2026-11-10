# 데이터 수집·분석 계약 검증 — Issue #81

## 기준과 결과의 의미

2026-11-10 KST, 공식 main `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`을 기준으로 문서·Schema·Fixture를 작성했다. 제품 코드는 변경하지 않았다. #79의 이전 검증 기록은 [PR #80 당시 문서](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/blob/6e15dd3fa1789e96c42bc4f33250c4221d6d2616/docs/data-contract-validation.md)에 남아 있으며, 그 PASS를 이번 실행 결과로 사용하지 않는다.

P1~P6는 **모두 PROPOSED**다. 상위 요구 #79/#80과 세부 제안의 차이, 승인 근거 부재, 개인정보 보존·동의 및 조기 배포 선결의 BLOCKED는 [결정안](v2-contract-decisions.md)에 기록했다. 본 검증 PASS는 정책 승인·제품 구현·모델 품질·배포 준비 완료를 뜻하지 않는다.

## #81 요구사항 추적

| 요구 | 검토·산출물 | 검증/한계 |
| --- | --- | --- |
| Git 준비·실제Issue/댓글·PR80·최신main | 결정안 §1, Git fetch/ls-remote, GitHub API | detached/clean 시작, 동일 작업브랜치 없음, PR80 merged/Issue81 open·댓글0 확인 |
| P1 leftAt/returnedAt·4초·탭/reload/SPA·창·재시작/시계·다른내용 | 결정안 §2~3, FE 보충 | revisit3999/4000·다른탭/대상/세대·음수시간 oracle. 실제 Chrome 미실행 |
| P2 A/B/C·열린후보·추출지연·순서/BE제약/라벨 | 결정안 §4, 공통 계약 §5 | 유효화 순 권장·v2 수신 watermark, replay/conflict/gap/역순 oracle. 현재 collector/IDB와 다른 동작 명시 |
| 전송후 민감·정정/삭제/무효화·파생처리 | 결정안 §4.1, PrivacyRetraction/RetractionAck | 회수 wire/늦은응답 차단 reference. 실제 저장소·캐시·Export·학습모델/백업 삭제 검증은 미실행 |
| P3 5초·최초5분·최종갱신·중복/지연/ACK/Worker·장기저장 | 결정안 §5, BehaviorPatch/Ack, FE/BE 보충 | 4999/5000,299999/300000, 늦은crossing·중복/stale/version 충돌·누적감소. 실제 타이머·quota 미실행 |
| P4 AI 구성/BE ID/저장·A/B/C·FK·cursor·복구 | 결정안 §6/9, CompositionRequest/Response | 1~5 입력·빈구간·tail·batch·번호공백·실제누락·역순·잘못된구성응답 oracle. DB transaction/CAS는 설계 검토 |
| AI request/response v2·누락/실패/중복·모델캐시 | 결정안 §2/6, AnalysisRequest/Response | positions/ID/hash pairing, request중복/순서·실패. 실제 추론/학습·재시작 미실행 |
| P5 우선순위/suffix·state 이력/재판단·알림 | 결정안 §7, WindowState/CurrentDecision/StatusResponse | 216조합·최신관련 우선·같은Window변경/중복·역순/과거DRIFT/종료후/FAILED후응답·알림최신성/간격 reference |
| P6 20목표·10명·160/시나리오40·>=10방문·>=1200Window·자연20~40·3인·12/4/4 | 결정안 §8, Manifest, 수집규격 §9 | 목표 유지·분할교집합 검증. 실제 수집량/품질 미측정 |
| 라벨/정적기준/UNJUDGEABLE·독립/합의·κ·유출방지/가명/동의 | 결정안 §8 | manifest형식·κ 산술4건. 실라벨·동의 승인·학교 규정 확인 미실행/BLOCKED |
| 공통API 타입·필수/null·UUID/timestamp/int/enum·오류진단 | contracts/v2/README 및 v2.schema.json | Draft2020-12+FormatChecker, 명명된30정의·74사례. schema-only와 관계검사를 분리 |
| API/DB·v1호환·신규migration 필요 | 결정안 §9, 공통 계약 §8, BE 보충 | V1~V10 FK/UNIQUE 읽기 대조. migration 적용·이관 미실행 |
| 승인·후속 구현 분리 | 결정안 각표·§10~11, 각기능 보충 | P1~P6 담당/상태·승인링크 없음 확인, 후속Issue 자동 생성 없음 |
| 변경 범위·링크·정합성 | 아래 정적 검사 | 문서/계약자료만, 기존 기능ID 보존, 링크/fence 검사 |

## 실제 실행한 검증

실행 환경: macOS, Python 3.11 임시 venv, `jsonschema[format]==4.26.0`. 제품 requirements/package/Gradle 의존성을 변경하지 않았다.

```sh
python3 -m venv /private/tmp/focus81-validator
/private/tmp/focus81-validator/bin/python -m pip install 'jsonschema[format]==4.26.0'
/private/tmp/focus81-validator/bin/python docs/contracts/v2/validate.py
```

최종 결과:

```text
PASS: Draft 2020-12, 30 definitions, 74 schema cases, 82 reference scenarios, 216 rule combinations, 4 kappa checks
LIMIT: reference contract checks only; no FE/BE/AI product, DB, Chrome, or model execution.
```

- Schema 자체와 30개 `$defs`에 meta-schema 검증. uuid/date-time FormatChecker를 활성화하고 UTC millisecond pattern을 별도 검사했다.
- 74개 schema-cases는 expected.valid/keyword와 실제 validation 결과를 대조했다. 정상뿐 아니라 필수 누락·null 오류·UUID 버전·존재하지 않는 날짜·timezone/정밀도·문자열 숫자/bool/소수·음수·safe integer/int32 상한·본문 5000/5001 Unicode code points·추가필드·정확한 EXTRACTION_FAILED를 검증했다. invalid Fixture가 거절되면 의도대로 통과한 것이다.
- 82개 scenarios는 실제 executable reference model의 반환값을 expected와 비교했다. 1~2개 대기,3~5개 sliding size3/stride1, 번호공백과 방문누락 차이, 구성 replay/ID충돌·tail·잘못된구성응답, POST 원본/행동분리, PATCH stale/중복/버전충돌, AI ID/hash/position 관계, 같은Window NORMAL→DRIFT, 역순/종료후/무효화후/실패확정후 응답, 기존 알림 최소간격과 연속DRIFT, goal split 유출을 포함한다.
- state flow oracle의 alertEligible는 모델 내 현재상태 자격만 검사한다. 별도 alert-policy 시나리오에서 최신Window/version·ACTIVE·shown·뒤Window 복귀·간격 경계를 검사한다. 간격 Fixture의60000은 **합성 설정 입력**이며 운영 최소간격의 권장값이 아니다.
- 216개 판단 규칙 조합은 세 페이지 라벨27가지×5분 경계8가지다. 규칙 구현과 독립 조건식으로 비교했다. κ는 완전일치·불일치·표본0·분모0 네 건을 검사한다.
- 초기 검증에서 nullable union 오류 keyword가 type 대신 anyOf로 보고되는 Fixture 기대 오류를 발견했다. 새 문서용 Fixture의 keyword를 실제 Draft2020-12 구조에 맞춰 수정했고 전체를 재실행했다. 기존 제품 테스트 기대값은 변경하지 않았다.

Schema만으로 동적 cursor/ID pairing·DB FK·권한·삭제 완료·실제 Chrome 타이머를 검증할 수 없다. `validate.py`는 제안 정책의 oracle이며 제품 서비스와 비교한 통합테스트가 아니다. 주석·설명만 있는 후속 체크리스트를 실행 PASS에 포함하지 않는다.

## 실제 실행한 정적·교차 검사

- `git diff --check`: 공백 오류 없음.
- 기준 main과 변경 경로를 대조: 기존 문서 7개 수정, 결정 문서1개와 계약 패키지5개 신규, 총13개. 경로는 모두 docs 아래다. 제품 소스·기존 테스트·의존성·Flyway 변경 없음.
- 임시 Python 검사로 변경 Markdown의 상대 파일/anchor 링크, code fence 짝, FE-001~010/BE-001~009/AI-001~003 보존 확인. project-plan의 기존 PDF 링크는 대상 파일이 저장소에 없어 '원문 미포함' 설명으로 바꿨다. 없는 파일을 정상 링크로 보고하지 않는다.
- 각 기능 명세가 같은 Schema 패키지를 참조하는지, v2 분석에 행동값/사람 정답이 섞이지 않는지, searchQuery의 null/검색 분기·상태실패 null·진단오탈자가 일치하는지 검토했다. status/alert Schema는 기존 DTO 전체가 아니라 v2 projection이라는 적용 범위를 명시했다.
- V3 Window 멤버 FK와 session/index·size/end UNIQUE, V4 Window NOT NULL FK·Window당 분석 UNIQUE, V6/V7 analysisId 중심 알림키, V8~V10 보존 대상을 원문과 대조했다. 현재 불가능한 Window 전 분석행 저장·단순 visit 삭제·같은analysis의 여러state 후보를 구현된 기능으로 쓰지 않았다.

## 실행하지 않은 검증과 승인 선결

FE Vitest·typecheck·build·Playwright·실제 Chrome/Windows, BE Gradle·API/MySQL 통합, AI 모델 로드·추론·학습·benchmark, Flyway 적용·데이터 이관, 실제 개인정보/동의·삭제·백업·Export 회수를 실행하지 않았다. 제품 코드 변경이 없어 기존 전체 테스트를 반복하지 않았다. 과거 검증 보고서의 Google CAPTCHA/서비스 DOM/권한 전체행렬 한계도 이번에 해결했다고 주장하지 않는다.

팀은 P1 대상 동일성/시계, P2 순서/조기 회수, P3 checkpoint·정리, P4 batch·lease·timeout/두 단계, P5 이력·알림 reset, P6 reference snapshot·κ·보존/동의 절차를 승인해야 한다. 특히 개인정보 처리 수단 없는 조기 전송과 근거 없는 보존기간 확정은 활성화할 수 없다. 구현/수집 승인과 PR 문서 검토를 구분한다.
