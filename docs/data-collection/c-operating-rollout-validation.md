# PR 120 재검증과 C 운영 수집 결과

2026-11-14 KST. **SUCCESS — 기존 C 운영 환경에서 실제 Chrome MV3의 10 Visit 생성·IndexedDB 저장·POST/PATCH ACK·MySQL 저장·정상 종료·RAW_COLLECTED를 확인했다.** 사용자가 직접 인증·세션 시작을 수행하고 공개 문서 탐색을 Codex에 위임했다. 이 결과는 운영 수집 경로 검증이며 사람의 자연스러운 탐색 학습 표본으로 확정하지 않는다. 첫 실패와 후속 성공은 별도 Session/Attempt 및 증거로 보존한다. 운영 Export·PR 병합·Issue 종료는 하지 않았다.

## 1. 작업 결과와 근본 원인

- 실제 C의 첫 새 시도는 공개 GitHub Docs가 `/ko/pages/...`로 전환된 뒤 Visit0·SENSITIVE_CONTENT로 실패했다. 기존 예외가 공개 설문 `survey-token`을 영문 `/en/pages`에서만 허용한 것이 원인이다. 독립 Chrome157 EN/KO DOM과 수정 전 번역8개 FAIL로 재현한 뒤 공식9개 언어의 같은 `/pages` 경계만 허용하도록 고쳤다. 다른 Token·비밀번호·카드·SSN 마커, 입력값 미접근, 고위험 텍스트 차단은 유지했다.
- 대규모 DOM의 중복 조상 가시성 검사는 실제 50,030 요소에서 3,202ms를 재현해 선형 순회로 고쳤다. 같은 Chrome151에서320.9ms, Chrome157 독립 프로필에서302.6ms로 개선됐다. 과거 PLAN-003의 정확한 Visit0 트리거였다고 단정하지 않는다.
- 최초 운영 반영에서 Codex가 Chrome 재시작 뒤 명시적 확장 새로고침을 먼저 수행하지 않아 구 Worker가 남았다. 실제 상태 응답의 새 진단 필드 부재로 확인하고 동일 확장을 새로고침·사용자 재인증해 바로잡았다. 이후 반영에서는 새로고침 완료와 실제 실행 화면을 확인한 뒤 시작했다.
- Issue112의 전경 탭 수정과 PR118의 FE/BE 카드 검사 수정은 기존 구현을 보존했다. C의 실제 구 JAR `e088f03`에는 PR118 BE 수정이 없어 1차 승인 때 검증된 `0941d50`으로 정합화했다. 기존의 오래된 PLAN-003 격리 사유 전체는 재현하지 못했으며 추측으로 CLEAR 처리하지 않았다.

## 2. 코드 상태와 영향

작업 브랜치는 `fix/119/collection-reliability`, 최종 실행 FE 코드는 `21826627b7f067465585b9dfec4f07055616a067`이다. 후속 커밋은 보고서다. PR120은 Ready for review/open·미병합, Issue119는 open으로 유지한다. 확인 당시 main은 `ff15a90bb9ce389b32a75dd57806ed7e215ddb48`, CI/check와 review는0이며 로컬 검증을 CI PASS로 표기하지 않는다.

공식 main 대비 변경 파일과 역할은 다음과 같다.

|범위|파일|변경 목적|
|---|---|---|
|FE 수집|`fe/real/content.ts`, `fe/src/content/extraction.ts`, `fe/src/v2/browser.ts`|입력 포커스/고위험 신호 분리, 공개 본문·성능·locale 결함, 전경/관찰/연결 진단|
|FE 화면|`fe/participant/index.tsx`, `fe/src/v2/local-status.ts`|Gate와 실제 ACTIVE 구분, 고정 진단 코드·복구 안내|
|FE 회귀|`fe/tests/extraction-performance.test.ts`, `fe/tests/localized-public-documents.test.ts`, `fe/tests/privacy-parity.test.ts`, `fe/tests/real-browser-foreground.test.ts`, `fe/tests/real-content-lifecycle.test.ts`, `fe/tests/v2-collector.test.ts`|수정 전 실패 재현 및 성능·프라이버시·포커스·SPA·늦은 응답·체류 경계 검증|
|실제 브라우저 도구|`fe/scripts/content-performance-test.mjs`, `fe/scripts/local-https-browser-test.mjs`, `fe/scripts/raw-browser-test.mjs`|실제 DOM 비용, 공식 번역 문서, 장애·재시작·ACK 유실 경계|
|AI·공통 계약|`ai/training/raw_review.py`, `ai/tests/test_raw_review.py`, `docs/contracts/v2/fixtures/privacy-text.json`, `be/src/test/java/com/focusrecovery/domain/collection/MetadataPageTest.java`|일반 카드 설명과 실제 번호의 FE/BE/AI 판정 일치, 실제 위험·연락처 처리 유지|
|로컬/E2E|`deploy/individual-local/compose.yml`, `tools/individual-local/run-external-site-e2e.py`, `tools/individual-local/run-synthetic-e2e.py`|안전한 MySQL 종료 계약, 독립 공개 문서·실패 Queue 복구 반복|
|보고서|`docs/data-collection/collection-reliability-validation.md`, 이 문서|전체 경로·재현·실패·승인·검증 결과|

5초 체류·4초 복귀·1.5초 관찰 간격·본문 최소 길이, 불변 Visit ID·sequence·멱등 계약, IndexedDB format2와 DB migration18은 유지한다. 최종 locale 추가 반영에는 BE/AI/스키마 source 변경이 없어 FE8개 파일만 교체했다. 기존 v1 Window5 학습기는 변경하지 않았다. 현 v2 원본 검수는 Window3/Stride1이며 사람 라벨·실제 모델 학습은 별도 작업이다.

## 3. 운영 반영 결과

