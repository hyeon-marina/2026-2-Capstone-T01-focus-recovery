# PR 120 재검증과 C 운영 반영 준비

2026-11-13 KST. 결과는 **PARTIAL**이다. 운영 반영·백업·실제 참여자 수집은 승인 전이며 실제 C 10 Visit 성공으로 보고하지 않는다. 기존 검증은 [수집 안정성 보고서](collection-reliability-validation.md)에 보존한다.

## 코드와 PR 기준

재확인 당시 PR #120은 Draft/open, HEAD `ba3e20c0f5d923ea5dc61fd93b912ff33d10b71e`, 공식 main `ff15a90bb9ce389b32a75dd57806ed7e215ddb48`이다. mergeable=true, CI/check 0, review/review thread 0. PR #118은 ancestry에 포함된다. 작업 트리는 clean이었다. 운영 `ops/c-foreground-rollout-20261113`과 미추적 PDF는 보존한다.

추가 결함은 독립 `fix/119/dom-observation-performance`에서 수정했다. 코드 커밋 `77cb8f9`는 이후 PR #120에 반영할 대상이다.

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

아직 실행하지 않았다. 아래 범위를 먼저 승인받는다.

1. 상태 화면 열기는 사용자 별도 승인을 받아 위와 같이 확인했다. 사용자가 새 동의·세션 없이 Chrome을 직접 종료한다. Codex는 Chrome을 임의 종료하지 않는다. 백업 직전에 Queue/ACK를 재확인하고 불명확한 상태에서 새 수집을 시작하지 않는다.
2. 실제 프로필의 확장 IndexedDB와 Local Extension Settings는 macOS 접근 허용이 필요하다. 권한을 넓히지 않으려면 사용자가 승인된 백업 명령을 직접 실행하는 방식을 사용한다. Codex가 개인정보 보호 설정을 바꾸거나 다른 프로세스로 제한을 우회하지 않는다.
3. 새 백업 디렉터리를 0700으로 생성한다. 기존 `.collection/backup-keys/C-20261113T122637-60ab9684/backup.agekey`(0600)를 이용하되 키를 복사/출력/Git 저장하지 않는다. 공개 recipient와 암호화 파일의 SHA를 확인한다.
4. 기존 Extension bundle, 실행 JAR, 운영 설정/정책/인증서와 필요한 비밀 파일, 확장 관련 프로필 영속 데이터만 암호화한다. 무관한 웹사이트 기록·Cookie·다른 확장 데이터는 수집하지 않는다. participant/owner 정보가 포함된 파일은 평문 결과물로 남기지 않는다.
5. 기존 MySQL에서 `--single-transaction --no-tablespaces --set-gtid-purged=OFF`의 일관된 schema dump를 메모리에서 age로 암호화한다. 기존 helper의 `backup`은 승인 후에만 사용한다. 운영 Volume/행/계정/정책을 바꾸지 않는다. 실제 API Export는 포함하지 않는다.
6. 복호화된 SQL은 별도 MySQL 테스트 컨테이너에만 스트리밍한다. 운영과 네트워크를 분리하고 포트를 공개하지 않으며 임시 메모리 DB를 사용한다. 스키마/PK·참조/전체 행 수와 Consent/Session/Attempt/Visit/Retraction/Tombstone/Export audit를 대조한다. 원문을 검증 로그로 출력하지 않는다. 운영 Volume으로 restore하지 않는다.
7. 백업·복호화·복구 검증이 모두 통과한 후에만 FE/BE 교체의 별도 승인을 요청한다. 프로필 접근 또는 Queue 검증이 막히면 교체하지 않는다.

## 승인 후 수행할 운영 교체

정확한 최종 SHA와 staging 파일 해시를 확정한 뒤 다시 승인받는다. 기존 C 브랜치를 변경/삭제하지 않고 새 운영 rollout 브랜치를 생성하는 방식을 제안한다. root의 PDF와 `.collection`은 보존한다.

- FE: 기존 `fe/dist-real` 절대 경로에 검증한 bundle만 반영한다. 새 경로에 별도 설치하지 않는다. 기존 Extension ID·Default·IndexedDB·HMAC key를 유지한다. Chrome 재개 후 사용자가 기존 확장을 새로고침하고 필요한 페이지를 새로고침한다.
- BE: 검증한 JAR를 같은 운영 runtime 경로로 교체하고 기존 nonce/PID 신원을 확인한 프로세스만 정상 종료·재시작한다. 동일 정책·TLS·Source·DB와 Volume을 사용한다. **`local.py stop`은 MySQL까지 중지하므로 BE만 재시작하는 승인에 사용하지 않는다.** MySQL/healthcheck 재생성은 이번 필수 변경에서 제외한다.
- 실행 후 FE/BE sourceCommit·파일 checksum·policy SHA·HTTPS·DB schema를 확인한다. runtime credential이 비워지면 사용자가 기존 Credential로 직접 재인증한다. 새 동의가 필요하면 사용자가 직접 수행한다.
- 실패 시 수집을 중지하고 변경 단계와 Queue·서버 상태를 비교한다. 이전 bundle/JAR를 복구할 수 있으나 DB/Chrome 프로필의 자동 덮어쓰기는 하지 않는다. 이미 수신된 Visit·Consent·Retraction은 바이너리 롤백으로 되돌아가지 않는다.
- 실제 세션 시작/재수집, 새로운 동의, 실제 Export, PR 병합은 각각 별도 승인을 받는다. 현재 PLAN-003을 CLEAR/ACTIVE로 바꾸지 않는다. 공식 새 Attempt 경로를 이용한다.

## 실제 C 단계별 수집 결과

|단계|로컬 Visit|서버 ACK Visit|실제 서버 저장|Pending|상태|결과|
|---|---:|---:|---:|---:|---|---|
|시작|NOT_VERIFIED|0 (기존 상태)|0 유효|0 (UI 확인)|현재 ENDED/QUARANTINED, 격리 마감 완료, 새 세션 미시작|NOT_TESTED|
|1 Visit|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|미시작|NOT_TESTED|
|5 Visit|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|미시작|NOT_TESTED|
|10 Visit|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|미시작|NOT_TESTED|
|종료|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|NOT_VERIFIED|새 세션 없음|NOT_TESTED|

실제 C의 END ACK/RAW_COLLECTED·중복/sequence·AI NOT_RUN·Export/Import는 새 세션에 대해 아직 확인하지 않았다. 합성 테스트 PASS를 이 표에 옮기지 않는다. Google 정상 검색 DOM은 과거 CAPTCHA로 미검증이며, 실제 C 성공을 대체하지 않는다.
