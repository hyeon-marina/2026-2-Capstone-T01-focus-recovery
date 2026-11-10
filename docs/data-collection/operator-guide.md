# 수집 관리자 운영 가이드

현재 판정: **실제 사용자 수집 BLOCKED**. 이 저장소는 참여 준비 패키지, 통제된 합성 파일럿, 등록/발급·배정·진행률 도구를 제공합니다. 실제 사이트 v2 실행, 승인 정책·학교 절차·보존/전체 삭제, 운영 서버/TLS/실모델 검증은 완료되지 않았습니다. `enabled=true`나 이번 PR 병합으로 운영 Gate를 해제하지 않습니다. [Readiness](readiness-checklist.md)를 먼저 확인하세요.

## 1. 아키텍처와 환경

```text
참여자 화면 / MV3 Worker → v2 Collector / IndexedDB / POST·PATCH·END·회수 Queue
    → Bearer / 서버 동의 / DB 소유권 → Spring API → MySQL V1~V15
    → 영속 Compose / Analysis Outbox → 인증된 FastAPI → 상태 이력 / 알림
관리 명령 → 동일한 HTTPS 인증 → collection_operator 역할 → 메타데이터 집계·감사
```

| 환경 | 실행 경계 | 데이터/승인 |
| --- | --- | --- |
| 개발 | 기존 `fe` build/dev, `application-local`, 기존 Compose | 기존 v1 보존. v2 storage/dispatch 기본 false |
| 합성 테스트 | `test` 단일 프로필, loopback, 새 MySQL, Mock 모델 FastAPI, 닫힌 catalog | 테스트 계정·합성 정책만. 실제 160실적 제외 |
| 참여 준비 | `participant` 빌드, `collection-preparation` 프로필·TLS | 인증/배정 확인용, 일반 페이지 접근 권한 없음, v2 Gate 닫힘 |
| 실제 참여 수집 | 현재 제공하지 않음 | BLOCKED. 승인된 사이트/정책·기관/보존·회수·모델·배포 검증과 별도 Gate 변경 검토 필요 |

운영 DB/볼륨/브라우저 프로필에 아래 검증 명령을 연결하지 마세요. 합성 서버를 인터넷이나 팀 공용 수집 서버로 노출하지 않습니다. 실제 팀 공용 주소·담당자·TLS 배포가 확정되었다는 가정을 하지 않았습니다.

필수 도구: Node >=22.12, npm lockfile, JDK21 toolchain, Gradle wrapper, Python3.11, Docker Engine/MySQL8.4, Chrome. Compose override의 `!override`에는 Compose 2.24.4 이상이 필요합니다. 호스트에서 실행하는 파일럿이 검증 경로이며 전체 이미지 빌드/배포 검증과 구분합니다.

## 2. 설치와 DB 준비

저장소 루트에서 macOS/Linux:

```sh
npm ci --prefix fe
python3 -m venv .collection/venv
.collection/venv/bin/python -m pip install -r ai/requirements-test.txt
mkdir -p .collection
chmod 700 .collection
cd be
./gradlew test bootJar --console=plain
cd ..
python3 tools/collection/start-synthetic-db.py --output .collection/db.json
```

`start-synthetic-db.py`는 새 `focus97-mysql-synthetic` 컨테이너와 `127.0.0.1:3397`, `focus97_synthetic` DB를 생성합니다. 기존 이름·포트 충돌은 실패시키고 재사용/삭제하지 않습니다. DB 비밀번호는 무작위이고 stdout/Git 대신 mode600 파일에 기록합니다. 컨테이너 준비는 `docker logs focus97-mysql-synthetic`의 ready 상태로 확인합니다. 오류 로그에 원문/Secret을 복사하지 마세요. Docker 관리자 권한은 서버 운영자가 별도로 통제합니다.

기존 Compose를 쓰는 대안은 다음과 같습니다. 두 방법을 동시에 실행하지 않습니다.

```sh
# .collection/compose.env를 보호된 방식으로 준비: MYSQL_ROOT_PASSWORD만 필수
# 기존 /운영 project 이름·볼륨을 사용하지 않는다.
docker compose -p focus97-synthetic --env-file .collection/compose.env \
  -f docker-compose.yml -f compose.collection.yml up -d mysql
```

