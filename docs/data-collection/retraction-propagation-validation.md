# C의 회수 전파 미확인 3건: 원인·수정·운영 승인 계획

2026-11-14 KST. Issue #119 / PR #120 후속. **PARTIAL: 최초 승인 반영 후 실제 3건 전파 PASS. 추가 저널 재기동 보호를 검증 중이며 추가 반영 승인 전**.
운영 성공과 독립 테스트를 구분하며, 추가 보호가 아직 운영에 반영됐다고 기록하지 않는다.

## 확인한 원인

C는 `individual-local`, 정책 `focus-team-raw-v2/6`, RAW_ONLY다. 운영 JAR SHA256은
`dc0a36cce8d87a8ae003c512ac4f6d58620dc8adabe6bee57b3e31b67d56a860`이다.
회수 인증키 configtree 파일이 없고 해당 환경변수/JSON override도 없다. AI 기본 주소
`http://localhost:8000`에는 리스너가 없다. 3개 AI_CACHE_AND_MEMORY target 모두
FAILED/PROPAGATION_UNCONFIRMED, 최초 관측 시도수 83~90이다. Dispatcher는 인증키가
32자 미만이면 HTTP 전송 전 실패하지만, 기존 코드는 이 경우와 연결·인증·ACK 실패를
모두 같은 오류로 기록했다. 따라서 재시도만으로 복구되지 않는 설정/배포 누락이다.

운영 분석 Window와 Outbox는 각각 0이다. 이 사실만으로 외부 캐시의 부재나 완전 삭제를
증명하지 않는다. 기존 collection_main은 승인된 추론 배포를 요구하고 모델을 적재하므로
RAW_ONLY의 회수를 해결하기 위해 이 Gate를 우회하거나 추론을 켜지 않는다.

## 수정

- BE: 회수 목적지 `focus-recovery.v2.retraction.base-url`을 선택적으로 분리한다.
  없으면 기존 AI 주소를 사용한다. HTTPS/기존 제한된 loopback·collection 네트워크 경계,
  HTTP/1.1, redirect 거절, timeout, 불변 ID, 엄격한 durable ACK, claim/lease/backoff를 유지한다.
- BE: 인증키 누락·차단 목적지·연결 실패·시간 초과·인증 거절·HTTP 거절·잘못된 ACK·인터럽트를
  고정 enum 오류로 기록한다. 원문·외부 응답·비밀값을 오류에 저장하지 않는다.
- AI: 명시적으로 구동하는 `retraction_main:app`은 기존 SQLite RetractionJournal과 기존
  인증/요청/멱등성 검증을 재사용한다. 모델 적재/다운로드/추론·공개 문서 API가 없다.
  비밀 파일 0600, 저널 디렉터리 0700, 동일 OS 소유자·절대 경로·symlink 거절을 검사한다.
  삭제/손상된 저널은 실패하며 새 빈 저널로 자동 대체하지 않는다.
- 공통 installer를 `install_retractions`로 명명하고 기존 synthetic import 별칭을 유지한다.
  public main의 내부 route 미노출과 collection_main의 승인 Gate는 유지한다.
- 독립 회귀 runner에 실제 회수 전용 receiver와 MySQL 복구 테스트를 포함한다.

DB migration/테이블/Visit 형식/FE/Chrome/IndexedDB/Queue/동의/정책 변경은 없다.
부모 privacy_retraction의 attempts/error_code는 마지막 실패 이력으로 **보존**한다.
현재 전파 상태는 target의 processing_status/error_code/verified_at/evidence_code로 판정한다.
부모 error_code가 남았다는 이유로 이미 확인된 target을 다시 실패로 간주하지 않는다.

## 검증

수정 전 실패 증거와 수정 후 결과는 `/private/tmp/focus-retraction-followup`에 분리 보존한다.

|검증|결과|
|---|---|
|수정 전 BE 재현|FAIL: AUTH_NOT_CONFIGURED 기대 시 실제 PROPAGATION_UNCONFIRMED. 최초 XML 보존|
|수정 전 AI 진입점 테스트|FAIL 8: 회수 전용 진입점 부재. 최초 로그 보존|
|BE 전체·실제 MySQL·HTTP·독립 Chrome|60 classes, 1,163 PASS, FAIL/ERROR/SKIP 0|
|추가 인터럽트 보존 포함 Dispatcher|15 PASS, FAIL/ERROR/SKIP 0. 전체 실행 후 추가 테스트만 재실행|
|AI 전체|284 PASS. 경고 1개는 기존 httpx TestClient deprecation|
|실제 FastAPI + MySQL 복구|3개 요청을 인증키 누락으로 FAILED 재현 → BE 재시작 → 같은 ID로 모두 VERIFIED. Receiver 저장 후 BE ACK 미반영 요청 재전송 포함. BE 재시작 2회, retry 2회씩, 부모 실패 횟수 유지, Tombstone 보존, PageVisit/Window 생성 0|
|독립 최소 Python 환경 실제 HTTP 반복|신규 저널 3회 × 요청 3건. 각 프로세스 재시작 후 재전송, 저널 각 3건/revision 3, 중복 0. 인증 없는 요청·ID 충돌·원문 추가 필드 거절. 추론 route 404|
|운영 C 전파 복구|PASS: 승인 후 기존 스케줄러의 실제 durable ACK로 3건 모두 VERIFIED. 저널 ID 집합/revision 3 일치, target별 추가 시도 1회, 부모 오류/시도 이력 불변|
|이번 변경의 실제 운영 Chrome 재검증|NOT_TESTED: FE/프로필은 변경하지 않음. 기존 10 Visit 검증은 별도 기존 보고서|

