# Issue #112 / PR #113 슬롯 C 후속 검증

> 최종 종료 안정화·증거 보완 결과는 §12가 최신이다. 기존 137은 데몬 로그로 1초 SIGTERM timeout 강제 종료임을 확인했고 종료 경로를 보완했다. 코드·회귀·슬롯 C 기술 검증 PASS. 후속 PLAN-018 재수집에서 10 Visit·RAW_COLLECTED 및 기존 Attempt 보존을 확인했다 (§11). 실제 팀원 장비·직접 동의 및 운영 데이터 현장 검증은 NOT_TESTED이므로 전체 현장 준비 판정은 PARTIAL이다. 자동화 테스트 동의는 실제 팀원 C의 동의가 아니며 연구용 160세션 실적은 0건이다.

## 1. 검증 개요

- 대상: [Issue #112](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/112), [PR #113](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/113).
- 목적: 공식 v5→v6 전환 후 Export와 RAW 진행률의 동의 판정을 일치시키고, 독립 슬롯 C에서 실제 공개 문서 4페이지의 저장·마감을 확인한다.
- 실행일: 2026-11-13 KST. C 실제 수집 06:16:57.281~06:17:23.470, 전체 BE 회귀 06:15:18 종료. macOS 27.2 (26B123), arm64.
- JDK: Temurin 21.0.10. Node: 25.9.0. Python: 3.11.16. MySQL: Docker 8.4.
- 브라우저: Chrome for Testing 151.0.7922.34, 실제 확장 번들을 로드한 headless Chromium. OS 인증서 신뢰 설치는 검증하지 않고 신규 테스트 인증서의 SPKI만 고정한다.
- 정책: `focus-team-raw-v2/6`, RAW_ONLY. SHA-256: `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982`.
- 시작 코드: `930b349d96e9d954b688985b51d73c040a487611`. 실행 코드 SHA: `83cc3d1d9967de8ce49b9948f353964763262b57` (Push 확인 후 재빌드한 서버·확장).
- 검증 유형: 자동화 기술 테스트. 실제 참여자의 직접 동의·실제 연구 세션은 검증하지 않는다.
- 초기 Git: 작업 트리 clean, detached `bb3cb46375fcc97be946d69b2b6a9a1f22b174f3`. GitHub PR 및 origin fetch로 최신 HEAD가 `930b349`임을 확인하고 해당 커밋으로 전환했다. 대상 로컬 브랜치가 다른 워크트리에서 사용 중이므로 현재 워크트리의 detached HEAD를 기존 원격 `fix/112/collection-stability`에 fast-forward Push한다. 기존 워크트리와 커밋 이력은 변경하지 않는다.

## 2. 코드 수정

`CollectionProgressService.progress()`는 세션의 동의 ID가 현재 동의 ID와 다르면 RAW 상태를 QUARANTINED로 분류했다. 반면 Export는 공식 v5/v6 정책 쌍의 과거 정상 동의를 허용해 서로 모순됐다.

- `CollectionDataAuthorization.CONSENT`: Export에 있던 공식 정책 전환 조건을 공통 SQL로 옮겼다. 동일 동의 또는 공식 v5→v6 예외만 허용한다. 원래 동의의 소유자·미철회와 현재 유효 동의를 확인한다. 과거 정책 예외에서는 수집 전 동의 시각, 정책 ID/버전, 세션 scope의 v5 SHA, local owner의 v6 SHA를 모두 확인한다.
- `CollectionDataAuthorization.CLEAR`: CLEAR 및 세션 전체 Tombstone 부재 조건을 공유한다. 저장되지 않은 Visit의 Tombstone도 진행률 완료를 차단한다.
- `CollectionProgressService.progress()`: 참여자별 현재 유효 동의로 허용 세션 집합을 읽고 RAW 상태를 판정한다. 정상 과거 세션은 품질·전송 조건을 만족할 때 RAW_COLLECTED가 된다. 데이터나 실제 privacy_status를 변경하지 않는다.
- `CollectionExportService.export()/privacy()`: 공통 동의 조건을 사용한다. 기존 Privacy Revision·원래 consent ID·Tombstone snapshot은 그대로 반환하며 Import/학습 검수의 revision 비교를 유지한다.
- 최신 Attempt 집계, 10 Visit 기준, END·delivery 확인, AI NOT_RUN, API 상태 코드 및 응답 필드는 유지한다. 정상 원본의 Export는 완료 품질과 별개로 안전한 부족 Visit도 보존하는 기존 동작을 유지한다.
- Flyway, 기존 정책 파일, FE 수집 및 Python Import 구현은 수정하지 않았다.

추가 회귀: `CollectionConsentProgressTest`, 동일 사례를 실제 MySQL에서 수행하는 `CollectionConsentProgressMySqlTest`. 공식 v5 현재 동의, 공식 v6 재동의, 재동의 누락, 양쪽 비공식 SHA, 승인되지 않은 버전, 전체 철회, 원래 동의 철회, 수집 이후 동의, 실제 격리, 미저장 Visit Tombstone, v6 현재 동의, 혼합 집계 및 최신 Attempt를 검증한다. Export 원본 수량과 진행률, privacy의 후속 이용 권한도 대조한다.

`fe/scripts/slot-c-validation.mjs`는 신규 슬롯 C·신규 프로필·테스트 전용 마커를 요구한다. 원본 네트워크 응답을 사용하는 실제 공개 페이지 4개만 방문하며 실제 확장 및 Backend 화면을 캡처한다. 모의 페이지나 조작된 증거 UI는 생성하지 않는다.

## 3. 테스트 결과

최종 회귀는 2026-11-13 06:15 KST에 종료했다. BE XML 57개 클래스의 합계를 직접 확인했다. FE 의존성은 현재 잠금 파일로 `npm ci --cache "$NPM_CACHE"` 설치했다. 로컬 전체 로그는 비공개 임시 디렉터리에 보존하며 Credential 포함 가능성이 있는 서버 로그·원본 데이터는 Git에 넣지 않는다.

|검증|명령|결과|
|---|---|---|
|FE 타입·실제 Extension 빌드|fe에서 `VITE_API_BASE_URL=https://localhost:9443 COLLECTION_SITE_POLICY_FILE=../docs/data-collection/TEAM_POLICY.json npm run build:real`|PASS|
|FE 전체 단위|fe에서 `npm test`|932 PASS / opt-in 2 SKIP|
|Python 로컬·Export/Import|`python3 -m unittest discover -s tools/individual-local`|39 PASS|
|Python 회수|`python3 -m unittest discover -s tools/collection`|5 PASS|
|AI·학습 검수|`<AI_VENV>/bin/python -m pytest -q ai`|251 PASS / 의존성 deprecation 경고 1|
|참가자 잠금 브라우저|fe에서 `CHROMIUM_PATH="$CHROME" npm run test:participant:browser`|PASS, Chrome 151.0.7922.34|
|동의·RAW 집중 검증|be에서 `./gradlew test --tests '*CollectionRawTest' --tests '*CollectionConsentProgressTest' --console=plain`|46 PASS / 실패·오류·SKIP 0|
|BE 전체·실제 MySQL·HTTP·브라우저|`python3 tools/individual-local/run-regression.py --mysql-fixture "$FIXTURE" --output "$REGRESSION_OUT" --ai-python "$AI_PYTHON" --chrome "$CHROME"` (내부 `./gradlew test --rerun-tasks --console=plain bootJar`)|1,141 PASS / 실패·오류·SKIP 0 (57클래스)|
|기존 확장 브라우저|fe에서 `npm run build && CHROMIUM_PATH="$CHROME" npm run test:browser`|PASS, HTTP 생성·ACK 유실·같은 키 재시도·worker 재시작·중복·종료 순서|
|슬롯 C 실제 문서 브라우저|fe에서 `FOCUS_SLOT_C_DIRECTORY="$C_DIR" CHROMIUM_PATH="$CHROME" node scripts/slot-c-validation.mjs`|PASS, 아래 4 Visit·실제 화면 8장|
|C 저장 텍스트 검사|읽기 전용 MySQL 결과를 메모리에서 `dataset.validate_visit_privacy()`로 검사|4/4 PASS, 제목·본문·검색어 원문 로그 없음|
|공식 정책 갱신·격리·재수집·암호화 통합|`python3 tools/individual-local/run-quarantine-upgrade-e2e.py --output "$UPGRADE_OUT" --test-subnet 10.253.242.0/28 --chrome "$CHROME"`|PASS, 별도 신규 A Source, v5 보존·v6 재동의·0/N 격리·기사 마스킹·재수집·Export/Import·검수|

새 v5/v6 사례 13개와 상속된 기존 수집 회귀 14개를 H2 및 MySQL에서 각각 27건씩 통과했다. MySQL 조건부 테스트는 실제 실행됐으며 SKIP가 아니다. Python은 최신 Privacy Snapshot·revision·Manifest SHA·중복 Import·철회 재유입·정책 호환·학습 검수 경계를 포함한다. FE는 마스킹·안전하지 않은 Visit 제외·0/N 격리·늦은 ACK·재시작·이전 Queue 분리를 포함한다.

## 4. 슬롯 C 환경 및 재실행 명령

독립 테스트 디렉터리, 임의 Compose Project, 신규 MySQL Volume, 신규 Source ID, 신규 Credential, 신규 Chrome 프로필만 사용한다. 기존 참여자 DB·프로필·Registry에는 연결하지 않는다. 테스트 DB 포트 33343과 HTTPS 19743, 전용 subnet 10.253.241.0/28이 사용 중이 아님을 확인했다. 신규 Project는 `focus-local-3ea05155201b`, Source prefix는 `9159c1d7`, Plan revision은 1, 실제 조회한 C 배정은 53개다. 건강 상태 HTTP 200, 서버 ready=true, 동의 유효, SHA 일치를 확인했다. 원래 참가자 ID나 Credential을 재사용하지 않았다.

```bash
# JDK21의 JAVA_HOME/PATH와 CHROME을 지정한다. 모든 출력 디렉터리는 새 경로다.
# 코드를 먼저 커밋·Push하고 해당 SHA로 bootJar를 다시 빌드한다.
(cd be && ./gradlew bootJar --console=plain)
python3 tools/individual-local/local.py --directory "$C_DIR" init --slot C --db-port 33343 --tls-port 19743
# 이미 존재하는 Docker 네트워크를 피하려고 신규 Project 전용의 빈 subnet을 지정한다.
# $PROJECT는 C_DIR/config.json의 실제 project 값이다.
docker network create --subnet 10.253.241.0/28 \
  --label "com.docker.compose.project=$PROJECT" --label com.docker.compose.network=default "${PROJECT}_default"
python3 tools/individual-local/local.py --directory "$C_DIR" setup --slot C --db-port 33343 --tls-port 19743
python3 tools/individual-local/local.py --directory "$C_DIR" status
# 신규 기술 테스트 Source임을 명시하는 opt-in 마커. 실제 참여자에게 사용하지 않는다.
printf '%s' NO_HUMAN_PARTICIPANT_CONSENT > "$C_DIR/AUTOMATED_TEST_ONLY"
chmod 600 "$C_DIR/AUTOMATED_TEST_ONLY"
(cd fe && FOCUS_SLOT_C_DIRECTORY="$C_DIR" CHROMIUM_PATH="$CHROME" node scripts/slot-c-validation.mjs)
```

자동화는 신규 테스트 Credential 파일로 로그인하고 실제 참가자 화면에서 정책 v6 동의를 기록한다. 이 기록은 실제 팀원 C의 동의로 인정하지 않는다. `local.py build` 대신 같은 Vite real/content 설정으로 C_DIR/extension에 실제 Extension을 빌드한다. 기존 배포 디렉터리를 덮어쓰지 않는다.

수집 사이트는 Python 공식 문서 `/3/`, `/3/howto/`, `/3/tutorial/`, `/3/library/`다. [문서 라이선스](https://docs.python.org/3/copyright.html), [robots.txt](https://docs.python.org/robots.txt), [PSF 개인정보 안내](https://policies.python.org/python.org/Privacy-Notice/)를 확인했다. 선택 경로는 robots 제외 경로가 아니며 로그인·폼·검색어 없이 소량 문서만 연다. 이는 모든 사이트에 대한 포괄적 수집 허용 판단이 아니다.

## 5. 슬롯 C 초회 4 Visit 수집 결과

|항목|결과|
|---|---|
|슬롯|C, DB owner·배정·서버 local-status·확장에서 확인|
|검증 유형|자동화 기술 테스트 / 실제 연구 실적 0|
|정책|v6 / RAW_ONLY|
|선택 Plan|PLAN-018 / GOAL-003 / GOAL_MAINTENANCE (실제 C 배정 조회)|
|수집 Session / Attempt|7710f7c7… / cac088b5… (신규 테스트 식별자)|
|수집 시작 / 종료|2026-11-13 06:16:57.281 / 06:17:23.470 KST (DB UTC +09:00 변환)|
|방문 페이지 수|4 / 모두 실제 HTTPS 200|
|유효 Visit|4 / SUCCESS / 활성 체류 6,286·6,424·6,285·6,196ms|
|서버 저장 Visit|4 / distinct Visit ID 4 / sequence 1·2·3·4 / 중복 0|
|종료 ACK|PASS / acked / 미완료 POST·PATCH 0 / delivered count=4, through sequence=4|
|Session / Privacy|ENDED / CLEAR / privacy revision 0 / review PENDING|
|RAW Status / AI Status|RECOLLECT_REQUIRED (VISITS_BELOW_10) / NOT_RUN, AI Window 0|
|기존 데이터 손실|기존 운영 데이터 미접속. 신규 DB의 기존 0건을 보존하고 Session 1·Visit 4·Attempt 1·Consent 1을 추가. 철회·Retraction·Tombstone 0 유지|
|최종 결과|PASS — 소량 기술 수집 범위. 연구 실적 0|

API의 source는 공식 APPROVED 정책을 사용해 `PARTICIPANT`로 기록되지만, 신규 테스트 Source와 AUTOMATED_TEST_ONLY 마커로 실제 연구 데이터와 분리했다. 실제 연구 Registry로 Import하지 않는다. 자동 동의가 팀원 C의 동의를 의미하지 않는다.

추가 통합 회귀는 C와 별개인 새 A 테스트 Source(33234/19546, 전용 subnet 10.253.242.0/28)에서 수행했다. v5의 Session 1·Visit 10·Attempt 1·Consent 1과 기존 Credential·각 식별자를 보존하고 v6 재동의 Gate를 확인했다. 최종 Session 5·Visit 23·Attempt 5·Consent 2·Retraction 2·Tombstone 2가 남았다. 혼합 Export 21 Visit, 검수 2세션·20 Visit·16 Window를 통과했다. 실제 기사 이메일 마스킹, 0/N Visit 격리 마감, 제한 페이지 제외 후 지속, 다른 배정 시작, 중복 재수집, 부족 Visit 재수집을 포함한다. 암호화 backup·Export·merge·검수와 최신 privacy를 확인했으며 비공개 artifact와 신규 Registry는 로컬에만 보존했다. [요약](evidence/issue112-slot-c/upgrade-summary.json). 역시 실제 연구 실적은 0이다.

4 Visit이므로 완료 실적은 0/53이다. `raw.validVisits`·`raw.theoreticalWindows` 집계는 RAW_COLLECTED 대상만 합산해 0이며, 해당 Attempt의 `rawQuality.validVisits=4`·이론상 Window=2 및 실제 DB 4건과 모순되지 않는다. AI 포함 품질의 WINDOW_COUNT_MISMATCH / ANALYSIS_OR_STATE_INCOMPLETE는 RAW_ONLY에서 AI를 실행하지 않은 결과다. 최소 방문 기준을 낮추거나 완료로 표시하지 않았다.

읽기 전용 검증은 `SET TRANSACTION READ ONLY; START TRANSACTION WITH CONSISTENT SNAPSHOT; ... COMMIT;`으로 수행했다. 실제 SQL 결과는 [수집 전](evidence/issue112-slot-c/db-before.tsv), [종료 후](evidence/issue112-slot-c/db-after.tsv)이며 본문·Credential을 포함하지 않는다. 저장 텍스트는 `--default-character-set=utf8mb4 --batch --raw --skip-column-names`로 메모리에만 읽어 기존 개인정보 검수기를 적용했다. [검사 결과](evidence/issue112-slot-c/privacy-check.txt)는 4/4 PASS다. 패턴 기반 검사는 완전한 익명화 보장이 아니며 실제 학습 사용에는 사람 검수가 별도로 필요하다.

검증에 사용한 핵심 조회:

```sql
SELECT s.status, s.privacy_status, s.privacy_revision,
       t.planned_session_id, t.delivered_visit_count, t.delivered_through_sequence,
       COUNT(v.visit_id), COUNT(DISTINCT v.visit_id), COUNT(DISTINCT v.sequence),
       MIN(v.active_duration_ms), MAX(v.active_duration_ms)
FROM work_session s JOIN collection_attempt t ON t.session_id=s.session_id
LEFT JOIN page_visit v ON v.session_id=s.session_id
GROUP BY s.session_id,t.attempt_id;
SELECT sequence,domain,active_duration_ms,extraction_status,
       CHAR_LENGTH(title),CHAR_LENGTH(content) FROM page_visit ORDER BY sequence;
```

## 6. 실제 화면 캡처

실제 Playwright 캡처 파일을 육안 확인했다. 06·07·09와 04·12는 같은 바이트의 공유 시각 증거이며, 별도 시점의 독립 증거로 세지 않는다 (§12 이미지 전체 목록). 페이지 응답·Extension DOM을 증거용으로 재작성하지 않았다. 01·08은 인증 헤더로 접근한 실제 Backend JSON 응답을 Chrome이 렌더링한 화면이다. 05에는 마감 전 미완료 PATCH 1건이 보이며, 06·07에서 0과 END ACK를 확인한다. 모든 그림은 아래 실제 파일로 연결된다. 시각은 2026-11-13 KST다.

|파일|시각|확인한 사실|
|---|---|---|
|[01-slot-c-status.png](evidence/issue112-slot-c/01-slot-c-status.png)|06:16:56.953|C·ready=true·공식 정책 SHA, Backend 실제 응답|
|[02-extension-ready.png](evidence/issue112-slot-c/02-extension-ready.png)|06:16:57.122|실제 Extension C·v6·53배정·PLAN-018·유효 테스트 동의|
|[03-session-active.png](evidence/issue112-slot-c/03-session-active.png)|06:16:57.427|선택 Plan·ACTIVE·Visit 0|
|[04-public-page-visit.png](evidence/issue112-slot-c/04-public-page-visit.png)|06:17:04.048|변경하지 않은 실제 Python 공식 문서 페이지|
|[05-visit-progress.png](evidence/issue112-slot-c/05-visit-progress.png)|06:17:23.391|ACTIVE·Visit 4, 마감 전 pending 1|
|[06-session-ended.png](evidence/issue112-slot-c/06-session-ended.png)|06:17:23.763|ENDED·종료 ACK acked·pending 0|
|[07-collection-progress.png](evidence/issue112-slot-c/07-collection-progress.png)|06:17:23.950 (호출 메타데이터)|06과 동일 이미지 재사용. Visit 4·전송 확인·RECOLLECT_REQUIRED·AI NOT_RUN 공통 시각 근거|
|[08-server-validation.png](evidence/issue112-slot-c/08-server-validation.png)|06:17:24.104|실제 Backend 진행률·Session/Attempt·CLEAR·4 Visit|

비밀번호·Token·개인키·인증 원문·개인 사용자 프로필은 캡처에 없다. 화면의 테스트 식별자는 실사용자와 연결되지 않는 신규 가명 UUID이며, 보고서와 SQL은 식별자 prefix만 기록했다. 본문 원본·민감정보가 담긴 캡처는 커밋하지 않았다. 별도 마스킹 편집은 필요하지 않았고, 실제 화면 원본을 그대로 보존했다. 그림의 SHA-256과 캡처 시각은 [validation-summary.json](evidence/issue112-slot-c/validation-summary.json)에 있다.

## 7. 문제와 해결 과정

- 최초 FE build는 명시적 API origin 없이 실행하여 `Explicit API origin required`로 차단됐다. 공식 정책과 localhost:9443을 지정해 타입 검사·빌드·FE 단위를 통과했다. 보호 조건을 비활성화하지 않았다.
- 추가한 동일 동의 경로의 시각 검사는 기존 H2 회귀에서 JDBC의 로컬 시각과 JPA의 UTC 시각 차이(9시간)에 걸렸다. 기존 동일 동의 동작을 보존하고, 원래 Export의 역사적 정책 예외에 있던 수집 시각 조건은 그대로 유지했다. 집중 RAW/동의 테스트 46건이 통과했다. 기존 저장 시각이나 DB 행을 변경하지 않았다.
- 전체 회귀의 이전 실행은 위 실패 확인 후 이번 테스트 워커만 종료했다. 새 스키마로 재실행했다. 재시도 직후 이전 fixture의 종료 중 포트가 남아 한 번 차단됐으며, 포트 반환 후 새 출력 디렉터리로 실행했다. 기존 볼륨은 보존했다.
- 실제 슬롯 C 수집 중 오류는 없었다. 4페이지 모두 수집·전송·종료·저장에 성공했으며 세션 생성·전송·추출 실패는 0건이다. 추가 수집 코드 수정은 필요하지 않았다.
- 최초 읽기 전용 본문 검수는 MySQL CLI 기본 문자셋 때문에 UTF-8 디코딩이 실패했다. CLI에 utf8mb4를 명시해 같은 DB를 다시 읽고 4/4 개인정보 검수 PASS를 확인했다. 수집 데이터·DB 설정은 바꾸지 않았다.
- 일부 최초 검증 명령은 실행 디렉터리가 잘못되어 실행되지 않았다. Gradle은 be, Extension 스크립트는 fe 디렉터리에서 다시 실행했다. 해당 실패를 수집 실패나 PASS로 집계하지 않았다.

## 8. 데이터 보존 및 개인정보

기존 MySQL·Docker Volume·IndexedDB·Session·Visit·Attempt·Consent·철회·Tombstone·Import Registry를 초기화하거나 삭제하지 않았다. 운영 데이터에는 접근하지 않았다. 회귀 테스트의 삭제/rollback은 새 컨테이너의 신규 테스트 스키마 또는 H2 fixture에만 적용됐다.

별도 MySQL 회귀 컨테이너 `focus101-issue112-followup`은 포트 33113을 사용한다. 원래 환경과 분리했으며 테스트 종료 후 컨테이너만 정지하고 Volume·새 스키마는 남긴다. 슬롯 C도 같은 보존 원칙을 적용했다. 검증 후 이번 C Backend와 컨테이너만 정상 정지했고 DB Volume·디렉터리·Chrome IndexedDB·동의·Source는 보존했다. 기존 다른 컨테이너는 정지하지 않았다. 인증 원문·TLS 개인키·Chrome 프로필·DB·raw 본문·.age·Registry·원본 서버 로그는 Git 대상에서 제외한다.

Export/Import·암호화·SHA·중복·최신 Privacy/Revision·학습 검수는 회귀 테스트 범위에서 확인한다. 슬롯 C 실제 수집본의 외부 Export/Import는 수행하지 않는다. 실제 본문에 대한 저장 전 보호는 그대로 활성화한다.

## 9. 미검증

- 실제 팀원 A/B/C 장비 및 본인 직접 동의: NOT_TESTED.
- 실제 운영 DB의 전후 행 수 비교와 장비별 기존 데이터 업데이트: NOT_TESTED (운영 데이터 미접속).
- OS 인증서 신뢰 설치·일반 Chrome 수동 로드·Windows 전체 설치: NOT_TESTED.
- 모든 사이트 DOM, 실제 디스크 고갈 및 모든 DB 중단 시점: NOT_TESTED.
- 연구용 160세션 완료 및 모든 외부 사본 회수: NOT_TESTED.

## 10. 최종 판단 및 Git

**PARTIAL** — 코드 수정·전체 회귀·슬롯 C의 실제 공개 웹 4 Visit·서버 저장·END ACK·실제 화면 8장 검증은 PASS다. 실제 세 팀원 장비·직접 동의·운영 DB 보존 현장 확인이 남아 있다. 슬롯 C 기술 테스트가 A/B/C 전체 운영 준비 또는 Issue #112 전체 완료를 뜻하지 않는다. PR 자동 병합과 Issue 자동 종료는 하지 않는다.


- 코드 커밋: `83cc3d1d9967de8ce49b9948f353964763262b57`.
- 첫 Push: origin `fix/112/collection-stability`에 일반 fast-forward 성공. `git ls-remote` 및 GitHub PR API의 head_sha가 위 SHA와 일치함을 확인했다.
- 최종 증거·보고서는 후속 문서 커밋으로 같은 원격 브랜치에 반영한다. 해당 문서 커밋의 원격 SHA 재확인 결과는 PR 댓글과 최종 작업 응답에 기록한다 (보고서 자체의 SHA 자기참조는 하지 않는다).
- `git diff --check`와 변경 목록을 확인하고 개인정보·키·Credential·로컬 DB·프로필·원본 데이터·서버 로그를 제외했다. 기존 `collection-stability-validation.md`는 수정하지 않았다.


## 11. PLAN-018 동일 환경 재수집 — 10 Visit / RAW_COLLECTED

### 11.1. 범위와 실행 코드

2026-11-13 KST에 초회 4 Visit을 수집했던 **동일한** 슬롯 C Project `focus-local-3ea05155201b`, MySQL Volume, Source `9159c1d7…`, Participant, Credential, 정책 v6, Extension 디렉터리, Chrome 프로필을 다시 사용했다. `init`·`setup`·DB 초기화·프로필 재생성·IndexedDB 삭제·동의 재등록은 수행하지 않았다. 기존 동의와 인증이 유효함을 확인했다.

작업 시작 시 GitHub PR #113 및 origin HEAD는 `1c83c6cf2e908f16fe7cbff62ad95238bc60daa2`로 같았고 작업 트리는 clean이었다. 실행한 Backend JAR의 `build.sourceCommit`과 기존 Extension footer는 모두 `83cc3d1d9967de8ce49b9948f353964763262b57`이다. 애플리케이션 코드는 추가 수정하지 않았다. 이번 변경은 재수집 검증 스크립트·증거·보고서 추가다.

테스트용 자동화 동의는 이전 기록 1건을 그대로 사용했다. 실제 팀원 C의 동의 또는 연구용 160세션 실적으로 합산하지 않으며, 연구 실적은 계속 0건이다. 이 Source의 API `PARTICIPANT`·완료 1/53 표시는 독립된 기술 테스트 DB의 값이다.

### 11.2. 실제 실행 과정과 검증

1. 같은 DB와 Backend만 재시작하고 새 age 테스트 키로 기존 DB의 암호화 백업을 보존했다. 키·백업·원본 데이터는 비공개 로컬에만 남겼다.
2. 시작 전 읽기 전용 SQL로 Session 1·Visit 4·Attempt 1·Consent 1을 확인했다. 기존 Session·Visit·Attempt·동의·Source·Credential·정책·배정의 행을 메모리에서 정규화 JSON SHA-256으로 비교할 기준을 저장했다. 본문은 로그에 출력하지 않았다.
3. 기존 Chrome 프로필의 실제 참가자 화면에서 `PLAN-018`, 재수집 사유 `INSUFFICIENT_VISITS`를 선택하고 **사유 기록 후 재수집 허용**을 눌렀다. 기존 Attempt의 review_status·reason_code를 정식 API가 갱신하고 LOCAL_RECOLLECT 감사 이벤트 1건을 추가했다.
4. 같은 배정을 시작해 기존과 다른 Session/Attempt를 생성했다. 공개 Python 문서 10페이지를 실제 HTTPS로 방문했고 모두 200을 받았다. 모의 네트워크·가짜 DOM·수집 품질 완화는 사용하지 않았다.
5. 유효 Visit 10개를 확인한 뒤 UI로 종료했다. END ACK acked·pending 0·전송 확인 10·RAW_COLLECTED·AI NOT_RUN을 확인했다.
6. 읽기 전용 SQL과 전체 행 해시로 이전 Session·4 Visit의 불변성과 이전 Attempt 보존을 검증했다. 기존 Attempt는 재수집에 필요한 두 필드(review_status, reason_code)만 비교에서 제외했고, 그 외 필드는 모두 보존됐다. 기존 Consent·Credential·Source·Plan·정책 행은 전부 동일했다. 저장된 14 Visit의 제목·본문·검색어는 기존 개인정보 검수기로 메모리 내 검사해 모두 PASS했다.

### 11.3. MySQL과 Backend 최종 결과

|항목|기존 Attempt|신규 재수집 Attempt|
|---|---|---|
|Plan|PLAN-018|PLAN-018|
|Session prefix|7710f7c7|da18fc7e|
|Attempt prefix|cac088b5|4d497df5|
|시작 KST|06:16:57.281|07:13:52.879|
|종료 KST|06:17:23.470|07:14:53.321|
|Session / Privacy / revision|ENDED / CLEAR / 0|ENDED / CLEAR / 0|
|MySQL Visit|4 (기존 전체 행 해시 일치)|10 (새 Visit ID 10개)|
|Sequence|1~4|1~10, 중복 0|
|Delivered / through sequence|4 / 4|10 / 10|
|Review / reason|RECOLLECT_REQUIRED / INSUFFICIENT_VISITS|PENDING / NULL|
|RAW|RECOLLECT_REQUIRED / VISITS_BELOW_10|RAW_COLLECTED / 사유 없음|
|AI|NOT_RUN|NOT_RUN|

신규 Visit의 active_duration_ms는 순서대로 **6568, 5356, 6458, 6515, 5446, 5419, 5488, 6225, 5442, 5498**이며 전부 5초 이상, extraction_status=SUCCESS다. 방문 주소·HTTP 결과는 [요약 JSON](evidence/issue112-slot-c/recollect-10/validation-summary.json)에 기록했다.

최종 MySQL은 **Session 2, Attempt 2, Visit 14, Consent 1, Consent Event 1, Source 1**이다. Withdrawal·Retraction·Tombstone·AI Window는 각각 0이며 LOCAL_RECOLLECT 감사 이벤트는 1건이다. 소스·슬롯 C·배정 53개·Plan revision 1은 유지됐다. 최신 Attempt 기준 RAW 집계는 **완료 1/53, 유효 Visit 10, 이론상 Window 8, 생성 AI Window 0**이다. 이전 4 Visit을 합쳐 14 Visit 완료로 세지 않았다.

- [실제 MySQL 출력](evidence/issue112-slot-c/recollect-10/mysql-verification.txt)
- [실행한 읽기 전용 SQL](evidence/issue112-slot-c/recollect-10/verification.sql)
- [행 보존·개인정보 검사 요약](evidence/issue112-slot-c/recollect-10/preservation-summary.json)

화면의 AI 포함 status=RECOLLECT_REQUIRED와 RAW_COLLECTED는 서로 다른 품질 지표다. RAW_ONLY에서 AI를 실행하지 않아 AI 포함 Window/분석 품질은 미완료지만, 원본 10 Visit·참조·종료·전송 조건은 충족했다.

### 11.4. 추가 실제 캡처 8장

시각은 모두 2026-11-13 KST다. 09~15는 실제 Extension·공개 웹·Backend 응답 화면이며, 원본 페이지나 값을 증거용으로 수정하지 않았다.

|파일|캡처 시각|확인 내용|
|---|---|---|
|[09-before-recollection.png](evidence/issue112-slot-c/recollect-10/09-before-recollection.png)|07:13:52.548|06·07과 동일한 공유 시각 근거. 재수집 직전이라는 시점은 이 이미지 단독으로 입증하지 않음|
|[10-recollect-authorized.png](evidence/issue112-slot-c/recollect-10/10-recollect-authorized.png)|07:13:52.763|Existing Attempt retained with INSUFFICIENT_VISITS; same plan can start again|
|[11-new-session-active.png](evidence/issue112-slot-c/recollect-10/11-new-session-active.png)|07:13:53.046|Same PLAN-018 with a distinct new Session and Attempt, ACTIVE|
|[12-public-page-visit.png](evidence/issue112-slot-c/recollect-10/12-public-page-visit.png)|07:13:59.780|04와 동일한 공개 페이지 화면 재사용. 해당 세션의 실제 방문은 별도 브라우저 관측·Visit SQL로 대조|
|[13-ten-visits-active.png](evidence/issue112-slot-c/recollect-10/13-ten-visits-active.png)|07:14:53.233|ACTIVE and ten valid Visits before END|
|[14-raw-collected.png](evidence/issue112-slot-c/recollect-10/14-raw-collected.png)|07:14:53.726|ENDED/acked, RAW_COLLECTED, both old and new Attempts visible, completion 1/53|
|[15-server-two-attempts.png](evidence/issue112-slot-c/recollect-10/15-server-two-attempts.png)|07:14:53.894|Actual Backend JSON: two preserved Attempts, ten valid Visits counted once|
|[16-mysql-preservation.png](evidence/issue112-slot-c/recollect-10/16-mysql-preservation.png)|07:15:51.167|Actual saved read-only MySQL CLI output, opened as plain text in Chrome; not a SQL GUI or Terminal screenshot|

16은 실제 `mysql --table` 출력 파일을 Chrome의 일반 텍스트 보기로 열어 찍은 화면이다. 네이티브 Terminal 앱은 Computer Use 접근 제한으로 캡처할 수 없었으며 Terminal/MySQL GUI 캡처는 **NOT_CAPTURED**다. 이를 우회하지 않고 SQL stdout 자체와 SQL 파일을 함께 제공했다. HTML로 만든 SQL UI나 이미지 합성은 사용하지 않았다. SQL에는 테스트 식별자 prefix·수량·상태·길이만 기록했다. 캡처에도 Credential·개인키·본문 원문은 없으며, 15에 보이는 UUID는 기존 독립 테스트 Source의 가명 식별자다. 모든 캡처의 원본 SHA-256은 요약 JSON에 있다. 기존 01~08 캡처와 초회 SQL 결과는 그대로 보존했다.

### 11.5. 실행 명령·문제·판정

```bash
# 기존 C_DIR, 기존 JDK21 및 CHROME을 그대로 사용. init/setup/build/동의 등록 없음.
python3 tools/individual-local/local.py --directory "$C_DIR" db
python3 tools/individual-local/local.py --directory "$C_DIR" start
# age-keygen으로 신규 테스트 키 생성 후 공개 recipient로 기존 DB를 암호화 백업.
python3 tools/individual-local/local.py --directory "$C_DIR" backup --recipient "$TEST_RECIPIENT" --output "$PRIVATE_OUT/before-recollect.sql.age"
node --check fe/scripts/slot-c-recollect-validation.mjs
(cd fe && FOCUS_SLOT_C_DIRECTORY="$C_DIR" CHROMIUM_PATH="$CHROME" node scripts/slot-c-recollect-validation.mjs)
# verification.sql은 SET TRANSACTION READ ONLY / CONSISTENT SNAPSHOT / COMMIT 사용.
# 같은 Project의 MySQL에서 --default-character-set=utf8mb4 --table로 실행하고 출력 보존.
python3 tools/individual-local/local.py --directory "$C_DIR" stop
```

신규 스크립트의 node 문법 검사와 실제 브라우저 검증의 모든 assert가 PASS했다. 이번에는 FE/BE/AI 제품 코드가 바뀌지 않아 §3의 전체 단위·통합 테스트를 재실행하지 않았다. §3 수치는 앞선 실행 결과다. 재수집 중 오류는 없었다. 증거 SQL 초안에서 예약어 stored를 별칭으로 사용해 오류 1064가 났고 stored_visits로 바꿔 읽기 전용 조회를 재실행했다. JAR 메타데이터 확인도 실제 ZIP 내 경로 META-INF/build-info.properties로 정정했다. 이들은 증거 확인 명령의 문제로 수집 데이터나 애플리케이션을 변경하지 않았다.

최초 `local.py stop` 이후 최종 점검에서 C MySQL 컨테이너 exit=137을 관측했다. 최초 종료 원인은 확정하지 못했다. 같은 볼륨의 MySQL만 다시 열어 healthy를 확인하고 행 보존 검사·14 Visit 개인정보 검사·SQL을 재실행했다. SQL 출력은 이전과 동일했고 보존 검사도 PASS했다. 이후 `docker stop --timeout 60 focus-local-3ea05155201b-mysql-1`로 종료해 exit=0·OOMKilled=false·State.Error 없음까지 확인했다. 추가 Session/Visit은 생성하지 않았으며 볼륨과 프로필을 보존했다. [종료·재시작 검증](evidence/issue112-slot-c/recollect-10/shutdown-validation.json). 기본 종료 경로의 137 발생 원인은 후속 운영 점검 대상으로 남긴다.

**이번 재수집 범위: PASS. 전체 현장 준비 판정: PARTIAL 유지.** 실제 팀원 장비·직접 동의·운영 DB 검증은 여전히 NOT_TESTED다. 검증 후 이번 C Backend·컨테이너만 정지하고 DB Volume·두 Session/Attempt·14 Visit·동의·Chrome 프로필을 보존했다. Export/Import나 실제 연구 Registry 등록은 수행하지 않았다. PR 자동 병합과 Issue 종료도 수행하지 않는다.


## 12. 최종 종료 안정화·증거 보완·병합 준비 검증

### 12.1. 실행 범위와 실제 원인 증거

이번 최종 실행은 2026-11-13 KST에 수행했다. 시작 시 로컬·origin·PR #113 HEAD는 `b56349dd84526cbb16787890f44f26ad5f00ecc6`, main은 `bb3cb46375fcc97be946d69b2b6a9a1f22b174f3`였고 작업 트리는 clean이었다. 실제 기존 C의 **2 Session·2 Attempt·14 Visit·1 Consent**에 접근해 새 기준 해시와 암호화 백업을 만든 후 조사했다. 신규 C Session/Visit/Consent는 만들지 않았다.

Docker Desktop 보존 데몬 로그(init.log.0)에서 기존 C 컨테이너 `c0d266442906…`에 대해 다음 기록을 찾았다. 원본 전체 로그 대신 해당 컨테이너·종료 관련 항목만 선별했다.

|UTC|KST|관측|
|---|---|---|
|2026-11-12 22:17:43.927502|2026-11-13 07:17:43.927502|MySQL: signal에 의한 SHUTDOWN 수신, 이후 정상 종료 완료 로그 없음|
|2026-11-12 22:17:44.932460299|2026-11-13 07:17:44.932460299|Docker daemon: **Container failed to exit within 1s of signal 15 - using the force**|

별도의 21:18:40 UTC에도 같은 1초 유예 초과 메시지가 있었다. 현재 inspect에서 기존 컨테이너 Config.StopTimeout=1, StopSignal=null, memory limit=0을 확인했다. 최초 137 시점의 OOMKilled 스냅샷은 남아 있지 않아 **NOT_AVAILABLE**이다. 뒤의 OOMKilled=false를 최초 상태로 소급하지 않는다. 1초 값이 처음 설정된 경위도 미확정이다. 다만 관측된 137의 직접 원인은 해당 시각의 데몬 로그로 확인한 **SIGTERM 후 1초 timeout에 따른 강제 종료**다. 외부 강제 종료나 OOM을 증거 없이 원인으로 지목하지 않는다.

- [데몬 종료 증거](evidence/issue112-slot-c/final-stability/daemon-shutdown-evidence.json)
- [해당 C의 MySQL 종료/재시작 로그](evidence/issue112-slot-c/final-stability/mysql-shutdown-history.log)
- [판정 요약](evidence/issue112-slot-c/final-stability/shutdown-summary.json)

Docker는 종료 신호 후 지정 유예시간이 지나면 SIGKILL로 강제 종료한다. 명시한 container timeout이 없을 때의 Linux 기본값은 10초지만 이 컨테이너에는 1초가 저장돼 있었다. [공식 stop 문서](https://docs.docker.com/reference/cli/docker/container/stop/), [Compose stop_grace_period](https://docs.docker.com/reference/compose-file/services/#stop_grace_period).

### 12.2. 최소 수정과 반복 종료 검증

제품 변경은 다음으로 한정했다. 수집·인증·동의·개인정보·Export 판정·Flyway 원문은 수정하지 않았다.

- `deploy/individual-local/compose.yml`: MySQL `stop_grace_period: 60s`. 새로 생성되는 컨테이너에도 유예시간을 명시한다.
- `tools/individual-local/local.py`: `docker compose ... stop --timeout 60 mysql`로 기존 컨테이너의 저장된 1초 값도 명시적으로 override한다. 종료 뒤 해당 Project의 MySQL State를 inspect하여 exited·exit=0·OOMKilled=false·Error 없음일 때만 정상 종료로 보고한다. 비정상 상태는 MYSQL_SHUTDOWN_UNCLEAN 오류로 반환하고 볼륨을 보존한다.
- Backend는 기존 nonce/PID 검증 후 SIGTERM·종료 확인을 거친 다음 MySQL을 정지하는 순서를 유지한다. MySQL이 아직 생성되지 않은 환경의 stop no-op도 유지한다.
- 회귀 테스트는 Backend→MySQL 순서와 정상 종료 확인, exit 137/OOM/running/engine error에서 성공 안내 금지, 컨테이너 없는 stop을 검증한다.

수정 코드 커밋: `b5248e09e5f9de00b24c3b4d805511c4896c8d11`.

수정 전 기본 stop을 이번에 한 번 재실행했을 때는 1초 설정에서도 exit=0이어서 **NOT_REPRODUCED**였다. 이는 보존된 과거 데몬 로그의 원인 증거를 부정하지 않는다. [수정 전 실행](evidence/issue112-slot-c/final-stability/baseline-stop.json).

|수정 후 실행|컨테이너 저장 timeout|CLI 유예|종료 결과|데이터 검사|
|---|---:|---:|---|---|
|[기존 컨테이너](evidence/issue112-slot-c/final-stability/fixed-legacy-stop.json)|1초|60초|exit=0, OOM=false, Error 없음, signal 9 없음|14 Visit 및 보호 행 동일|
|[Compose 설정 적용 후 2차](evidence/issue112-slot-c/final-stability/fixed-cycle-2-stop.json)|60초|60초|exit=0, OOM=false, Error 없음, signal 9 없음|14 Visit 및 보호 행 동일|
|[3차](evidence/issue112-slot-c/final-stability/fixed-cycle-3-stop.json)|60초|60초|exit=0, OOM=false, Error 없음, signal 9 없음|14 Visit 및 보호 행 동일|
|[최종 화면 확인 후](evidence/issue112-slot-c/final-stability/final-stop.json)|60초|60초|exit=0, OOM=false, Error 없음, signal 9 없음|14 Visit 및 보호 행 동일|

Compose 설정 적용 때 컨테이너는 같은 named Volume을 유지한 채 재생성됐고 실제 Config.StopTimeout=60을 확인했다. Source·Participant·동의·Plan과 저장 데이터는 그대로였다. 각 회차에서 Backend·MySQL ready를 기다려 API/SQL을 확인하고 종료했다. 초기에 검증 도구가 MySQL 준비 전에 SELECT를 시도한 한 번은 데이터 검증 PASS로 세지 않았고, ready 대기 후 재실행했다. 별도 startup-stop 관측도 위 정상 데이터 검증 회차에 포함하지 않았다.

판정: **ROOT_CAUSE_CONFIRMED**(과거 137의 직접 강제 종료 원인), **NOT_REPRODUCED**(이번 수정 전 1회), **FIX_VERIFIED**(legacy override·새 설정·비정상 종료 감지·반복 정상 종료), **DATA_PRESERVED**. 최초 1초 설정의 생성 경위는 미확정이지만 새 설정과 CLI override가 모두 적용된다. 디스크 고갈·모든 장비의 메모리/스토리지 조건은 NOT_TESTED다.

### 12.3. 기존 C 데이터와 개인정보 보존

반복 실행·현재 화면 확인 전후에 선택한 16개 보호 테이블의 각 행을 정렬된 JSON으로 정규화해 SHA-256 목록을 비교했다. 이번 기준값에는 기존 4 Visit뿐 아니라 최신 10 Visit과 두 Attempt의 모든 필드도 포함했다. **모든 목록이 일치**했다. 해시 계산은 메모리에서 수행하고 본문·Credential을 출력하지 않았다.

|항목|이번 실행 전|반복 재시작·화면 확인 후|
|---|---:|---:|
|Session|2|2|
|Attempt|2|2|
|Visit|14|14|
|Consent / Consent Event|1 / 1|1 / 1|
|Source / Credential / Local Owner|1 / 1 / 1|1 / 1 / 1|
|Consent Withdrawal / Retraction / Tombstone|0 / 0 / 0|0 / 0 / 0|
|전체 Plan assignment / C 배정|160 / 53|160 / 53|
|Plan revision|1|1|

Source `9159c1d7…`, Participant `1e43eb87…`, 이전 Session/Attempt `7710f7c7… / cac088b5…`, 최신 `da18fc7e… / 4d497df5…`가 유지됐다. 이전 Attempt는 4 Visit·RECOLLECT_REQUIRED·INSUFFICIENT_VISITS, 최신은 10 Visit·RAW_COLLECTED·전송 확인·ENDED/CLEAR·AI NOT_RUN이다. 각 Session의 sequence는 각각 1~4, 1~10이며 중복 없이 유효 체류·SUCCESS를 유지했다. 최신 Attempt 집계는 완료 1/53, 유효 Visit 10, 이론상 Window 8, 생성 AI Window 0이다.

- [기존 1초 컨테이너 데이터 검사](evidence/issue112-slot-c/final-stability/fixed-legacy-data.json)
- [2차](evidence/issue112-slot-c/final-stability/fixed-cycle-2-data.json), [3차](evidence/issue112-slot-c/final-stability/fixed-cycle-3-data.json)
- [현재 화면 확인 전](evidence/issue112-slot-c/final-stability/final-before-capture.json), [확인 후](evidence/issue112-slot-c/final-stability/final-after-capture.json)

저장된 14 Visit의 제목·본문·검색어를 기존 `dataset.validate_visit_privacy()`로 검사해 매회 14/14 PASS를 확인했다. 실제 운영 데이터·실제 팀원 프로필·기존 운영 Import Registry에는 접근하지 않았다. 백업과 age 개인키는 로컬 비공개 디렉터리에만 보존했다. [공개 가능한 백업 무결성 요약](evidence/issue112-slot-c/final-stability/backup-summary.json).

### 12.4. 중복 이미지 정정과 현재 화면

기존 이미지는 삭제·수정하지 않았다. 전체 **19개 PNG / 15개 고유 이미지**의 SHA-256과 Git Blob을 다시 계산했다. 다음은 동일 바이트 그룹이며, 서로 다른 시점이나 세션의 독립 시각 증거로 계산하지 않는다.

|공유 원본|동일 파일|검증에서의 취급|
|---|---|---|
|06-session-ended.png|07-collection-progress.png, recollect-10/09-before-recollection.png|동일한 4 Visit 종료/진행 상태의 공유 시각 근거. 재수집 직전이라는 시점은 09 단독으로 증명하지 않음|
|04-public-page-visit.png|recollect-10/12-public-page-visit.png|공개 Python 문서 화면의 공유 예시. 각 세션의 실제 방문은 당시 브라우저 관측 URL·HTTP 결과·Visit SQL로 확인|
|recollect-10/15-server-two-attempts.png|final-stability/19-current-backend-progress.png|보존된 동일 Backend 응답의 공유 시각 근거. 이번 읽기 시각은 API/SQL 실행 기록으로 확인|

과거 4 Visit 재수집 직전의 별도 고유 화면은 현재 다시 촬영할 수 없으므로 **NOT_CAPTURED**다. 09의 중복 이미지와 당시 before/after SQL, 변경된 두 필드와 LOCAL_RECOLLECT 감사 기록, 브라우저 summary를 함께 대조한다. 기존 호출 메타데이터의 시간은 그대로 보존하되 이미지에 시각이 찍혔다거나 독립 프레임임을 주장하지 않는다.

이번에는 기존 상태를 읽기 전용으로 열어 다음 실제 화면을 새로 캡처했다. 17·18은 Playwright locator.screenshot으로 실제 metrics/progress 요소를 직접 찍은 것이며 합성·값 변경·후처리 이미지가 아니다. 19도 실제 새 screenshot 호출이지만 바이트는 15와 같으므로 공유 증거로 분류했다.

|이번 캡처|KST|목적|
|---|---|---|
|[17-current-session-ended.png](evidence/issue112-slot-c/final-stability/17-current-session-ended.png)|07:47:27.155|Current retained session: ENDED, ten Visits, acked, pending zero; actual metrics element|
|[18-current-progress.png](evidence/issue112-slot-c/final-stability/18-current-progress.png)|07:47:27.236|Current work section: C assignment count 53, completion 1, both retained Attempts 4/10, RAW_COLLECTED|
|[19-current-backend-progress.png](evidence/issue112-slot-c/final-stability/19-current-backend-progress.png)|07:47:27.412|Actual authenticated Backend JSON after restart, two Attempts and latest raw completion|

전체 파일·호출 시간 메타데이터·SHA-256·Git Blob·canonical 공유 관계는 [이미지 무결성 목록](evidence/issue112-slot-c/final-stability/image-inventory.json)에 있다. 아래 시간은 자동화 호출 기록이며 이미지 내부 타임스탬프가 아니다. 캡처는 육안 검토했고 Credential·Token·개인키·개인 참가자 정보가 없음을 확인했다. Backend 화면의 UUID는 독립 자동화 테스트 Source의 가명 ID다.

|파일|SHA-256|공유 시각 원본|
|---|---|---|
|[01-slot-c-status.png](evidence/issue112-slot-c/01-slot-c-status.png)|`079e2701b8329b61f62b396d00264bd753e7e7e367fd9a224cc104029a0197f8`|01-slot-c-status.png|
|[02-extension-ready.png](evidence/issue112-slot-c/02-extension-ready.png)|`129ca5c3832597b76279962ab48dc8baa88f10a804403028554df28009d450e8`|02-extension-ready.png|
|[03-session-active.png](evidence/issue112-slot-c/03-session-active.png)|`d75dddde07dfad0dca6afaf6224a323124c3151613b3dad1b42c3f1150bea10d`|03-session-active.png|
|[04-public-page-visit.png](evidence/issue112-slot-c/04-public-page-visit.png)|`25b98448ba68885990fac2c387b2134713a2fe7c49292e82c5b04537ce60696c`|04-public-page-visit.png|
|[05-visit-progress.png](evidence/issue112-slot-c/05-visit-progress.png)|`bd7e424305a551f5cffc377c07817cfd6e9420094cba05576e29a2107081baf7`|05-visit-progress.png|
|[06-session-ended.png](evidence/issue112-slot-c/06-session-ended.png)|`0b970ee5e6ea966734b3311e80275ffd99eb8a603504ff516970353be026dbb5`|06-session-ended.png|
|[07-collection-progress.png](evidence/issue112-slot-c/07-collection-progress.png)|`0b970ee5e6ea966734b3311e80275ffd99eb8a603504ff516970353be026dbb5`|06-session-ended.png|
|[08-server-validation.png](evidence/issue112-slot-c/08-server-validation.png)|`301fadb196b18afb9d41c4eee8701ccf61ab13f1ed30cd23b7ecf864ae4ba10e`|08-server-validation.png|
|[final-stability/17-current-session-ended.png](evidence/issue112-slot-c/final-stability/17-current-session-ended.png)|`bc64f81f915ca2cec303bc9559cb5e785e86e2ad56ae457342c54726a8ffb652`|final-stability/17-current-session-ended.png|
|[final-stability/18-current-progress.png](evidence/issue112-slot-c/final-stability/18-current-progress.png)|`db48754b9e87eba6425b1a414630ec7917f900f22bd3625948fab6be026cc747`|final-stability/18-current-progress.png|
|[final-stability/19-current-backend-progress.png](evidence/issue112-slot-c/final-stability/19-current-backend-progress.png)|`2c1cde93acbf4accfccf7cc1ff9ae6040389fbc8adc68fd1dc42b489fa145ac7`|recollect-10/15-server-two-attempts.png|
|[recollect-10/09-before-recollection.png](evidence/issue112-slot-c/recollect-10/09-before-recollection.png)|`0b970ee5e6ea966734b3311e80275ffd99eb8a603504ff516970353be026dbb5`|06-session-ended.png|
|[recollect-10/10-recollect-authorized.png](evidence/issue112-slot-c/recollect-10/10-recollect-authorized.png)|`b949ade93e2ba84478333cd2f651735642431d59f269e476735574e9b5524dca`|recollect-10/10-recollect-authorized.png|
|[recollect-10/11-new-session-active.png](evidence/issue112-slot-c/recollect-10/11-new-session-active.png)|`752e82430f28bd2d9c773d7099e1837ff52159ccb2264302464c0e99eba7f15d`|recollect-10/11-new-session-active.png|
|[recollect-10/12-public-page-visit.png](evidence/issue112-slot-c/recollect-10/12-public-page-visit.png)|`25b98448ba68885990fac2c387b2134713a2fe7c49292e82c5b04537ce60696c`|04-public-page-visit.png|
|[recollect-10/13-ten-visits-active.png](evidence/issue112-slot-c/recollect-10/13-ten-visits-active.png)|`f66dd7bd94f15f467a34a6113e68af18b0fe36733a96a2dce77cebf20c35c66b`|recollect-10/13-ten-visits-active.png|
|[recollect-10/14-raw-collected.png](evidence/issue112-slot-c/recollect-10/14-raw-collected.png)|`4a265b9b4f23c89400e7251edf30beba4cb346533ed34aa2a25351188054f826`|recollect-10/14-raw-collected.png|
|[recollect-10/15-server-two-attempts.png](evidence/issue112-slot-c/recollect-10/15-server-two-attempts.png)|`2c1cde93acbf4accfccf7cc1ff9ae6040389fbc8adc68fd1dc42b489fa145ac7`|recollect-10/15-server-two-attempts.png|
|[recollect-10/16-mysql-preservation.png](evidence/issue112-slot-c/recollect-10/16-mysql-preservation.png)|`3e1bbc251919799b99d4ca6ca5ad10342ed0542cded176afc8658de887d67583`|recollect-10/16-mysql-preservation.png|

### 12.5. 이번에 실제 재실행한 회귀

환경: macOS 27.2 arm64, Temurin 21.0.10, Node 25.9.0, Python 3.11.16, Docker Engine 29.2.0, Compose 5.0.2, MySQL 8.4.9, Chrome for Testing 151.0.7922.34. 아래 결과는 §3/§11의 과거 결과를 재사용하지 않고 **이번 최종 실행**에서 얻었다. 제품 코드 검증 SHA는 `b5248e09e5f9de00b24c3b4d805511c4896c8d11`이며 이후 추가 변경은 읽기 전용 증거 스크립트·문서·산출물이다.

|검증|실행 명령|이번 결과|
|---|---|---|
|FE 타입 검사·실제 빌드|fe에서 `VITE_API_BASE_URL=https://localhost:9443 COLLECTION_SITE_POLICY_FILE=../docs/data-collection/TEAM_POLICY.json npm run build:real`|PASS|
|FE Vitest|fe에서 `npm test`|932 PASS / opt-in 2 SKIP / 실패 0|
|BE·MySQL·Flyway·HTTP·실제 브라우저|`python3 tools/individual-local/run-regression.py --mysql-fixture "$SYNTHETIC_FIXTURE" --output "$OUT/regression" --ai-python "$AI_PYTHON" --chrome "$CHROME"` (내부 `./gradlew test --rerun-tasks --console=plain bootJar`)|1,141 PASS / 실패·오류·SKIP 0, 57 XML 클래스|
|로컬 도구·Export/Import|`python3 -m unittest discover -s tools/individual-local`|42 PASS (신규 종료 테스트 3개 포함, 비정상 상태 4 subcase)|
|회수·복구 Python|`python3 -m unittest discover -s tools/collection`|5 PASS|
|AI·학습 검수|`$AI_PYTHON -m pytest -q ai`|251 PASS, 의존성 경고 1|
|현재 C 읽기 전용 브라우저|`node --check fe/scripts/slot-c-final-evidence.mjs` 후 fe에서 `FOCUS_SLOT_C_DIRECTORY="$C_DIR" FOCUS_FINAL_EVIDENCE_DIRECTORY="$OUT/evidence" CHROMIUM_PATH="$CHROME" node scripts/slot-c-final-evidence.mjs`|PASS, 3 캡처 파일, 새 데이터 0|
|실수집·격리·재수집·정책 갱신·암호화 통합|`python3 tools/individual-local/run-quarantine-upgrade-e2e.py --output "$OUT/upgrade" --test-subnet 10.253.244.0/28 --chrome "$CHROME"`|PASS, 별도 신규 A 테스트 Source|
|암호화 백업·신규 스키마 복원|`python3 tools/individual-local/verify-restore.py --fixture "$POPULATED_SYNTHETIC_FIXTURE" --output "$OUT/restore-populated" --recipient "$TEST_RECIPIENT"`|PASS, 원본 보존·격리/철회 반영·release 0|

BE에는 v5→v6 동의/Export/진행률 H2·MySQL 각 27개, Session/Attempt·Privacy 격리·종료 및 실제 Chrome 수집이 포함된다. 별도 A 브라우저 회귀에서는 실제 10 Visit 완료, 뉴스 이메일 마스킹, 0/N 격리 마감, 제한 페이지 후 지속, 동일/다른 배정·중복 재수집, v5→v6 동의 Gate, 혼합 Export 21 Visit, 검수 2세션·20 Visit·16 Window를 재확인했다. C의 14 Visit에는 쓰지 않았다. 테스트 Source의 세션·동의는 실제 연구 실적 0건이다.

복원 첫 시도는 전체 회귀용 빈 focus101_synthetic DB를 선택해 필수 테이블 부재로 ledger 조회에서 실패했다. PASS로 기록하지 않았고 원본을 변경하지 않았다. 데이터가 있는 명시적 SYNTHETIC-101 Source로 다시 실행해 새 스키마에만 복원했으며 Visit 10·격리 1·철회 1·활성 release 0·Export Audit 2와 원본 보존을 확인했다. C 운영 데이터나 실제 팀원 데이터를 합성 fixture로 가장하지 않았다.

- [이번 테스트·원본 로그 SHA-256 요약](evidence/issue112-slot-c/final-stability/tests-summary.json)
- [BE XML 집계](evidence/issue112-slot-c/final-stability/junit-summary.json)
- [이번 실제 수집/재수집 통합 결과](evidence/issue112-slot-c/final-stability/upgrade-summary.json)
- [이번 백업/복원 결과](evidence/issue112-slot-c/final-stability/restore-summary.json)

원본 테스트 로그·DB·age 백업·개인키·Credential·Chrome 프로필·Registry·실제 수집 본문은 Git에서 제외했다. 선택한 비민감 상태·수량·무결성 요약과 실제 캡처만 추가했다.

### 12.6. 최종 기술적 판단과 병합 경계

**기술적 병합 준비: PASS.** 137의 직접 원인을 보존 로그로 확인했고 최소 종료 수정·반복 정상 종료·현재 데이터/개인정보 보존·v5/v6 판정·실제 수집/재수집·백업 복원 회귀를 통과했다. 중복 캡처는 같은 시각 증거의 재사용으로 정정했다. 현재 해결되지 않은 데이터 손실·개인정보 보호·수집 기능 오류는 발견하지 못했다.

사전 GitHub 조회에서 main은 protected=false, 적용 branch rule=[], 필수 status check/리뷰 없음, PR review/thread=[], mergeable=CLEAN이었다. 브랜치 보호·필수 승인·CI를 변경하거나 우회하지 않는다. 최신 증거 커밋 Push 후 원격 HEAD와 실제 검증 소스를 다시 대조하고, 병합 직전 정책·CI·충돌 상태를 재조회해 조건을 충족한 경우에만 **기존 PR #113을 merge 방식으로 main에 병합**한다. 이후 merge SHA·main HEAD·파일/정책 SHA·이미지 링크·Issue Open을 확인한 결과는 PR 댓글과 최종 응답에 기록한다. 이 보고서는 병합 전 검증 기록이며 병합 성공을 선행 주장하지 않는다.

**Issue #112 전체/현장 준비: PARTIAL 유지.** 실제 팀원 A/B/C 장비 업데이트·각자 기존 운영 데이터 백업/보존·직접 재동의·v6 적용·OS 인증서·실수집/종료/재수집·개별 Export·통합 Import/개인정보 사람 검수는 NOT_TESTED다. 1초 설정의 최초 생성 경위와 모든 장애/운영 장비 조건도 미검증이다. PR 병합 후에도 Issue #112는 Open으로 유지한다.