Compose override는 기존 구성을 재사용해 노출을 loopback으로 제한합니다. `up` 전체 실행은 합성 E2E 실행 명령이 아닙니다. BE/AI v2와 관리 API가 기본 차단되고 AI는 offline입니다. Docker NAT를 통한 HTTP는 Spring의 loopback 인증 예외를 만족하지 않으므로 HTTP 허용 범위를 넓히지 말고 호스트 파일럿 또는 검증된 TLS를 사용하세요. 이미지 다운로드·전체 Compose 빌드는 이번 검증 범위가 아닙니다.

Flyway는 시작 시 V1~V15를 적용하고 Hibernate `validate`를 사용합니다. V1~V14 원문은 수정하지 않습니다. 실패 시 운영 DB에서 `repair`, 수동 DROP, baseline-on-migrate, ddl-auto=create로 우회하지 않습니다. 신규 합성 DB에서만 원인/체크섬을 조사합니다.

## 3. 신뢰된 최초 관리자 초기화

HTTP에 기본 관리자·역할 부여·bootstrap Endpoint가 없습니다. 관리 API는 기본 비활성이고, 활성 설정에 더해 DB `collection_operator`의 미폐기 역할과 현재 Credential·ACTIVE 참여자를 모두 검사합니다. 권한 없는 참여자는403입니다. 신뢰된 등록 주체·기관 위임을 실제로 확인할 수 없다면 외부에 발급 기능을 열지 않습니다.

최초 역할은 신뢰된 OS/DB 관리자만 **비웹 프로세스**로 초기화합니다. `CollectionOperatorBootstrap`은 `spring.main.web-application-type=none`, 실제 non-web context, owner-only 신규 출력 파일, DB bootstrap 잠금을 요구합니다. 기존 활성 관리자가 있으면 두 번째 bootstrap을 거절합니다. 실명·Token 대신 별도 연결표의 고엔트로피 해시와 실제 위임 근거 식별자를 입력합니다. 아래는 합성 DB 전용 실행 예입니다.

```sh
# 테스트 연결표의 가명 참조를 해시화하여 값만 로컬에 확인한다. 실명/이메일 해시 예시가 아니다.
python3 -c "import hashlib,secrets; print(hashlib.sha256(secrets.token_bytes(32)).hexdigest())"
python3 tools/collection/bootstrap-synthetic-operator.py \
  --db-file .collection/db.json \
  --identity-reference-hash '<위에서 생성한 합성 연결표 참조 해시>' \
  --authority-ref synthetic-local-operator-97 \
  --output .collection/operator.json
```

초기 Credential은 1시간 유효하고 평문은 해당 mode600 파일에만 씁니다. 실제 운영에서는 실제로 확인한 위임 기록을 사용해야 합니다. 합성 위임 문자열을 실제 승인으로 사용하지 않습니다. 제품 JAR의 generic bootstrap 입력은 `{identityReferenceHash,authorityRef,credentialFile}` JSON이고 보호된 DB 환경변수를 설정한 비웹 `java -jar … --spring.main.web-application-type=none --focus-recovery.collection.bootstrap-request=<file>`로만 실행합니다. 운영 DB에서 이번 작업의 테스트를 실행하지 않았습니다.

발급 파일 기록/응답이 실패했을 때 평문을 DB에서 복구하지 않습니다. 담당 DBA가 해당 발급·역할 상태를 확인하고 안전한 폐기·재발급 절차를 따릅니다. bootstrap 실패의 예약 출력 파일을 다른 Credential로 덮어쓰지 않습니다. Windows 서버 bootstrap은 POSIX 권한 경계가 없어 거절합니다. Windows 참여자가 Linux/macOS 서버를 사용하는 것과 별개입니다.

## 4. 합성 FastAPI·BE·카탈로그 실행

세 개의 별도 터미널을 사용합니다. Secret은 실제 운영용이 아닌 독립 무작위 값을 파일로 생성합니다.

```sh
# 한 번 실행: 신규 파일만 생성한다.
python3 - <<'PY'
import os,json,secrets
fd=os.open('.collection/services.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f: json.dump({'serviceToken':secrets.token_urlsafe(32),'retractionSecret':secrets.token_urlsafe(32)},f)
PY
# 터미널 1: Mock 모델, 실제 FastAPI 구성/분석/인증/Journal 코드
.collection/venv/bin/python tools/collection/start-synthetic-ai.py \
  --secrets-file .collection/services.json --journal .collection/ai-journal.sqlite
```

