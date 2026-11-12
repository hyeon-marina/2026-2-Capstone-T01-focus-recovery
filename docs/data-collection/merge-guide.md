> 현재 실제 텍스트 수집·v5 재동의·설치·학습 변환은 [페이지 원본 수집 가이드](page-content-collection.md)를 따릅니다. 아래 버전별 메타데이터 설명은 당시 동작 기록입니다.

# age Export/Import 및 데이터 통합

공통 정책은 CONFIRMED·Plan revision1이다. 별도 records.json/policy-prepare 또는 로컬 관리자 발급은 필요 없다. [설치·로그인·본인 동의](individual-local-setup.md) 후 수집한 독립 로컬 DB의 데이터를 통합한다. 기관 비대상 판단은 NOT_REQUIRED로 반영됐다. 참여자 본인이 동의한 데이터만 이용하며 자동 E2E 자료는 실제 연구160세션에 합산하지 않는다. 이번 검증의 합성 실적은 [실행 보고](institution-not-required-validation.md)에 구분했다.

Export 명령의 --recipient가 즉시 age 암호화를 수행한다. 별도 수동 암호화 단계는 없다. Source/Participant·Manifest/SHA·공통 Plan·중복·철회 재유입 검증을 유지한다. 아래의101/103 실행 예시는 당시 합성 이력이다. 현재 팀원 실행 명령은 마지막 절 또는 아래 절을 따른다. Windows 명령은 제공하되 전체 OS 실행은 NOT_TESTED다.

## 1. 수신 영역과 수신키 준비

저장소 루트에서 새 보호 경로를 준비합니다. 실데이터는 Git 밖의 승인된 보호 디스크 경로를 권장합니다. 예시 `.collection`도 Git ignore 대상이며 개인 클라우드 동기화에서 제외해야 합니다.

```sh
umask 077
mkdir -p .collection/merge/incoming
age-keygen -o .collection/merge/identity.agekey
age-keygen -y .collection/merge/identity.agekey
```

```powershell
New-Item -ItemType Directory -Path .collection/merge/incoming
icacls .collection/merge /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"
age-keygen -o .collection/merge/identity.agekey
age-keygen -y .collection/merge/identity.agekey
```

`age1...` **공개 수신키만** 참여자에게 전달합니다. 개인키는 접근 통제·승인된 별도 백업으로 보호합니다. 키를 Export와 함께 보내지 않습니다. Windows 실제 실행은 NOT_TESTED입니다.

## 2. A/B/C 파일 수신

승인된 비공개 경로로 `A-001.tar.age`, `B-001.tar.age`, `C-001.tar.age`를 받습니다. 원본 파일은 읽기 전용으로 보존하고, 받는 즉시 출처 슬롯·가명 참여자·Source Instance·Export ID·Plan revision·암호문 SHA-256·수신자·수신 일시·후속 사본 위치를 사본 대장에 기록합니다.

각 발신자가 본인 PC의 Export 성공 시 받은 **암호문 SHA-256을 인증된 별도 경로로 확인**합니다. 받은 파일에서 다시 계산한 해시만으로 발신자 인증을 대신하면 안 됩니다. age는 내용의 암호화/무결성을 제공하지만, 공개 수신키를 아는 누구나 새 파일을 만들 수 있습니다. 따라서 통합 CLI도 신뢰한 발신자의 ciphertext digest를 필수로 요구합니다.

## 3. 암호화 파일 처리

평문으로 풀어 공유 폴더에 저장하지 않습니다. `dataset.py verify/inspect/merge`는 개인키 파일로 **메모리 안에서만** 복호화합니다. 파일/전체 해독 크기 상한은256MiB입니다. 초과하면 분할 Export 설계를 검토하고 수동으로 validator를 끄지 않습니다. 서버의 snapshot 응답도 raw 본문이므로 API body logging은 금지합니다.

```sh
read -r A_SHA256
read -r B_SHA256
read -r C_SHA256
```

각 줄에 **발신자가 확인한 값**을 입력합니다. SHA-256은 Secret은 아니지만 파일과 같은 경로에서 공격자가 바꿀 수 있는 값만 신뢰하지 않습니다. PowerShell에서는 `$aHash = Read-Host 'A의 확인된 SHA-256'`처럼 준비합니다.