전체 BE suite는 신규 합성 스키마와 기존 합성 fixture만 사용했다. 운영 컨테이너/Volume에
복구하거나 실제 참여자 Visit/세션을 만들지 않았다. 재시도 시험을 위해 실제 Visit이나
체류시간을 생성하지 않았다. 이번 범위에서 FE 코드는 바뀌지 않았으며 기존 FE 검증은
[C 운영 검증 보고서](c-operating-rollout-validation.md)의 이전 결과와 구분한다.

## 승인 후에만 적용할 구체적인 운영 계획

대상 root: `/Users/hyeon/Project/2026-2-Capstone-T01-focus-recovery`.
적용 후보의 commit/JAR/파일/wheel SHA256은 비공개 `candidate/candidate.json`에 고정한다.

1. 세션 ACTIVE 0, 정상 RAW 10개 세션의 상태·ACK·행/ID 지문, 원본 회수 3건과 Tombstone,
   컨테이너/Volume/정책/Extension 파일/PDF 해시를 읽기 전용으로 기록한다.
2. 새 `.collection/rollout-backups/PR120-retraction-20261114`에 현재 DB와 기존 운영 파일을
   기존 age 키로 암호화한다. 이전 백업은 덮어쓰지 않는다. network=none, port=0, tmpfs의
   별도 MySQL에서 복호화·복구·37개 테이블·참조 관계·원본 불변 필드를 검증한다.
   활성 Worker의 재시도 횟수/lease/시각은 불변 요청과 분리해 단조 증가 계약으로 비교한다.
3. 기존 운영 브랜치를 보존하고 새 `ops/c-retraction-20261114`에 검증된 tracked source를
   반영한다. FE dist-real은 교체하거나 확장을 새로고침하지 않는다.
4. `.collection/local/retraction/`에 검증한 source, offline wheel로 설치한 전용 Python 환경,
   저널과 보호된 로그/프로세스 기록을 추가한다. 새 비밀키를 0600 configtree
   `secrets/focus-recovery.v2.retraction.service-secret`에 생성한다. 회수 전용 주소는 별도
   `secrets/focus-recovery.v2.retraction.base-url`에 `http://127.0.0.1:18000`으로 설정한다.
   AI_BASE_URL과 분석 dispatch=false, RAW_ONLY 정책은 유지한다.
5. 이 loopback port에 실제 회수 서비스 1 worker를 시작하고 health의
   RETRACTION_ONLY/realModel=false와 미노출 추론 API를 확인한다. 인증키는 출력하지 않는다.
6. `.collection/local/backend-runtime.jar`만 검증 후보로 교체한다. backend.json의 nonce와
   jcmd로 일치한 **BE 프로세스만** 정상 종료·재시작한다. HTTPS/인증서·DB/Volume·스키마·FE는 유지한다.
7. 기존 스케줄러가 기존 ID 3건을 공식 claim→HTTP→durable ACK→commit 경로로 재전송하도록
   기다린다. 최대 backoff 256초와 1분 스케줄을 고려해 제한된 시간 관찰한다. 직접 UPDATE나
   성공 ACK 조작을 하지 않는다. 저널의 실제 ID 집합과 MySQL VERIFIED 3건을 대조한다.
8. 원본 Session/Attempt/Visit/Consent/Retraction/Tombstone의 불변 필드와 정상 10 Visit의
   RAW/AI/종료/ID·sequence 지문, 모든 행 수, MySQL 컨테이너·Volume·정책·FE 해시를 재확인한다.
   target verified_at/evidence와 retry 처리 필드 외 임의 변경을 허용하지 않는다.

새 동의·세션·재수집·Export·PR 병합/Issue 종료·Chrome 조작·MySQL 재시작은 이 계획에 포함하지 않는다.

## 중단·복구와 한계

백업/격리 복구/비밀 권한/port/nonce/정합성 검사 실패 시 반영을 중단한다.
BE 교체 실패 시 요청을 성공 처리하지 않고 이전 JAR·설정을 검증해 되돌릴 수 있다.
이미 기록한 회수 저널과 서버 ACK는 보존하며 DB/Chrome 프로필을 자동 덮어쓰지 않는다.
새 receiver가 중단되면 BE는 전파 실패를 표시하고 같은 ID를 재시도한다. 저널을 삭제하거나
빈 파일로 바꿔 복구하지 않는다. Mac 재시작 후에도 같은 영속 저널을 지정해 receiver를
먼저 재기동해야 한다. 추후 실제 AI worker를 승인할 때도 **같은 저널을 mount하고 privacy
refresh가 적용됨을 검증**해야 한다. 다른 호스트/Volume에 저널 사본을 임의 생성하지 않는다.