터미널 2에서 Secret을 명령행에 붙이지 않고 자식 환경으로 전달합니다.

```sh
python3 - <<'PY'
import json,os,subprocess
from pathlib import Path
s=json.loads(Path('.collection/services.json').read_text())
env=os.environ.copy()
env.update(FOCUS97_DB_FILE=str(Path('.collection/db.json').resolve()),AI_V2_SERVICE_TOKEN=s['serviceToken'],COLLECTION_RETRACTION_SECRET=s['retractionSecret'])
raise SystemExit(subprocess.run(['./gradlew','runCollectionPilot','--console=plain'],cwd='be',env=env).returncode)
PY
# 터미널 3
python3 tools/collection/catalog-server.py
```

BE는 loopback8097, AI는 loopback8897, catalog는 loopback8911입니다. 모두 이 실행 도구가 정의한 **로컬 합성 서비스**입니다. `runCollectionPilot`은 test runtime classpath에서만 동작하고 bootJar에 포함되지 않습니다. SYNTHETIC 정책만 Seed하며 참여자/관리자/Token은 자동 Seed하지 않습니다. 재시작 시 같은 MySQL·Journal을 사용하고 기존 정책을 덮어쓰지 않습니다. 제품의 실제 삭제 실행 정책은 기본 거절이고 테스트용 `RetractionExecutionPolicy`만 합성 Payload 처리를 허용합니다.

운영 준비 서버는 `SPRING_PROFILES_ACTIVE=collection-preparation`과 `COLLECTION_DB_URL/USERNAME/PASSWORD`, `COLLECTION_TLS_KEYSTORE`, `COLLECTION_TLS_KEYSTORE_PASSWORD`를 비밀 관리소에서 주입하여 bootJar를 실행합니다. 기본 bind는127.0.0.1:9443이며 실제 PKCS12가 없으면 시작되지 않습니다. 관리 기능이 필요하면 `COLLECTION_ADMINISTRATION_ENABLED=true`와 별도 검증된 역할이 모두 필요합니다. 여전히 exact-test Gate를 만족하지 않아 v2 수집은 열리지 않습니다. 운영 주소·인증서·방화벽·프록시를 이 문서의 로컬 예시로 대체하지 마세요. TLS 종료 프록시는 현재 신뢰하지 않으며 직접 TLS를 설정합니다.

실모델 환경은 `ai/requirements.txt`, `ai/models/embedding.py`, `ai/models/context.py`, `ai/smoke_v2.py`를 따릅니다. 승인된 기존 로컬 가중치 경로를 `EMBEDDING_MODEL_DIR/CONTEXT_MODEL_DIR`로 지정하고 offline smoke를 먼저 실행합니다. 이 작업은 모델을 다운로드·교체·학습하지 않았습니다. smoke의 SKIPPED/FAILED를 성공으로 취급하지 않습니다. BE 응답 한도130초·lease180초·margin15초, AI 잠금60초+soft추론60초는 기존 합성 개발 값이며 운영 처리량/지연 보장이 아닙니다. v2 실패는 v1 분석으로 대체하지 않습니다.

## 5. 참여자 등록·발급·갱신·폐기

관리 명령은 Python 표준 라이브러리만 사용합니다. HTTPS를 기본으로 요구하며 `--synthetic-loopback`은 명시적127.0.0.1 HTTP 예외입니다. Redirect를 따라 Token을 전달하지 않습니다. 아래 공통 앞부분 뒤에 명령을 붙입니다.

```sh
python3 tools/collection/manage.py --server http://127.0.0.1:8097 \
  --credential-file .collection/operator.json --synthetic-loopback init
# 동일한 앞부분을 사용해 다음 명령을 실행한다.
# enroll --input .collection/enrollment-a.json
# issue --participant <서버가 반환한 UUID> --input .collection/issue-a.json --output .collection/a-credential.json
# revoke --credential-id <발급 Credential의 credentialId> --input .collection/revoke.json
# audit
```

입력 DTO:

```json
{"identityReferenceHash":"<별도 신뢰된 연결표의 64자 소문자 SHA-256>","evidenceRef":"<검증된 등록 근거 식별자>"}
```

```json
{"expiresAt":"<현재보다 미래인 UTC ISO-8601, 최대24시간>","evidenceRef":"<발급 근거 식별자>"}
```