## 4. 외부 체크섬과 내부 무결성 검증

```sh
python3 tools/individual-local/dataset.py verify .collection/merge/incoming/A-001.tar.age \
  --identity .collection/merge/identity.agekey --sha256 "$A_SHA256"
python3 tools/individual-local/dataset.py verify .collection/merge/incoming/B-001.tar.age \
  --identity .collection/merge/identity.agekey --sha256 "$B_SHA256"
python3 tools/individual-local/dataset.py verify .collection/merge/incoming/C-001.tar.age \
  --identity .collection/merge/identity.agekey --sha256 "$C_SHA256"
```

`PASS`는 외부 해시(지정한 경우), age 복호화, tar member 안전성/중복, `checksums.sha256`, Manifest 파일 목록/SHA-256/행 수, 스키마·필드·ID·소유권·FK·Visit 수치/순서/추출을 검사한 결과입니다. 현재 동의/철회 확인은 다음 단계가 별도로 필요합니다. 오류는 exit2이며 성공 데이터셋을 만들지 않습니다. 잘못된 키/파일을 바꿔가며 기존 결과를 덮지 않습니다.

## 5. Manifest 확인

```sh
python3 tools/individual-local/dataset.py inspect .collection/merge/incoming/A-001.tar.age \
  --identity .collection/merge/identity.agekey
```

원문 본문 대신 Manifest를 출력합니다. 다음을 대장과 대조합니다.

| 필드 | 의미 |
| --- | --- |
| `schemaVersion` | `focus-raw-export/1`; 기존 v2 wire/라벨 데이터셋과 독립 버전 |
| `exportId`, `sourceInstanceId`, `participantId` | Export별 UUID / DB에 영속 저장된 출처 UUID / 가명 소유자 |
| `sourceCommit` | 빌드된 Backend의 Git SHA. 미기록 시 NOT_RECORDED, 실제 배포는 재빌드 필요 |
| `planRevision`, `goalChecksum`, `assignmentChecksum` | 세 PC에서 동일해야 함. 목표/배정의 canonical JSON checksum, 슬롯의 로컬 UUID는 제외 |
| `dataSources` | `SYNTHETIC` 또는 `PARTICIPANT`. 서로 섞지 않음 |
| `exportedAt`, `privacyAsOf` | DB snapshot의 UTC 기준 시각. 미래 철회를 증명하지 않음 |
| `privacy` | 당시 동의·격리·Tombstone 메타데이터. 최신 상태의 대체물 아님 |
| `files` | 각 JSONL 파일의 SHA-256·행 수 |
| `aiArtifacts` | NOT_INCLUDED. 없는 AI 예측·사람 라벨을 생성하지 않음 |

내부 파일은 `goals`, `assignments`, `participants`, `sessions`, `visits`, `behaviors`, `collection_attempts`, `collection_failures`, `consent_references`, `privacy_events`, `raw_quality` 각각의 `.jsonl`입니다. Manifest와 `checksums.sha256`을 함께 포함합니다. 모든 JSONL 행에는 `datasetVersion`이 있습니다. Behavior는 Visit의 Export 시점 값이며 과거 AI 판단 snapshot을 대신하지 않습니다.

## 6. 참여자·출처·계획 비교

세 파일의 동일 Plan revision 및 목표/배정 checksum, A54/B53/C53·20×4×2 분포를 확인합니다. 각 PC는 자기 슬롯/가명 참여자에만 세션을 연결해야 합니다. 한 Source가 다른 슬롯/참여자로 바뀌거나 동일 슬롯/참여자가 다른 Source로 이동하면 레지스트리가 차단합니다.

새 PC에 기존 DB를 복제하여 새 Source처럼 사용하지 않습니다. 장애 복원은 같은 출처의 격리된 복원으로 처리합니다. 의도적인 PC 이전은 기존 사본·철회 원장·출처 대장을 검토하는 별도 운영 절차가 필요하며 자동 재배정 기능은 없습니다.