|대상|최종 확인|
|---|---|
|운영 브랜치|`ops/c-pr120-localized-20261114` / `2182662`. 이전 `ops/c-pr120-20261113` / `0941d50`, `ops/c-foreground-rollout-20261113` / `432959e` 보존|
|실제 FE|기존 `fe/dist-real` 절대 경로, source2182662/dirty=false, Content Script SHA256 `23df48f13f51bdc89cd292a308d393dc0e6a96ffbd1f638f7f64ed5028f6512c`. 독립3회와 동일|
|실제 BE|JAR source0941d50, Java21/PID93492. 1차 승인 때만 정상 재시작했고 locale 추가 적용 때는 재시작 없음. BE main source는 FE2182662와 동일|
|Chrome·프로필|157.0.8103.51/macOS27.2 arm64, `/Users/hyeon/Library/Application Support/Google/Chrome/Default`를 종료 검증 후에도 직접 확인|
|Extension|ID `aocfmndihdfimoocmdafcbkgifbpdhbl`, `/Users/hyeon/Project/2026-2-Capstone-T01-focus-recovery/fe/dist-real` 유지. 삭제/재설치·권한 확대 없음|
|정책·Gate|focus-team-raw-v2/6, RAW_ONLY, focus-page-content-v6, Plan revision1, SHA `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982` 유지. 기존 동의·Credential 사용|
|DB·Volume|mysql8.4, `focus-local-cddfab90d1f8-mysql-1` / `focus-local-cddfab90d1f8_local-db`. 컨테이너 ID·StartedAt·마운트 불변, restartCount0, schema18|
|영속 데이터|IndexedDB format2·Queue 유지. 종료 후 local10/POST ACK10/PATCH ACK10/pending0, END ACK acked를 실제 readonly transaction으로 확인|
|사용자 파일|미추적 `team-data-collection-manual.pdf` SHA 불변. 설정·인증서·기존 브랜치·backup/key 보존|

백업은 승인된 두 시점에 age 암호화했다. 실제 복호화·network=none/포트0/tmpfs MySQL의37개 테이블·FK50개 복구 검증 PASS. 운영 DB/프로필을 복원하지 않았다. 프로필 파일14개·LevelDB 참조 무결성은 PASS이나 **실제 Chrome 논리 복원은 NOT_TESTED**다. 백업 시점은 수집 전이며 이번10 Visit의 수집 후 새 스냅샷은 실행하지 않았다. 실패 시 수집/전송 상태를 먼저 확인하고 FE/JAR를 검증본으로 되돌릴 수 있으나 DB·프로필 자동 덮어쓰기는 하지 않는다. 특히 구 BE e088f03의 카드 판정으로 되돌리면 ACK 재전송도 거절될 수 있다. 추가 배포·백업/복구·새 동의·세션·Export·병합에는 해당 사용자 승인 경계를 계속 적용한다.

## 4. 실제 C 재시도 1→10 Visit

사용자가 직접 기존 파일로 인증·PLAN-003 새 세션을 시작했다. Codex가 위임받은 공개 GitHub Pages 배포·도메인·HTTPS 문서10개를 실제 Chrome 전경 탭에서 탐색했다. Content Script의 실제 측정값만 사용했으며 시간을 조작하거나 Visit/본문을 만들지 않았다.

|단계|로컬 Visit|서버 ACK Visit|실제 서버 저장|Pending|상태|결과|
|---|---:|---:|---:|---:|---|---|
|시작|0|0|0|0|ACTIVE/CLEAR, 관찰 허용|PASS|
|1 Visit|1|1|1|0|ACTIVE/CLEAR|PASS|
|5 Visit|5|5|5|0|ACTIVE/CLEAR|PASS|
|10 Visit|10|10|10|0|ACTIVE/CLEAR|PASS|
|종료|10|10|10|0|ENDED/CLEAR, END ACK acked|PASS|

POST와 PATCH는 각각10개 ACK를 확인했다. 1/5/10/종료 단계에서 IndexedDB의 불변 Visit ID+sequence 지문과 MySQL 지문을 대조했고 최초 ID들을 그대로 유지했다. 마지막 지문은 `96af8fdd768ab7bbd0c2d1a2684b3288929a4c231561417fb21acbef60ac5c1c`다. 실제 최종 활성 체류는22.690~94.622초, 제목25~48자·본문1227~5000자, extraction SUCCESS10개, sequence1~10, 중복ID0·순서 충돌0이다.

## 5. 데이터 품질과 이력 보존

- Session ENDED, privacy CLEAR, END ACK acked, 전달 확인 true, RAW_COLLECTED, 유효 Visit10·referencesValid=true·RAW 사유0. 실제 AI Window0, AI NOT_RUN, 이론상 검수 Window8이다. 화면의 AI 포함 품질 미완료/일반 RECOLLECT_REQUIRED 표시는 RAW_ONLY의 원본 수집 판정과 구분하며 AI Window나 라벨을 자동 생성하지 않았다.
- DB 내부 집계에서 HMAC page 식별자10개, normalized_url의 원문 query/fragment 저장0, 길이·체류·PATCH version 계약10개 PASS, 미마스킹 이메일/국내 전화 패턴0을 확인했다. 원문·URL·입력값·Credential·HMAC key를 진단 로그에 출력하지 않았다. 이 집계는 사람의 개인정보 검수를 대체하지 않는다.
- 전체 Session8·Attempt8·물리Visit11·Consent1·Retraction3·Tombstone3이다. 과거 물리Visit1과 실패7개 Attempt는 보존했다. 승인된 추가 백업을 격리 메모리 DB에 복원해37개 테이블의 기존284개 행을 해시 비교했다. 불변 필드/행 삭제0, 예상 밖 변경0이다. 새 행은 Session1·Attempt1·scope1·Visit10·공식 재수집 audit1뿐이며 기존 실패 Attempt의 review/reason 변경은 승인된 USER_REQUEST만 허용했다.
- 최초 전체 행 비교는 과거 회수 작업의 재시도 카운터 때문에 FAIL했다. 컬럼별 진단은 privacy_retraction의 attempts와 retraction_target의 attempts/next_attempt_at만 차이임을 확인했다. Worker 소유 가변 필드를 코드의 수명주기 계약으로 분리하고 불변 요청·대상·원본·Consent·Tombstone을 엄격히 대조했다. 카운터30행이 후퇴하지 않은 것도 확인했다. 최초 FAIL/진단/최종 계약 검증을 모두 별도 보존했으며 운영 행을 바꾸지 않았다.
- 운영 Export audit0, 실제 C Export/Import/AI 검수는 **NOT_TESTED·미승인**이다. 사용자 직접 시작+Codex 자동 탐색이라는 출처를 보존하며 연구용 사람 행동 표본 채택은 별도 검토해야 한다.

## 6. 테스트 결과와 증거