```json
{"evidenceRef":"<폐기 근거 식별자>"}
```

이는 치환이 필요한 구조 예시이며 실행 가능한 Credential/승인 예시가 아닙니다. API는32 random bytes의 불투명 Token을 만들고 해시만 DB에 저장합니다. Token은 발급 응답에 한 번만 반환되고 관리 명령은 신규 mode600 파일에만 저장합니다. stdout은 가명 ID/만료/저장 경로만 표시합니다. 발급 한도24시간은 기술적 세션 인증 한도이며 개인정보 보존기간이 아닙니다.

재발급은 같은 참여자의 모든 기존 Credential을 원자 폐기하고 새 Credential을 만듭니다. 같은 참여자로 재인증하면 기존 Queue를 복구할 수 있습니다. 다른 참여자로 바꾸면 이전 Queue를 격리·보존하며 전송하지 않습니다. 자기 관리자 Credential도 만료 전에 같은 issue 경로로 갱신할 수 있습니다. 새 출력 파일을 사용하고 기존 파일을 덮어쓰지 않습니다. 전달/인수 확인은 승인된 비공개 경로에서 수행합니다. 제품에 기본 Token·공용 계정을 추가하지 않습니다. 역할의 최초 부여/폐기는 별도 DBA 권한 경계이며 공개 권한 부여 API는 없습니다.

## 6. 정책·목표·시나리오 배정

`ConsentService`의 현재 정책 선정·버전·적용 시각·보존/승인 참조 검증을 유지합니다. 일반 UI/환경변수는 APPROVED 정책을 만들지 않습니다. 파일럿의 SYNTHETIC 정책은 실제 동의가 아닙니다. 제품 동의 정책 변경은 신뢰된 정책 책임자/DBA의 검토·증거·Migration 밖의 통제된 관리 절차가 필요합니다. 최신 DRAFT/RETIRED·동일 적용시각 충돌은 이전 정책으로 fallback하지 않고 차단합니다. 승인·보존기간을 임의 Seed하지 마세요.

`init`은 목표20/세션160을 **초안**으로 만듭니다. 기본 A/B/C는54/53/53, 각 목표에 네 시나리오 각2회입니다. `plan`으로 현재 revision을 `.collection/plan.json`에 저장하고 검토 후 `save-plan --input`으로 반영합니다. 공통 명령의 `--output .collection/plan.json`을 사용할 수 있습니다. [초안 파일](plan.draft.json)은 목표 원문과 참여자 UUID가 null인 공개 템플릿입니다. 실제 연결표는 Git에 넣지 않습니다.

관리 절차:

1. 신뢰된 참여자 등록 응답 UUID를 `slots` A/B/C에 연결합니다. 동일 참여자를 두 슬롯에 넣지 않습니다.
2. 확정 원문을 `goals[].description`에 입력하고 실제 검토 근거 `evidenceRef`, `status=CONFIRMED`를 지정합니다. 원문이 없는20목표를 임의 최종 확정하지 않습니다.
3. `assignments[].slotId`만 조정합니다. 안정된 PLAN/goal/type/repetition은 바꾸지 않습니다. 총160/20×4×2/중복·슬롯을 서버가 검사합니다. 수정 후 참여자별 수량은 `progress`로 다시 검토합니다.54/53/53은 초기 배정이고 관리 수정 시 합계160을 유지합니다.
4. `save-plan`은 revision을 비교하고 stale update를409로 거절합니다. 실행 이력이 있는 목표·배정·슬롯의 참여자는 바꿀 수 없습니다. 다른 사용자의 sessionId를 붙이는 Endpoint가 없으며 DB 복합 FK도 소유자 불일치를 막습니다.
5. 재수집은 기존 시도와 이전 상태·사유 감사 이력을 보존한 채 `review --attempt <attemptId> --input <file>`로 `{"status":"RECOLLECT_REQUIRED","reasonCode":"<대문자_고정코드>","evidenceRef":"<검토근거>"}`를 기록합니다. FAILED도 지원합니다. 진행 중 세션은 먼저 종료하고, 새 요청 키로 같은 배정에 새 시도를 생성합니다.

시나리오는 관리 테이블에만 저장합니다. 기존 AI wire/prompt에는 goalText와 허용된 페이지 문맥만 전달하고 goalId·참여자·시나리오·정답은 전달하지 않습니다.