## 7. 최신 개인정보 상태 확인

**#103 로컬 모드:** 통합 직전 각 참여자가 본인 Credential로 자기 최신 privacy를 조회합니다. 전체 철회 이후에도 본인 메타데이터 조회가 가능하며, 만료 시 setup --rotate-credential로 조회용 인증을 갱신합니다. 수집·동의·철회 상태를 되살리지 않습니다. 기존 운영 모드의 타인 조회만 운영자 역할과 --participant가 필요합니다. 수집과 전송을 중단하고 합의한 기준 시점 이후 이 명령을 실행합니다.

```sh
python3 tools/individual-local/dataset.py privacy \
  --server https://localhost:9443 --ca-file .collection/local/tls/localhost.pem \
  --credential-file .collection/local/participant.json \
  --output .collection/local/A-privacy-001.json
```

각 PC는 `privacySaved`, `sha256`, `observedAt`를 받습니다. 관리자는 개인정보 상태 JSON과 **별도로 인증해 확인한 SHA-256**을 받습니다. 자기 PC가 꺼져 있거나 최신 상태를 담당자가 확인할 수 없으면 해당 출처를 포함하지 않습니다. 메타데이터 파일도 비공개로 보호합니다.

CLI는 `observedAt`이 Export 기준 시각 이후이고 현재부터15분 이내여야 허용합니다. 미래 시각·레지스트리보다 오래된 상태·누락된 출처는 차단합니다. **15분은 기술적 freshness 한도이며 개인정보 보존기간이 아닙니다.** 이 확인은 해당 시각까지의 상태이며 미래 철회까지 보장하는 서명/실시간 연결이 아닙니다. 통합·배포·후속 사용 전에는 새 상태를 받아야 합니다. 지속적인 상태 확인/사본 회수 담당자가 없으면 실제 데이터 이용은 BLOCKED입니다.

## 8. Import·통합 실행

각 개인정보 상태의 확인된 해시를 준비합니다.

```sh
read -r A_PRIVACY_SHA256
read -r B_PRIVACY_SHA256
read -r C_PRIVACY_SHA256
read -r AGE_RECIPIENT
python3 tools/individual-local/dataset.py merge \
  .collection/merge/incoming/A-001.tar.age \
  .collection/merge/incoming/B-001.tar.age \
  .collection/merge/incoming/C-001.tar.age \
  --bundle-sha256 "$A_SHA256" --bundle-sha256 "$B_SHA256" --bundle-sha256 "$C_SHA256" \
  --privacy .collection/merge/incoming/A-privacy-001.json "$A_PRIVACY_SHA256" \
  --privacy .collection/merge/incoming/B-privacy-001.json "$B_PRIVACY_SHA256" \
  --privacy .collection/merge/incoming/C-privacy-001.json "$C_PRIVACY_SHA256" \
  --identity .collection/merge/identity.agekey --recipient "$AGE_RECIPIENT" \
  --registry .collection/merge/registry.sqlite --output .collection/merge/dataset-001.tar.age
```

`--bundle-sha256`의 순서는 입력 파일 순서와 같습니다. PowerShell은 `python`과 `$aHash` 등의 변수를 사용하고 한 줄로 실행하거나 backtick으로 연결합니다. 경로에 공백이 있으면 따옴표로 감쌉니다. 실데이터에서 synthetic 예외 옵션을 사용하지 않습니다.

Import는 raw DB 테이블에 쓰지 않고 검증된 JSONL 데이터셋을 만듭니다. **부분 통합은 필요한 출처의 Export/현재 privacy 쌍만 전달**하면 됩니다. 레지스트리는 원문을 보관하지 않으므로 다음 데이터셋에 계속 포함할 원본 Export도 다시 입력해야 합니다. 레지스트리에 과거 Import가 있다고 이전 데이터가 자동으로 붙지는 않습니다.

## 9. 중복·충돌 확인