|범위|최종 결과|
|---|---|
|FE|1,020 PASS, TypeScript·공식 real build/package PASS. 기본 runner의 기존 opt-in HTTP2개는 BE 실제 서버 통합에서 별도 PASS. 추가 SKIP/조건 완화 없음|
|BE·MySQL|58 classes/1,148 PASS, FAIL/ERROR/SKIP0. 실제 MySQL·HTTP·브라우저·MOCK FastAPI fixture 실행|
|AI·도구|AI276 PASS, 로컬/데이터셋42 PASS, 회수5 PASS. 공통 개인정보 fixture PASS|
|독립 실제 MV3 반복|신규3환경×10 Visit, CFT151·실제 Content Script/Spring/MySQL. locale·Worker/Chrome 재시작·재인증·종료 ACK·RAW 품질 PASS. 동일 Content Script SHA가 실제 C와 일치|
|장애/개인정보 회귀|기존 신규3회×10 Visit에서 실제 POST 실패 Queue·ACK 유실·같은 ID 재전송·포커스/해제·SPA·늦은 응답·5초/4초 경계·MySQL/서버 재시작·격리/회수/재수집 PASS. locale 수정은 이 전송/저장 코드를 변경하지 않음|
|독립 Export/Import/검수|신규3세션30 Visit24 무라벨 Window PASS, 중복 Import3 거부|
|실제 C Chrome157 MV3|수정 전 첫 시도 FAIL(Visit0/격리) 보존 → 수정 후 새 Session에서10 Visit·END ACK·RAW_COLLECTED PASS|
|실제 C 장애 주입|수집 후 네트워크 단절/Worker·브라우저 재시작을 운영 데이터에 강제로 주입하지 않음: NOT_TESTED. 해당 경계는 위 독립 환경에서 PASS|

이전 일반 Chrome157 CLI 확장 로드 실패3건, 새 E2E 준비/도메인 assertion 실패, 실제 C 최초 격리는 모두 보존한다. 성공 재실행으로 실패를 덮어쓰지 않았다. 상세 수량/실측치/ID 지문은 비공개 `/private/tmp/focus120-final-check/c-operating-final-summary.json`, `c-retry-session-*.json`, `c-retry-idb-*.json`, `c-final-storage-contracts.json`, `c-historical-contract-preservation.json`, `localized-final-test-summary.json`에 있다. 원문·키·프로필·DB/Export는 Git에 포함하지 않는다.

## 7. 미해결 사항과 다음 조치

|항목|확인 사실·영향·대응|
|---|---|
|기존 AI 회수 전파3건|AI_CACHE_AND_MEMORY target은 FAILED/PROPAGATION_UNCONFIRMED. 코드상 미확인 ACK가 재시도 횟수/시각을 갱신하며 요청/격리/Tombstone은 유지한다. 외부 ACK 미수신의 구체적 운영 원인은 미확정이다. 과거 외부 사본/메모리 회수 완료를 주장하지 않으며 임의 VERIFIED/CLEAR 처리나 재시도 비활성화는 하지 않는다. 책임자의 전파 endpoint·외부 증거 확인이 별도 필요하다. 신규 세션에는 Retraction/Tombstone0이며 정상 CLEAR다.|
|연구용 데이터 채택|이번 C10개는 사용자 동의/시작과 Codex 위임 탐색으로 얻은 운영 검증 데이터다. 자연스러운 사람 행동·정답 라벨로 간주하지 않는다. Export/사람 검수/라벨링·후속 학습은 사용자 검토와 별도 승인 후 수행한다.|
|브라우저·외부 구조|실제 C Chrome157/macOS27.2, 독립 CFT151 검증 범위다. 다른 OS/브라우저와 Google 정상 검색 결과는 NOT_TESTED(기존 CAPTCHA 우회 안 함). 외부 DOM 변화는 진단 코드로 재확인해야 한다. 과거 PLAN-003의 모든 트리거를 재현한 것은 아니다.|
|복구·백업|Chrome 논리 복원과 수집 후 최신 백업은 NOT_TESTED/미실행이다. 기존 암호화 백업은 수집 전 시점이다. 운영 데이터/프로필 자동 복원은 하지 않으며 필요 시 새 승인으로 현 상태를 백업·격리 검증한다.|
|AI 학습 범위|v2 Window3/Stride1 검수와 무라벨 분리까지 지원한다. 실제 AI 실행·사람 라벨·v2 학습기/평가는 수행하지 않았으며 v1 Window5 학습기는 유지한다.|
|화면·리뷰|검증 후 Mac이 잠겨 마지막 수집 화면 복귀는 수행하지 못했다. 정상 종료 ACK와 Default 프로필 확인은 잠금 전에 완료했다. PR120 미병합·Issue119 open 상태로 사용자 검토를 기다린다.|

## 이전 검증·승인·최초 실패 이력 (보존)

## 코드와 PR 기준

재확인 당시 PR #120은 Draft/open, HEAD `ba3e20c0f5d923ea5dc61fd93b912ff33d10b71e`, 공식 main `ff15a90bb9ce389b32a75dd57806ed7e215ddb48`이다. mergeable=true, CI/check 0, review/review thread 0. PR #118은 ancestry에 포함된다. 작업 트리는 clean이었다. 운영 `ops/c-foreground-rollout-20261113`과 미추적 PDF는 보존한다.

추가 결함은 독립 `fix/119/dom-observation-performance`의 `77cb8f9`에서 수정한 뒤 PR #120에 반영했다. 1차 코드 후보는 `0941d50f035165780f27d12e4ced359f202e859b`이다. 이후 보고서 커밋을 포함한 당시 PR HEAD는 `a44968ba60471da2f9bcf17e3f351e682b269a99`이며 Ready for review/open, 미병합 상태였다.

## 추가 성능 결함과 수정

`textFrom()`이 매 노드에서 `isVisible()`로 모든 조상을 다시 검사하므로 O(노드 수×깊이) style 조회가 발생했다. `real/content.ts`도 같은 pulse에서 layout 검사를 중복했다.