## 7. 진행률·품질·DB 확인

`progress`는 계획/실제 생성/종료/품질 완료/실패/재수집/격리/합성을 분리하며 참여자 슬롯·목표·시나리오별 수를 반환합니다. 관리자 조회는 역할 확인과 감사 이력을 남깁니다. 참여자 화면은 `/api/collection/progress`에서 본인 기록만 봅니다. 관리자 응답도 제목·본문·검색어·URL·rationale을 조회하거나 반환하지 않습니다.

`completed`는 최신 실제 시도 중 고유 PLAN의 `QUALITY_PASSED`만 셉니다. 합성은 `syntheticSessions/syntheticQualityPassed`에만 있습니다. 요약 `validVisits/validWindows`는 품질을 통과한 최신 실제 시도만 합산하여 실패·재수집·철회·이전 시도로1200목표를 부풀리지 않습니다. 모든 시도의 수집/분석 진단 개수는 `attempts[].quality`에서 별도로 확인합니다. 완료는 구조·전송 품질이며 사람 라벨/모델 정확도 검증이 아닙니다.

품질 기준은 종료, 최소10 유효 Visit, 고유ID·증가 sequence(숫자 공백 허용), n−2 Window, size3/stride1/실제 ordered Visit membership·position·start/end 일치, 완료된 AI 및 최신 상태 이력, dirty/error 없음, 개인정보 CLEAR, client의 종료 ACK 후 실제 전송 개수/lastSequence와 DB 일치입니다. client 보고만으로 없는 행을 완료로 처리하지 않습니다. 분석/구성이 아직 진행 중이면 조기 완료되지 않습니다.

실패 telemetry는 고정 Enum과 ID·시각만 저장하고 실패 원문을 받지 않습니다. 기존 IndexedDB 후보의 제외 정보를 ACK 전에 버리지 않고 보고 실패 시 compaction을 보류합니다. Worker 재시작은 같은 failureId로 replay합니다. BE/AI 실패는 기존 compose/outbox/분석·상태의 코드와 별도로 확인합니다. 서버 보유 실패와 브라우저가 아직 보고하지 못한 관측 실패를 같다고 보지 않습니다.

합성 DB 개수 점검 예시(서버 Secret은 컨테이너 내부 환경 사용):

```sh
docker exec focus97-mysql-synthetic sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot focus97_synthetic -e "SELECT source,COUNT(*) FROM collection_attempt GROUP BY source; SELECT status,privacy_status,COUNT(*) FROM work_session GROUP BY status,privacy_status; SELECT processing_status,COUNT(*) FROM analysis_outbox GROUP BY processing_status; SELECT reason_code,COUNT(*) FROM collection_failure GROUP BY reason_code;"'
```

운영 화면 대신 DB 원문을 일반 팀원에게 노출하지 않습니다. 저장 흐름과 JSONL 대응은 [검증 보고](environment-validation.md)에 있습니다.

## 8. 장애와 개인정보 대응

| 증상 | 운영 조치 |
| --- | --- |
| 미전송/END_PENDING | 네트워크·인증·서버 상태 확인, 같은 참여자로 재인증 후 재전송. 새ID/sequence 재번호·다른세션 복사·원본 삭제 금지 |
| 401/만료·폐기 | 발급 이력과 현재 주체 확인, 같은 참여자에게 재발급. Token을 로그로 조사하지 않음 |
| 403/동의·정책 | 서버 현재 정책·동의/철회 확인. UI 로컬값이나 v1 fallback으로 우회 금지 |
| 타인 세션404 | 잘못된 계정/배정 확인. 소유권을 임의 backfill하거나 DB 귀속 변경 금지 |
| AI timeout/FAILED | 기존 영속 error_code/lease 확인. 분석 실패를 정상 라벨이나 v1로 대체하지 않음. 재수집 사유 보존 |
| 구성 실패 | 동일 job의 claim/retry 상태 확인. 최대3회 이후 수동 원인 분석, DB job 삭제로 중복 회피 금지 |
| 저장소 오류/디스크 부족 | 신규 수집 중지. IndexedDB·DB 볼륨/미완료 원본을 보존하고 용량 복구·관리자 검토 |
| 철회/민감정보 | 화면 전체 철회 → 서버 즉시 격리 → 부모/자식·대상별 상태·AI Journal 확인. QUARANTINED는 전체 삭제 완료 아님 |