- 같은 Export ID/Manifest를 반복 Import하면 레지스트리가 중복을 기록하며 세션·Visit를 추가하지 않습니다. 새 출력 이름의 논리적 데이터셋은 같고 생성시각/버전·암호문 바이트는 달라질 수 있습니다.
- 같은 Export ID에 다른 Manifest, 같은 Session/Visit/Attempt ID에 다른 원본, 다른 Source의 UUID 재사용은 거절됩니다. 종료 시각도 재사용해 바꾸지 못합니다.
- ACTIVE→ENDED, 전송 보고·검토·동의/격리 같은 메타데이터 변동은 실제 원본 ID/시도 이력을 보존하며 처리합니다. 같은 Visit의 종료 후 내용·행동 변경은 자동 덮어쓰지 않습니다.
- 동일 PLAN의 재수집은 별도 Attempt/Session입니다. 최신 Attempt만 완료 실적에 반영하고 이전 실패/재수집 메타데이터를 유지합니다.
- 다른 source의 내부 ID를 무조건 전역 PK로 사용하지 않습니다. `sourceInstanceId + entity + originalId`로 UUID5 `integratedId`와 `id_map.jsonl`을 만들고 원본 ID를 보존합니다. 기존 참조 필드는 원본 ID이며 source와 함께 해석합니다.

## 10. 참조 무결성 확인

입력은 Participant–Slot–Assignment–Attempt–Session–Visit–Behavior–Consent 및 Failure/Quality 연결을 검사합니다. 각 세션의 sequence 유일성과 양수·유효 실측5초·추출 성공·본문 길이·도메인/URL/검색어 규격을 검사하며 sequence 공백은 허용합니다. 수집 완료 플래그를 신뢰해 복사하지 않고, 종료·최신 시도·동의·privacy·최소10 Visit·서버 행 수/lastSequence와 전송 보고를 다시 계산합니다.

정상 결과를 다시 검증합니다.

```sh
python3 tools/individual-local/dataset.py verify .collection/merge/dataset-001.tar.age \
  --identity .collection/merge/identity.agekey
python3 tools/individual-local/dataset.py inspect .collection/merge/dataset-001.tar.age \
  --identity .collection/merge/identity.agekey
```

출력 데이터셋 validator도 파일 해시/행 수·세션/Visit/시도/동의/배정 FK·완료수·이론상 Window 수를 확인합니다. 원본 부족·전송 미완료·이전 실패 시도는 메타데이터 이력을 남기되 학습용 Visit 본문에서는 제외합니다.

## 11. 철회·격리 및 오래된 Export 차단

현재 withdrawn/consent invalid, QUARANTINED, Tombstone, privacy revision 불일치/현재 상태 누락인 세션은 원문 데이터셋에서 제외합니다. 레지스트리의 `denied`/`withdrawn` 기록은 단조 증가합니다. 데이터 충돌로 Import가 실패해도 먼저 확인된 철회 상태는 유지합니다. 오래된 개인정보 snapshot과 Export로 이를 되돌릴 수 없습니다. 이 레지스트리를 지우고 재수입하면 안전 기록을 잃으므로 보호 백업과 최신 원장을 함께 유지합니다.

철회 전 만든 `dataset-001.tar.age`·원본 Export·후속 사본은 **자동 삭제되지 않습니다**. 사본 대장에서 즉시 이용 중지/격리를 표시하고 새 privacy로 `dataset-002.tar.age`를 생성합니다. 모든 수신자·백업·가공/학습/로그/모델 영향의 회수 증거를 별도 확인합니다. QUARANTINED와 PURGED를 혼동하지 않습니다.

## 12. 결과의 원자적 확정과 장애

원본 Export는 바꾸지 않습니다. Import 레지스트리는 SQLite 트랜잭션을 사용하고, 암호화 결과를 신규 `.partial-*` 파일에 완전히 쓰고 fsync한 뒤 no-clobber hard link로 최종 경로를 게시합니다. 잘못된 키/검증 실패/기존 출력 경로에서는 성공본을 덮어쓰지 않습니다. 레지스트리 commit 후 파일 게시가 실패한 경우 원본과 레지스트리를 보존하고 **새 출력 경로로 같은 입력을 재시도**합니다. 영수증은 이미 기록될 수 있지만 데이터가 중복되지는 않습니다. 강제 종료 시 남은 partial 파일을 성공본으로 사용하지 않습니다.