- 수정 전 실패: `extraction-performance.test.ts`의 선형 조회 수 검증 FAIL. 독립 Chrome 151에서 24단계 중첩·50,030 요소의 실제 검사 경로가 3,202ms/5,701,506 style 조회. 1.5초 관찰 예산을 초과한다. 과거 C Visit 0의 직접 트리거였다고 확정하지는 않는다.
- 수정: 루트에서 조상을 확인하고 동기 순회 중 하위 노드의 가시성은 한 번씩 확인한다. pulse 간 visibility cache를 두지 않는다. Content Script의 동일 pulse layout 판정을 재사용한다. 추출 함수의 독립 보호 검사·폼/숨김 제외·고위험 검사·본문 길이·5초·4초·1.5초 기준은 유지한다.
- 동일 Chrome 151 검사: 320.9ms/200,108 style 조회. 운영과 같은 Chrome 157.0.8103.51을 **새 독립 프로필**로 실행한 검사: 302.6ms. 동일 50,030 요소, 안전 판정/추출 성공. 실제 운영 프로필을 성능 시험에 사용하지 않았다.
- 변경 파일: `fe/src/content/extraction.ts`, `fe/real/content.ts`, `fe/tests/extraction-performance.test.ts`, `fe/scripts/content-performance-test.mjs`, `fe/scripts/raw-browser-test.mjs`.

## 재실행한 테스트

|항목|결과|
|---|---|
|기존 HEAD FE baseline|998 PASS, opt-in HTTP 2개는 별도 실제 서버 통합에서 실행|
|수정 후 FE 전체·TypeScript·real 빌드|1,000 PASS, 타입·공식 v6 빌드 PASS. HTTP 2개는 BE 실제 실행에서 PASS. 기존 skip 조건을 추가/완화하지 않음|
|BE 전체·실제 MySQL·HTTP/브라우저|58 classes / 1,148 PASS, FAIL/ERROR/SKIP 0. 새 회귀 스키마와 MOCK 모델 fixture를 사용하고 실제 수집 증거와 구분|
|AI 개인정보/검수|276 PASS, deprecation 경고1. 공통 개인정보 fixture 포함|
|로컬/Export/Import·회수 도구|42+5 PASS|
|합성 대규모 DOM|수정 전 FAIL → 동일 테스트 PASS, Chrome151/157 각각 실행|
|실제 MV3 개인정보/재수집 재검증|신규 합성 Source의 v5→v6·0/N Visit 격리·회수·마감 ACK·재수집·기사 마스킹 PASS. 기존10 Visit 보존, 최종23 물리 Visit/21 Export, 적격 학습 검수20 Visit/16 Window. 실제 C 데이터와 구분|

신규 MV3 3회와 공식 정책 공개 사이트 3회는 각각 별도 신규 프로필·Source·Participant·MySQL Volume으로 다시 실행해 모두 PASS했다. 각10 Visit/총30, ENDED/CLEAR·pending0·END ACK acked·RAW_COLLECTED/AI NOT_RUN을 확인했다. 공식 공개 사이트의 암호화 Export/Import/학습 검수는 3세션30 Visit24 Window PASS다.

`raw-browser-test.mjs`의 9번째 페이지는 20,000개 이상 요소를 실제로 렌더링하고 Content Script 관찰 도착 간격을 측정한다. A/B/C 각각7회 관찰, 최대 간격 1222.2/1110.8/1118.5ms로 1.5초 이하 PASS다. 시간은 조작하지 않았다. 실제 POST 실패 후 동일 Queue ID Worker 복구, Chrome 재시작/재인증, 확장 재로드/기존 탭 새로고침, 포커스 제외/해제, 지연 DOM/SPA/재방문/탭 전환과 POST/PATCH/END ACK 유실도 모두 PASS다. 이후 MySQL/서버 재시작과 철회·중복 Import/재유입 거부도 PASS다.

세 MV3 빌드는 sourceCommit `77cb8f9`이다. A의 dirty=true는 추가 보고서 작업이 있던 상태이며 B/C는 false였다. 세 번의 Content Script SHA256은 모두 `2eb44729cf48f1e38279ddabf446e1a14385057e9de624b2979d79207362e5b3`로 동일하다. 수정 코드 이후 변경은 보고서뿐이며 운영 후보를 별도 최종 staging으로 빌드해 다시 대조한다.

## C 운영 읽기 전용 확인

|대상|확인 결과|
|---|---|
|운영 디렉터리/브랜치|`/Users/hyeon/Project/2026-2-Capstone-T01-focus-recovery`, `ops/c-foreground-rollout-20261113`, `432959e`|
|사용자 파일|미추적 `team-data-collection-manual.pdf` 유지. 설정·기존 bundle/JAR/PDF 13개 파일 SHA를 비공개 증거에 기록|
|실제 Chrome|157.0.8103.51 / macOS27.2 / arm64 / Default|
|프로필|`/Users/hyeon/Library/Application Support/Google/Chrome/Default` — Chrome 버전 화면에서 확인|
|Extension|`aocfmndihdfimoocmdafcbkgifbpdhbl`, 0.4.0, 사용 설정됨, 모든 사이트 접근|
|실제 로드 경로|`/Users/hyeon/Project/2026-2-Capstone-T01-focus-recovery/fe/dist-real` — 확장 세부정보에서 확인|
|운영 FE build-info|sourceCommit `432959e`, dirty=true, real-collection, pageContent=true. 당시 PDF 등의 untracked 상태와 dirty 사유는 구분하며 bundle의 실제 파일 해시를 보존|
|운영 BE 프로세스|PID75957, `.collection/local/backend-runtime.jar`를 실행 중|
|실행 JAR의 실제 버전|build-info `e088f03780b76404e4bba17138670e40d47600d8`. SHA256 `62634a56fb0004b685944e968120a77088bec6c9e94470c6ace53e2b4842b12d`. Git HEAD/FE보다 이전 버전이며 PR118 BE 카드 검출 미반영|
|API/TLS|`https://localhost:9443`, CA를 검증한 health200. localhost 인증서 유효기간 2026-11-12~2027-02-10|
|정책|focus-team-raw-v2/6, RAW_ONLY, focus-page-content-v6, Plan revision1, SHA `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982` 일치|
|인증·동의|기존 Credential의 GET 조회만 사용. consentValid=true/collectionEnabled=true/withdrawn=false, C ready=true/blocker0/배정53. 새 동의·세션은 생성하지 않음|
|DB|`focus-local-cddfab90d1f8-mysql-1`, mysql8.4, healthy, 127.0.0.1:33101|
|Volume|`focus-local-cddfab90d1f8_local-db`, `/var/lib/mysql`. 교체/재시작 없음|
|스키마·기록 수|migration18, Session6, PageVisit1, Attempt6, Consent1, Retraction3, Tombstone3. SELECT/ROLLBACK만 실행|
|PLAN-003|6 Attempt 모두 ENDED·RECOLLECT_REQUIRED. 5개 QUARANTINED/1개 CLEAR. 격리 세션의 과거 물리 Visit1건 보존, 현재 유효 RAW0. 이전 PENDING 설명과 현재 상태를 혼동하지 않음|
|IndexedDB/Queue/로컬 END ACK|파일 수준 IndexedDB 검사는 macOS EPERM으로 NOT_VERIFIED. 이후 사용자가 **상태 화면 열기만 승인**하여 기존 Worker를 깨워 UI 확인: ENDED, 서버 수신0, 미완료 POST/PATCH0, 알림 대기0, 격리 마감 완료. 정상 END ACK는 `—`이며 격리 마감 ACK와 구분한다. 새 동의·세션·재수집·Export·재로드는 실행하지 않음|