서버 재시작은 수집 중지/Queue 상태 기록 후 BE → AI를 중지하고 MySQL 볼륨·AI SQLite Journal을 보존합니다. 시작은 MySQL 준비 → AI → BE → 참여자 재인증 순서입니다. 기존 PENDING outbox/구성/철회 discovery와 lease fencing을 재사용합니다. interrupted analysis를 자동 재추론하지 않습니다. 실제 OS kill/DB daemon crash·복원 훈련은 NOT_TESTED이고 Spring context 재시작 검증과 구분합니다.

보존기간과 최소 감사/Tombstone 보존 범위는 미승인입니다. 자동 파기 일정을 임의로 만들지 않습니다. 제품 v1 Payload·FE 원문/archive·AI v1 캐시·전 Worker/GPU/모델 영향·Export·학습·로그·백업의 전체 삭제 증거가 없어 PURGED는 불가능합니다. 인증정보 폐기는 동의 철회/전체 데이터 회수를 대신하지 않습니다.

## 9. 백업·복원·수집 종료·인계

백업은 접근 제한·암호화·보존 승인 없이는 실제 개인정보 수집에 사용할 수 없습니다. 합성 DB에서만 `umask 077`을 적용한 로컬 보호 경로로 mysqldump를 저장할 수 있습니다. 비밀번호는 컨테이너 내부 환경으로 전달하고 stdout/공개로그에 남기지 않습니다. Docker volume과 SQLite Journal도 같은 privacy revision 시점의 사본으로 관리해야 합니다.

복원은 원본 서버를 덮지 않는 별도 격리 DB에서 수행합니다. 최신 철회/Tombstone/동의·Credential 폐기/AI Journal을 재적용·검증하기 전에는 FE/AI/Export를 연결하지 않습니다. 오래된 백업을 복원했다고 철회 세션·Token을 활성화하면 안 됩니다. 자동 복원·외부 사본 삭제·복원 후 재유입 차단의 운영 훈련은 이번 작업에서 미완료입니다. 이 조건 때문에 실제 수집은 BLOCKED입니다.

수집 종료는 신규 시작 차단 → 모든 세션 종료/미완료 Queue 확인 → 목표별 분포·품질·실패·철회 재검수 → 실제160 및 유효 Window1200목표 확인 → Credential 폐기 → 서버/Journals 보호 → 인계 기록 순서입니다. 합성 실적은 제외합니다. 수량 미달을 GPT 데이터·임의 체류값·재라벨로 채우지 않습니다.

후속 Export는 sessions/visits/windows/window_states/ai_predictions/human_labels/collection_failures/manifest를 분리하고 source·attempt·goal/assignment revision·consent·privacy revision의 관계를 보존해야 합니다. 현재 전체 Export·라벨링 UI·재학습은 구현하지 않았습니다. 시나리오/예측을 blind label 입력에 넣지 않습니다. 삭제/회수·승인·checksum·FK·목표12/4/4 분할 검증 없는 실제 데이터 Export는 금지합니다.

## 10. 재현 테스트와 OS 차이

`run-validation.py`는 새 focus97 DB·loopback8897만 허용합니다. 자동 테스트의 FastAPI service Token은 기존 test properties의 합성 전용 값과 맞춰야 합니다. 일상 파일럿의 무작위 services.json을 테스트 고정 Fixture Credential과 혼용하지 않습니다. 테스트는 자신이 만든 합성 운영 표를 초기화하므로 수동 파일럿과 동일 DB에서 동시에 실행하지 않습니다.

```sh
npm --prefix fe test -- --reporter=dot
npm --prefix fe run build
npm --prefix fe run build:synthetic
.collection/venv/bin/python -m pytest ai/tests -q --tb=short
.collection/venv/bin/python docs/contracts/v2/validate.py
.collection/venv/bin/python ai/smoke_v2.py
python3 -m unittest discover -s tools/collection -p 'test_*.py'
# 수동 파일럿을 중지하고 새 테스트 DB를 지정한 뒤 별도 test FastAPI를8897에 실행
AI_V2_PROFILE=synthetic-test AI_V2_ENABLED=1 \
AI_V2_SERVICE_TOKEN=synthetic-internal-service-token-95-0123456789 \
.collection/venv/bin/python be/src/test/python/v2_http_fixture.py \
  --port 8897 --retraction-journal .collection/test-journal.sqlite \
  --retraction-secret synthetic-service-only-secret-93-0123456789
# 다른 셸, 자신의 검증용 Chrome 실행 파일을 지정
python3 tools/collection/run-validation.py --db-file .collection/db.json \
  --chrome '<Chrome for Testing 실행 파일 절대경로>' --all
```