SQLite 레지스트리에는 ID·해시·출처·privacy 금지·실행 경로 등 메타데이터만 보관하고 페이지 원문/비밀번호/Token은 저장하지 않습니다. 원문은 age 암호화 bundle 안에 있습니다. 디스크 부족·잘못된 파일·충돌은 exit2입니다.

## 13. 최종 수량과 전체/부분 완료

`rawCompleted`, `validVisits`, 참여자/목표/시나리오 분포, `privacyExcluded`, `duplicateImports`, 실패·재수집 메타데이터를 확인합니다. 계획160 중 고유 최신 PLAN160개가 원본 조건을 충족해야 `COMPLETE`입니다. 그 전에는 `PARTIAL`입니다. 합성 데이터의 COMPLETE는 실제 수집 완료가 아닙니다.

Window size3/stride1의 이론상 수는 **세션마다 `max(0,n-2)`를 계산한 합**입니다. 160×10 Visit면1600 Visit·1280 Window입니다. 실제 생성 수 `actualGeneratedWindows`, AI 분석 완료 수 `aiAnalysisCompletedWindows`와 다릅니다. 없는 Window·예측·라벨 파일을 생성하지 않고 `aiArtifacts=NOT_INCLUDED`를 기록합니다.

## 14. 최종 Manifest와 보관

`focus-raw-dataset/1` Manifest에는 원본 Export ID/Manifest SHA-256, 출처·privacy snapshot 기준시각/해시, Plan revision/체크섬, 데이터 출처, 집계·분포·제외·파일별 해시/행 수를 남깁니다. `id_map.jsonl`로 원본↔통합 ID를 추적합니다. 암호문 SHA-256도 수신자 대장에 보관합니다.

통합 직후에도 파일과 레지스트리를 접근 통제된 저장소에 보관하고, 키는 별도로 관리합니다. 승인되지 않은 보존기간/자동 삭제 일정을 임의 지정하지 않습니다. 로컬 디스크·백업·복원 사본까지 최신 철회 상태를 대조합니다.

## 15. 후속 AI·라벨링 인계

원본 목표/방문/순서/검색어/행동·동의/출처 관계를 보존하여 후속 작업에 넘깁니다. 실제 raw JSONL에는 `goalId`→`goals.description`으로 목표 원문을 연결합니다. 이 파일은 기존 v2 수집 wire와 호환되는 필드의 **별도 raw export 버전**이며 기존 제안 학습/라벨 데이터셋을 완성한 것으로 표시하지 않습니다. AI 예측·human labels·라벨 split/학습 loader는 후속 단계입니다. 참여자 ID·시나리오·관리 메타데이터를 모델 특징에 자동 혼입하지 않습니다. 후속 이용 전 새 privacy·승인 범위·사본 대장을 확인합니다.

## 16. 실제 실행한 SYNTHETIC 예시

2026-11-11 macOS에서 `run-synthetic-e2e.py`를 실행했습니다. MySQL 컨테이너3개, Spring JVM3개, 실제 Chrome MV3 Extension3개, 각10개 실측 Visit, AI 프로세스0입니다. 테스트용 GOAL-001, A PLAN-001 / B PLAN-002 / C PLAN-003만 사용했습니다. 실제 참여자 세션은0입니다.

| 단계 | 실제 결과 |
| --- | --- |
| A/B/C Export | 각1세션·10 Visit, age 암호화, 내부 파일 해시/행 수·Schema/FK 검증 PASS |
| 첫 통합 | 3세션·30 Visit·이론상 Window24, 생성0·AI분석0, PARTIAL |
| 같은3개 재Import | duplicateImports=3, 여전히3세션·30 Visit |
| 동일 Visit ID/변경 본문 | ID 충돌 거절·최종 출력 없음 |
| Plan revision 변경 | 거절·최종 출력 없음 |
| A Spring/MySQL 중지·재시작 | 동일 볼륨/등록/Credential/10 Visit·원본 완료 유지 |
| A 전체 동의 철회 뒤 재통합 | 2세션·20 Visit·이론상16, privacyExcluded=1 |
| 철회 전 개인정보 상태 재사용 | privacy rollback 거절 |
| 전체160 판정 | 별도 Python 합성 fixture 단위 테스트에서160세션/1600 Visit/1280이론상/생성0·AI0, A54/B53/C53·유형40씩 검증. Chrome에서160세션을 수집한 결과가 아님 |