GET `/api/collection/progress`와 파일 해시 등의 원문 없는 증거는 `/private/tmp/focus120-final-check`(0700)에 둔다. Source/Participant의 식별값·Credential·제목/본문/검색어는 보고서/로그에 출력하지 않는다. 초기 읽기 전용 SQL에서 존재하지 않는 `quarantine_reason` 컬럼 조회가 실패했으며, 마이그레이션 확인 후 올바른 컬럼으로 재조회했다. DB 변경은 없었다.

## 승인 후 수행할 백업과 복구 검증

사용자가 아래 백업·격리 복구 검증만 승인했다. 실제 C API Export·FE 교체·BE 재시작·새 세션/동의·PR 병합은 포함하지 않는다.

- 백업 디렉터리: 기존 C의 `.collection/rollout-backups/PR120-20261113-phase1`, 0700. age 키는 기존 0600 파일에 유지하고 내용은 출력/복사하지 않는다.
- `database.sql.age`와 `operating-files.tar.age` 생성, 0600. DB dump/파일 tar의 평문은 메모리에서 age로 보내고 평문 백업 파일은 남기지 않았다. 원래 bundle/JAR/config/participant/owner/secrets/TLS를 보존했다.
- 실제 복호화 PASS. 새 `focus120-c-restore-9f7d07134c93`의 **network=none/host port0/DB tmpfs**에서 실제 백업을 복구했다. 37개 테이블의 행 수·checksum 일치, FK50개 참조 오류0, 운영 원본 전후 불변 PASS. 검증 후 테스트 컨테이너만 정상 종료했다. 운영 MySQL/Volume은 재시작/복원하지 않았다.
- 운영 파일 archive26개 항목을 메모리에서 검증했고 source의 13개 파일 SHA는 불변이다. 세부 checksum·테이블 수량은 백업 디렉터리의 manifest/restore-validation.json에 보호된 상태로 보존한다.
- 사용자가 Chrome 정상 종료/Terminal 실행을 위임해 수집 중지·Queue0 상태를 재확인한 뒤 Chrome 메뉴로 정상 종료했다. 강제 종료는 사용하지 않았다. 이후 Computer Use 도구가 `com.apple.Terminal` 자동 조작을 안전 사유로 거부했다. macOS의 Codex 프로필 접근 거부도 남아 있어 준비된 프로필 암호화 명령의 **사용자 직접 실행**을 요청했다. 다른 앱/프로세스로 제한을 우회하지 않는다.
- Chrome 정상 종료 후 동일 경로를 한 번 재확인해도 macOS EPERM이었다. 사용자 Terminal 실행도 EPERM으로 실패했다. 기존 실패 암호문 `chrome-profile.tar.age.partial`(10,440 bytes, SHA256 `54cbe78aab1c940b3a13840b0675c27e119bf4ed2ddc5d064a896086c51587f0`)은 보존하며 유효 백업으로 취급하지 않는다. 재실행은 noclobber에 의해 기존 partial 덮어쓰기가 거부되었다.
- private 백업 helper를 수정했다. 원본 읽기 사전 검사, xattr/ACL 제외, 시도별 고유 암호문, 인증 복호화 후에만 최종 파일 게시를 사용한다. 기존 실패 파일은 보존한다. 합성 자체 검증 4건(기존 partial 보존, 읽기 거부 시 출력 없음, tar 실패 시 고유 암호문 보존, 완료 파일 덮어쓰기 방지) PASS이며 실제 프로필 백업 성공과 구분한다.
- 사용자가 광범위한 접근 위험을 안내받은 뒤 Terminal의 **임시 전체 디스크 접근 권한**을 별도 승인하고 macOS 인증을 직접 완료했다. 시스템 설정에서 Terminal만 추가·ON으로 확인했으며 기존 다른 앱은 모두 OFF 상태를 유지했다. 사용자가 Terminal을 재시작하고 helper를 직접 실행했다. 검증 후 Terminal 권한을 OFF로 되돌리고 사용자가 완전히 종료했다. 실제 Terminal·Chrome 프로세스 부재를 확인했다. Codex나 다른 앱으로 프로필 접근 권한을 넓히지 않았다.
- 실제 `chrome-profile.tar.age` SHA256 `96f4860a1815c41d0a07c387ffd01b4df7d1013a4708d62078076cd649d9e68a`, 0600. 인증 복호화 PASS, 승인된 해당 확장의 IndexedDB/Local Extension Settings 범위만 포함, 파일14개/평문 총1,979,346 bytes의 tar 구조와 두 LevelDB CURRENT→MANIFEST 참조 PASS. 평문은 메모리에서만 검증했다. 기존 실패 암호문·DB/운영 파일 백업·운영13개 파일의 해시 불변을 재확인했다. `profile-validation.json`을 새 0600 파일로 보존했다.
- 실제 Chrome에 프로필을 복원해 열거나 Queue의 논리 내용을 비교하는 복구 검증은 **NOT_TESTED**다. 위 결과는 암호문 무결성·파일 구조 검증이다. 운영 프로필이나 Queue를 복원/변경하지 않았다.

프로필 백업과 전체 백업 검증이 끝나기 전에는 운영 후보를 적용하지 않는다. 남은 프로필 절차와 전체 검증 원칙은 다음과 같다.