ACK는 `AI_DURABLE_QUARANTINE_ACK_ONLY`다. Session/부모 요청은 계속 QUARANTINED이며
외부 사본/백업/로그/학습 산출물/물리 GPU 메모리의 삭제 증거는 확보한 것으로 표시하지 않는다.
이 후속 작업의 운영 전파 성공과 전체 개인정보 완전 삭제 완료를 구분한다.

## 최초 승인 반영과 실제 3건 복구

사용자가 백업·회수 서비스·BE 반영을 명시적으로 승인했다. `cc42a954e15b0067641143f5a724b075ce06f017`
소스, JAR SHA256 `34b05f31f4d6d7b9b21a1c89d0b092dc5a5f02dee3f4253e651e07975decf6c2`를
새 `ops/c-retraction-20261114`에 반영했다. 회수 전용 PID 2997, BE PID 3002이며 FE/Chrome/MySQL은
교체·재시작하지 않았다. 추가 backup DB SHA256은
`905850f29b4a6ce967d7370c2493f38f0ff424f84b362703be4154867e7e84d7`, 파일 archive SHA256은
`3e0f7ebb610bd0701fe161b3c23e437a8d1c8fa502553dd68373e874a0d85a41`다.
network=none/port0/tmpfs MySQL에서 37개 테이블·FK50개·원본 불변 필드 복구 PASS다.

2026-11-14 10:07:44 KST 관측: AI_CACHE_AND_MEMORY target **3 VERIFIED / 현재 오류 0**,
모두 `AI_DURABLE_QUARANTINE_ACK_ONLY`, 실제 SQLite 저널 3행/revision3, 원본 request/session/visit
집합 일치다. 반영 직전 시도수 94/87/94에서 각각 95/88/95로 한 번 증가했다. 부모 마지막 실패
코드 PROPAGATION_UNCONFIRMED/누적 실패 횟수는 그대로 보존했다. 이를 활성 실패 3건으로 집계하지 않는다.
부모 QUARANTINED 및 외부 증거 BLOCKED를 유지한다.

Collection Progress 전체가 반영 전과 같고 정상 세션은 유효 Visit10, ENDED/CLEAR,
deliveryConfirmed=true, RAW_COLLECTED, AI NOT_RUN, 실제 Window0이다. FE 파일과 사용자 PDF 해시도 같다.

## 추가 발견: 저널 누락을 빈 초기화로 숨기는 재기동 결함

최종 복구 검토에서 새 진입점이 재기동 시 저널이 없거나 빈 파일이어도 초기화할 수 있음을
발견했다. 운영 저널은 실제 3행을 보존 중이며 유실되지 않았다. 하지만 이미 VERIFIED된 요청은
다시 전송되지 않으므로, 저널 유실 뒤 조용한 빈 초기화는 허용하면 안 된다.

수정 전 startup 회귀에서 missing/empty 2 FAIL을 재현하고 로그를 보존했다. 런타임은
`RetractionJournal(..., initialize=False)`로 기존 schema/revision을 검증한 뒤만 시작한다.
회수 전용/승인된 모델 collection 진입점 모두 동일 원칙을 적용한다. 신규 배포/합성 fixture만
`initialize_new()`로 명시적으로 생성하며 기존 파일은 O_EXCL로 거절한다. 누락/빈 파일/손상 시
원본 파일을 바꾸지 않고 시작을 거절한다. 모델 로더도 시작하지 않는다. 독립 runner와 운영자
신규 준비 절차도 명시적 생성 방식으로 바꿨다. DB/BE/FE 계약이나 정책을 바꾸지 않는다.

추가 운영 범위는 검증 후 별도 승인받는다: 같은 저널3행·같은 인증키를 유지하고 회수 서비스의
Python main/journal 두 파일만 교체·재시작한다. BE PID/JAR, Chrome/FE, MySQL/Volume은 그대로 둔다.
새 저널·키의 암호화 백업과 독립 메모리 SQLite 복구 검증을 포함하고 기존 저널을 재초기화하지 않는다.


추가 보호 최종 독립 검증: AI 전체 **289 PASS**(최초 284에서 신규 경계 5개 추가),
BE 전체 **60 classes / 1,164 PASS, FAIL/ERROR/SKIP 0**(새 합성 스키마/실제 receiver/HTTP/MySQL/Chrome),
독립 최소 Python 실제 HTTP **신규 저널3회×요청3건·각 재기동 PASS**.
누락/빈 파일/손상 시 재초기화하지 않음, 기존 파일에 신규 초기화 거절, 승인된 모델 entrypoint가
저널 누락 시 모델 Thread를 시작하지 않음까지 검증했다. 추가 C 반영은 별도 승인 전이다.