위의 Token 문자열은 기존 test 전용 Fixture이며 운영 계정/Secret으로 사용하지 않습니다. macOS 실행 파일 예시는 Chrome for Testing 앱 내부 `Contents/MacOS/Google Chrome for Testing`, Linux는 해당 chrome binary입니다. Windows의 참가자 설치는 같은 `chrome://extensions` 절차지만 이번 실제 Windows 검증은 NOT_TESTED입니다. 관리자 bootstrap/서버는 POSIX 환경을 사용합니다. Windows 개발 환경에서는 npm 명령은 동일하고 `.\gradlew.bat`, `py -3.11`, `set`/PowerShell `$env:` 문법이 필요합니다. Python 패키징은 `PYTHON=python3` 대신 설치된 Python 실행 파일을 지정할 수 있습니다. 이 OS별 명령의 실제 Windows 실행은 검증하지 않았습니다.

## 11. Extension 빌드·패키징·배포

저장소 루트에서 실행합니다.

```sh
# 기존 빌드 보존
npm --prefix fe run build
npm --prefix fe run build:synthetic
# 실행 중인 로컬 합성 파일럿
VITE_API_BASE_URL=http://127.0.0.1:8097 npm --prefix fe run build:pilot
npm --prefix fe run package:collection -- pilot
# 실제로 검증된 준비 서버의 HTTPS origin을 운영자가 지정해야 한다.
# 변수가 비었거나 잘못된 URL이면 빌드가 실패한다. 운영 주소를 이 문서에서 만들어 넣지 않는다.
VITE_API_BASE_URL="$COLLECTION_VERIFIED_API_ORIGIN" npm --prefix fe run build:participant
npm --prefix fe run package:collection -- participant
```

출력은 `fe/dist-pilot` / `fe/dist-participant`, ZIP은 `fe/packages`입니다. 기존 `dist` / `dist-synthetic`을 덮어쓰지 않습니다. `build-info.json`에 version/sourceCommit/dirty/mode/apiOrigin/actualCollection=BLOCKED, `checksums.json`에 파일 SHA-256을 포함합니다. HEAD가 바뀌었으면 패키징을 거절하므로 재빌드해야 합니다. 확정 Commit에서 깨끗한 작업트리로 빌드하고 산출물의 SHA-256·Git SHA를 별도 배포 기록으로 전달합니다. ZIP에 Secret/env/소스맵을 포함하지 않습니다.

참여 준비 Manifest는 storage/alarms와 지정 API 호스트만 허용하고 Content Script/일반 탐색 권한이 없습니다. Chrome host permission은 포트 단위로 제한할 수 없어 호스트 수준으로 요청하되 제품 fetch는 고정 origin을 사용합니다. pilot은 추가 webNavigation과127.0.0.1의 고정경로 Content Script만 갖습니다. 실제 사이트 권한·수집 adapter 활성화는 별도 승인 검토 대상입니다. 현재 build 스위치로 일반 사이트 수집을 열 수 없습니다.

macOS/Linux 위 환경변수 접두 문법과 달리 Windows PowerShell은 `$env:VITE_API_BASE_URL='…'; npm --prefix fe run build:pilot`을 사용하고 Python ZIP 실행 파일이 `python3`가 아니면 `$env:PYTHON='python'`을 지정합니다. Windows 빌드/설치 실측은 NOT_TESTED입니다. 참여자에게는 명령 실행 대신 검증된 ZIP·설치 안내를 전달합니다.


실제 BE 알림까지 추가 검증하려면 test FastAPI에 `--drift-pages`를 지정하고 검증 명령에 `FE97_EXPECT_DRIFT_ALERT=1`을 주입합니다. 이 옵션은 합성 UNRELATED 라벨을 만드는 명시적 test fixture이며 실제 모델 추론이 아닙니다. Chrome은 실제 BE의 알림 표시·선택 ACK를 확인한 뒤 Worker를 재시작합니다. 일반 파일럿/제품 모델 설정과 혼용하지 않습니다.