1. 상태 화면 열기는 사용자 별도 승인을 받아 위와 같이 확인했다. 사용자가 새 동의·세션 없이 Chrome을 직접 종료한다. Codex는 Chrome을 임의 종료하지 않는다. 백업 직전에 Queue/ACK를 재확인하고 불명확한 상태에서 새 수집을 시작하지 않는다.
2. 실제 프로필의 확장 IndexedDB와 Local Extension Settings는 macOS 접근 허용이 필요하다. 사용자가 위와 같이 별도 승인한 Terminal 임시 권한으로 백업 명령을 직접 실행하고, 검증 후 권한을 해제한다. 다른 프로세스로 접근 제한을 우회하지 않는다.
3. 새 백업 디렉터리를 0700으로 생성한다. 기존 `.collection/backup-keys/C-20261113T122637-60ab9684/backup.agekey`(0600)를 이용하되 키를 복사/출력/Git 저장하지 않는다. 공개 recipient와 암호화 파일의 SHA를 확인한다.
4. 기존 Extension bundle, 실행 JAR, 운영 설정/정책/인증서와 필요한 비밀 파일, 확장 관련 프로필 영속 데이터만 암호화한다. 무관한 웹사이트 기록·Cookie·다른 확장 데이터는 수집하지 않는다. participant/owner 정보가 포함된 파일은 평문 결과물로 남기지 않는다.
5. 기존 MySQL에서 `--single-transaction --no-tablespaces --set-gtid-purged=OFF`의 일관된 schema dump를 메모리에서 age로 암호화한다. 기존 helper의 `backup`은 승인 후에만 사용한다. 운영 Volume/행/계정/정책을 바꾸지 않는다. 실제 API Export는 포함하지 않는다.
6. 복호화된 SQL은 별도 MySQL 테스트 컨테이너에만 스트리밍한다. 운영과 네트워크를 분리하고 포트를 공개하지 않으며 임시 메모리 DB를 사용한다. 스키마/PK·참조/전체 행 수와 Consent/Session/Attempt/Visit/Retraction/Tombstone/Export audit를 대조한다. 원문을 검증 로그로 출력하지 않는다. 운영 Volume으로 restore하지 않는다.
7. 백업·복호화·복구 검증이 모두 통과한 후에만 FE/BE 교체의 별도 승인을 요청한다. 프로필 접근 또는 Queue 검증이 막히면 교체하지 않는다.

## 승인 후 수행할 운영 교체

정확한 최종 SHA와 staging 파일 해시를 확정한 뒤 다시 승인받는다. 기존 C 브랜치를 변경/삭제하지 않고 새 운영 rollout 브랜치를 생성하는 방식을 제안한다. root의 PDF와 `.collection`은 보존한다.

준비된 후보는 `0941d50f035165780f27d12e4ced359f202e859b`(dirty=false)이다. BE SHA256은 `dc0a36cce8d87a8ae003c512ac4f6d58620dc8adabe6bee57b3e31b67d56a860`, Content Script는 검증한 세 MV3 실행과 같은 `2eb44729cf48f1e38279ddabf446e1a14385057e9de624b2979d79207362e5b3`다. 정책 SHA·권한은 동일하며 migration18개 SQL byte가 구버전과 같다. 공식 real packaging도 실행해 `checksums.json`까지 포함한 후보를 대조했다. 최초 packaging은 staging의 `dist-real` 부재로 FAIL했고, 검증된 후보를 staging에 복사한 다음 같은 공식 명령으로 PASS했다. 원본 코드/운영 파일은 변경하지 않았다.

교체 파일은 기존 `fe/dist-real` 아래 `build-info.json`, `background.js`, `manifest.json`, `participant.js`, `content.js`, `participant/index.html`, `assets/participant-ckjKSp79.css`, `checksums.json`과 기존 `.collection/local/backend-runtime.jar`다. Backend 프로세스 기록·로그는 정상 재시작 과정에서 갱신한다. 새 운영 브랜치에서 후보 커밋을 선택하면 tracked source29개도 해당 검증본으로 갱신되며, `compose.yml` 변경은 파일만 반영하고 MySQL 컨테이너 재생성에는 사용하지 않는다. 모든 실제 변경은 별도 승인 전 미실행이다.

- FE: 기존 `fe/dist-real` 절대 경로에 검증한 bundle만 반영한다. 새 경로에 별도 설치하지 않는다. 기존 Extension ID·Default·IndexedDB·HMAC key를 유지한다. Chrome 재개 후 사용자가 기존 확장을 새로고침하고 필요한 페이지를 새로고침한다.
- BE: 검증한 JAR를 같은 운영 runtime 경로로 교체하고 기존 nonce/PID 신원을 확인한 프로세스만 정상 종료·재시작한다. 동일 정책·TLS·Source·DB와 Volume을 사용한다. **`local.py stop`은 MySQL까지 중지하므로 BE만 재시작하는 승인에 사용하지 않는다.** MySQL/healthcheck 재생성은 이번 필수 변경에서 제외한다.
- 실행 후 FE/BE sourceCommit·파일 checksum·policy SHA·HTTPS·DB schema를 확인한다. runtime credential이 비워지면 사용자가 기존 Credential로 직접 재인증한다. 새 동의가 필요하면 사용자가 직접 수행한다.
- 실패 시 수집을 중지하고 변경 단계와 Queue·서버 상태를 비교한다. 이전 bundle/JAR를 복구할 수 있으나 DB/Chrome 프로필의 자동 덮어쓰기는 하지 않는다. 이미 수신된 Visit·Consent·Retraction은 바이너리 롤백으로 되돌아가지 않는다.
- 이전 BE `e088f03`은 일반 카드 설명문도 거절한다. 따라서 새 코드에서 허용한 Visit이 저장된 뒤 구버전으로 롤백하면 같은 ID의 ACK 복구도 판정 차이로 막힐 수 있다(검증이 replay보다 앞서는 코드 경로에 근거한 위험). 수집·Queue 상태를 확인하지 않은 자동 바이너리 롤백도 하지 않는다.
- 실제 세션 시작/재수집, 새로운 동의, 실제 Export, PR 병합은 각각 별도 승인을 받는다. 현재 PLAN-003을 CLEAR/ACTIVE로 바꾸지 않는다. 공식 새 Attempt 경로를 이용한다.

## 실제 C 단계별 수집 결과

### 승인된 운영 반영 결과