A/B/C 암호문·Manifest/내부파일 체크섬은 [실행 증거 JSON](evidence/issue101-summary.json)에 있습니다. 원문·키·Credential·Export 파일 자체는 Git에 넣지 않았습니다. 로컬 최종 경로는 `.collection/validation-101-final/merged.tar.age`, 철회 반영본은 `.collection/validation-101-final/after-withdrawal.tar.age`입니다. 최초3세션 결과는 철회 이후 **이용 중지/격리 대상**이며, 합성이라도 예시로 구분합니다.

재현은 빈 출력 경로와 전용 테스트 포트에서 실행합니다. 기존 볼륨/폴더를 삭제하지 않습니다.

```sh
# JDK21 JAVA_HOME, npm ci, age, Docker 및 Playwright Chrome 설치 후
python3 tools/individual-local/run-synthetic-e2e.py \
  --output .collection/new-synthetic-run \
  --chrome "$CHROMIUM_PATH"
```

이 runner는 명시적 합성 환경에서만 테스트 계정/정책을 생성하며 제품 JAR에 Seed 코드는 포함되지 않습니다. Windows runner 실행은 NOT_TESTED입니다.

## #105 팀원이 반복할 최소 전달 절차

통합 담당자는 1절의 `age-keygen`을 한 번 실행하고 **age1... 공개키만** A/B/C에게 전달한다. 각 참여자는 다음을 실행하면 즉시 암호화된 Export가 생성된다. 평문을 따로 저장하거나 수동으로 다시 암호화할 필요가 없다. 새 파일 이름을 사용하고 후속 전달/사용 전 최신 privacy를 받는다.

macOS:

```sh
read -r AGE_RECIPIENT
python3 tools/individual-local/dataset.py export --server https://localhost:9443 --ca-file .collection/local/tls/localhost.pem --credential-file .collection/local/participant.json --recipient "$AGE_RECIPIENT" --output .collection/local/A-001.tar.age
python3 tools/individual-local/dataset.py privacy --server https://localhost:9443 --ca-file .collection/local/tls/localhost.pem --credential-file .collection/local/participant.json --output .collection/local/A-privacy-001.json
```

Windows PowerShell (**NOT_TESTED**):

```powershell
$ageRecipient = Read-Host '통합 담당자의 age1 공개키'
py -3 tools/individual-local/dataset.py export --server https://localhost:9443 --ca-file .collection/local/tls/localhost.pem --credential-file .collection/local/participant.json --recipient $ageRecipient --output .collection/local/A-001.tar.age
py -3 tools/individual-local/dataset.py privacy --server https://localhost:9443 --ca-file .collection/local/tls/localhost.pem --credential-file .collection/local/participant.json --output .collection/local/A-privacy-001.json
```

B/C는 파일 이름만 자기 슬롯으로 바꾼다. 파일 2개와 출력 SHA-256 2개를 승인된 비공개 경로/별도 인증 경로로 담당자에게 전달한다. 개인 Credential·Owner Key·TLS/age 개인키는 전달하지 않는다. 담당자는 4~8절의 verify/inspect/merge로 **자기 개인키**를 사용해 메모리에서 복호화·Manifest/SHA/Source/Participant/계획/현재 privacy·격리/철회를 검사한다. 실패 파일은 임의 수정하지 않고 보존·격리한다. 동일 Export는 멱등이며 레지스트리를 삭제하지 않는다.

#105의 title/content/searchQuery는 [고정 메타데이터 의미](real-collection-policy.md)를 가진다. 기존 Export 필드/버전은 유지하므로 원문 텍스트를 포함하는 과거 정책과 섞어 모델 학습 입력으로 자동 해석하지 않는다. metadata 표식으로 검색어를 복원하거나 HMAC 주소를 사이트에 요청하지 않는다.