- 운영 새 브랜치 `ops/c-pr120-20261113`, HEAD `0941d50f035165780f27d12e4ced359f202e859b`. 기존 `ops/c-foreground-rollout-20261113`은 `432959e`로 보존했다. 미추적 PDF·설정·인증서 파일 불변, 작업 트리의 기존 untracked PDF 외 변경 없음.
- 기존 절대 경로의 FE8개 파일과 BE JAR를 검증된 후보로 반영해 SHA9개 일치 확인. nonce 확인한 이전 BE PID75957만 SIGTERM으로 정상 종료, Java21의 새 BE PID93492로 시작했다. 기존 로그에 이어 기록하며 동일 TLS·설정·정책을 사용한다. HTTPS health·기존 인증/동의 API PASS.
- 교체 직전과 직후 DB37개 테이블의 행 수·checksum 일치 검사를 통과했다. 후속 읽기 전용 검증에서도 전체 행 수·Collection Progress 불변. migration18, Session6·Attempt6·물리Visit1·Consent1·Retraction3·Tombstone3 보존. MySQL 컨테이너 ID·StartedAt·Volume·마운트 구성 불변, restartCount0.
- 최초 운영 검증 스크립트는 Docker `Mounts` 배열의 순서를 그대로 비교해 **FAIL**했다. 반복 inspect에서 같은 구성의 반환 순서 변동을 직접 재현했다. 항목의 모든 필드를 유지하고 Destination으로 정렬한 엄격 비교를 적용해 PASS. 순서 변경 허용·RW/Source 변경 거부·항목 누락 거부의 자체 검증4건 PASS다. 최초 FAIL JSON은 덮어쓰지 않고 후속 PASS JSON을 별도 보존했다. 후속 verifier의 첫 실행도 실제 JAR의 `META-INF/build-info.properties`를 잘못된 경로로 읽어 FAIL했고, 실제 패키지 경로 확인 후 PASS했다. 제품 결함이나 수집 성공으로 위장하지 않는다.
- Chrome을 정상 재개했다. 실제 버전157 Default 경로·기존 Extension ID·절대 로드 경로·모든 사이트 접근을 재확인했다. 수집 화면 실제 실행 빌드는 `0941d50f0351`, 기존 ENDED·격리 마감 완료·POST/PATCH0·로컬Visit0 상태를 유지한다. 재시작으로 runtime Credential이 비워져 사용자 직접 기존 파일 재인증을 요청했다. 새 동의·세션·재수집·Export는 하지 않았다.

### 실제 C 첫 실패와 추가 근본 원인

- 이후 사용자가 직접 기존 Credential로 재인증하고 PLAN-003 새 Session/Attempt를 시작했다. 기존6개 Attempt는 그대로 보존했다. Chrome 재시작만으로는 캐시된 구 Worker가 교체되지 않았다. 실제 `v2-status`는 ACTIVE/CLEAR·collectionAllowed=true·storageFailed=false였지만 새 collecting/diagnostic 필드가 없었다. 운영 절차에서 명시적 확장 새로고침을 먼저 수행하지 않은 부분을 바로잡았다. 기존 확장의 새로고침과 사용자 재인증 후 같은 Session이 ACTIVE·관찰 허용으로 복구됐다. 향후 재배포에서도 실제 Worker 응답까지 확인한 뒤 시작해야 한다.
- 사용자가 탐색을 위임한 후 실제 Chrome 전경에서 GitHub Pages 공개 문서를 열고 실제12초를 기다렸다. 수집 시간은 변경하지 않았다. 실제 URL이 `/ko/pages/getting-started-with-github-pages/what-is-github-pages`였으며 SENSITIVE_CONTENT로 격리됐다. DB/로컬Visit0, pending0, 서버 privacy=QUARANTINED. 최초 실패를 별도 `c-session-first-active.json`에 보존했다.
- `isSensitivePublicDocument()`가 GitHub Docs의 공개 설문 `survey-token` 마커를 `/en/pages`에서만 예외 처리했다. 같은 공식 한국어 문서의 마커도 인증 Token으로 취급해 조기 격리했다. 독립 Chrome157의 실제 EN/KO DOM probe에서 survey 마커 각각1개·기타 token0, 영문 sensitive=false/본문1940자, 한국어 sensitive=true/본문0으로 재현했다. 원문이나 입력값은 출력하지 않았다.
- 독립 `fix/119/localized-public-documents`에서 회귀 테스트20개를 먼저 추가해 번역 언어8개 FAIL/기존 영문 및 차단12개 PASS를 확인했다. 공식9개 언어의 동일 `/pages` 경로 경계로 예외를 제한하며 다른 경로·미확인 locale·진짜 Token/비밀번호/카드/SSN 마커 차단과 입력값 미접근을 유지한다. 수정 후 FE1020 PASS(기존 opt-in HTTP2개는 별도 서버 통합 대상), 같은 실제 EN/KO probe PASS·한국어 본문1227자 추출을 확인했다. 새 수정본의 운영 반영은 별도 승인 전이다.
- 실패 세션은 공식 ‘세션 종료·수집 중지’ 경로로 마감했다. ENDED/QUARANTINED·격리 마감 ACK 완료·Visit0·Retraction0/Tombstone0·AI NOT_RUN, 기존6개 Attempt 내용 불변을 확인했다. 기존 세션을 CLEAR로 바꾸거나 실패를 성공으로 처리하지 않았다. 현재 전체 Session/Attempt는 각각7개다.

### Locale 수정본의 전체 재검증

제품 수정 `2cfa175`, E2E 시나리오 검증 보완 `21826627b7f067465585b9dfec4f07055616a067`. [GitHub Docs 공식 언어 정의](https://github.com/github/docs/blob/main/src/languages/lib/languages.ts)의 en/es/ja/pt/zh/ru/fr/ko/de와 `/pages` 경계만 다룬다. API/동의/정책 SHA/BE/AI/저장 형식/스키마 변경은 없다.

|항목|결과|
|---|---|
|FE 전체|1,020 PASS. 기존 opt-in HTTP2개는 아래 실제 서버 통합에서 실행 PASS. 조건 완화/추가 SKIP 없음|
|TypeScript·공식 real build/package|PASS. 운영 후보는 clean `2182662`, API https://localhost:9443, v6 정책 SHA·Manifest 권한 불변|
|BE·실제 MySQL·HTTP/Chrome/MOCK FastAPI|58 classes / 1,148 PASS, FAIL/ERROR/SKIP0. 지원되는 Chrome for Testing151 사용|
|AI·로컬/데이터셋·회수 도구|276 PASS·42 PASS·5 PASS. AI deprecation 경고1. 텍스트 개인정보 규칙/공통 fixture 불변|
|독립 실제 공개 번역 문서 반복|새 Source/Participant/동의/프로필/MySQL Volume3개, 각10 Visit. 공식9개 언어+한국어 새 문서, 실제 active 최솟값 A5459/B5336/C5320ms. Worker·Chrome 재시작/재인증·탭 전환·제외 페이지 후 정상 종료, pending0·END ACK acked·RAW_COLLECTED·AI NOT_RUN PASS|
|독립 Export/Import/RAW 검수|3세션30 Visit24 무라벨 Window PASS, 중복 Import3 거부. 운영 C Export는 미실행|

세 MV3 실행의 Content Script SHA256은 `23df48f13f51bdc89cd292a308d393dc0e6a96ffbd1f638f7f64ed5028f6512c`로 clean 운영 후보와 동일하다. E2E worktree의 dirty=true는 top-level `node_modules` 의존성 링크만 untracked였기 때문이며 tracked 변경은 없었다. 운영 후보는 같은 설치 의존성을 실제 ignored 디렉터리로 복사해 dirty=false로 다시 빌드했고 정책·Manifest·source 검증을 완화하지 않았다. 기존 dirty 후보도 별도 보존했다.

새 테스트 경로의 최초 실패도 보존했다. `localized-external-repeat`는 새 worktree의 JAR 부재로 브라우저 실행 전 FAIL, `localized-external-ready`는 localized 시나리오에 기존 Python/Naver 도메인 집합을 적용한 테스트 도구 결함으로 FAIL했다. 후자는 시나리오별 정확한 도메인을 확인하도록 별도 커밋했으며 원래 공개 사이트 시나리오의 검사도 유지했다. `localized-be-regression`은 일반 Chrome157의 확장 CLI 미지원으로 1148개 중 브라우저 연동3개 FAIL/SKIP0이었다. [Chrome의 공식 변경 안내](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/my-groups)에 따라 지원되는 CFT151에서 전체를 새 스키마로 실행해 PASS했다. 실패 XML/로그는 성공 실행과 별도로 보존한다. 보안 기능을 다시 켜는 우회 플래그는 사용하지 않았다.

최종 독립 증거는 비공개 `localized-final-test-summary.json`·`localized-external-final/summary.json`·`localized-be-cft-pass-xml`에 있다. BE/AI/스키마는 `0941d50`과 source diff가 없어 추가 교체 대상은 FE8개 파일뿐이다.

### 승인된 locale 수정 운영 반영

2026-11-14 사용자가 추가 백업·FE 교체·이번 실패 Attempt의 공식 재수집 허용을 별도 승인했다.

- 기존 백업 하위의 새 `pre-localized-20261114`에 현 DB·운영 파일21개를 age 암호화했다. 이전 백업을 덮어쓰지 않았고 평문 파일은 만들지 않았다. DB SHA256 `c460c3f134dd700f3451ac44d6b415ff7a3a1abe472d1a6f15f7456444ff38a9`, 파일 archive `fd9099b1477e19c9175cd3ed25ddf46942d5c04cf51e9413199a3f3a4c9468ed`. network=none·포트0·tmpfs MySQL에서 실제 복호화/복구, 37개 테이블 행 수/checksum·FK50개·원본 불변 PASS. 운영 Volume 복원/재시작은 하지 않았다. Chrome 프로필 백업은 첫 반영 전 파일을 보존하며 이번에 새로 읽지 않았다. 실제 Chrome 논리 복원은 NOT_TESTED다.
- 이번 실패 Attempt에만 UI의 ‘본인 요청’/`USER_REQUEST`를 선택해 공식 재수집 허용 요청을 수행했다. reviewStatus PENDING→RECOLLECT_REQUIRED, 기존 ENDED/QUARANTINED·Visit0 유지, 이전6개 Attempt 내용 불변을 API/DB로 확인했다. 직접 SQL 상태 변경은 하지 않았다.
- 새 운영 브랜치 `ops/c-pr120-localized-20261114`, HEAD `21826627b7f067465585b9dfec4f07055616a067`에서 기존 FE 절대 경로의8개 파일만 반영했다. 두 이전 운영 브랜치는 그대로 보존했다. 전후 DB37개 테이블 전체 행 수/checksum, 기존 JAR/PID 기록·정책·설정·인증서·Credential·PDF7개 파일 SHA 불변, 같은 MySQL 컨테이너/StartedAt/마운트 불변 PASS. Backend/MySQL 재시작·스키마 변경·프로필/Queue 초기화 없음.
- Chrome의 동일 Extension ID/경로에서 명시적으로 새로고침했고 ‘새로고침 완료’ 및 실제 수집 화면의 `21826627b7f0`, 기존 ENDED/격리 마감·Visit0 상태를 확인했다. 재시작 후 runtime Credential은 비어 있어 사용자 직접 기존 파일 재인증·PLAN-003 시작을 요청했다. 새 동의·새 세션·운영 Export는 자동 실행하지 않았다.

|단계|로컬 Visit|서버 ACK Visit|실제 서버 저장|Pending|상태|결과|
|---|---:|---:|---:|---:|---|---|
|시작|0|0|0|0|사용자 직접 새 Session 시작, ACTIVE/CLEAR·관찰 허용 확인|PASS|
|1 Visit|0|0|0|0|한국어 공개 Docs의 survey-token 오탐으로 QUARANTINED|FAIL|
|5 Visit|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|첫 시도 격리로 미진행|NOT_TESTED|
|10 Visit|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|첫 시도 격리로 미진행|NOT_TESTED|
|종료|0|0|0|0|ENDED/QUARANTINED·격리 마감 완료. 정상 END ACK와 구분|PASS (격리 마감)|

위 마지막 표는 locale 수정 전 최초 실패 세션의 기록이다. 후속 실제 C 재시도10 Visit·정상 END ACK·RAW_COLLECTED 결과는 문서 상단에 별도로 기록했다. 독립 테스트 성공을 실제 C 결과로 옮기지 않았다. 실제 C Export/Import와 Google 정상 검색 DOM은 여전히 NOT_TESTED다.

## 회수 전파 3건 후속 진단

2026-11-14 후속 읽기 전용 진단에서 회수 인증키 및 loopback AI receiver 부재를 확인했다.
코드/독립 검증과 별도 운영 승인 계획은 [회수 전파 검증](retraction-propagation-validation.md)에 기록한다.
위 본문의 기존 수집 성공과 당시 미확인 3건 기록은 보존한다. 후속 운영 반영은 아직 승인 전이다.
