# A/B/C 팀원 PC 현장 검증 — 정책 v6

이 문서는 **각 팀원이 자신의 PC에서 실행하고 결과를 Issue #112에 남기는 순서표**다. 기준은 PR #113 병합 main `3cafad994fef1586d0fa371e8b69d9af7e6d42ab`이며 시작할 때 공식 main의 최신 SHA를 다시 기록한다. 제품 기능을 추가하거나 자동 동의를 실행하지 않는다.

현재 운영은 공식 `focus-team-raw-v2/6`, `RAW_ONLY`, 실제 제목·본문·허용 검색어 수집이다. 정책 SHA-256은 `31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982`다. 이후 공식 정책이 바뀌면 이 값을 임의로 고치지 말고 가이드를 갱신한 후 진행한다.

|담당|자기 PC에 설정할 슬롯|배정 수|Plan revision|
|---|---|---:|---:|
|팀원 A|A|54|1|
|팀원 B|B|53|1|
|팀원 C|C|53|1|

아래 A 예시의 슬롯 변수만 본인 값으로 바꾼다. **세 슬롯을 한 PC에 차례로 setup하지 않는다.** 다른 사람의 Credential·Source·DB를 가져오거나 테스트 Source를 연구 데이터에 합산하지 않는다.

설치 원리는 [로컬 설치](individual-local-setup.md), 추출·마스킹·v5 특수 복구는 [페이지 수집](page-content-collection.md), 담당자 통합은 [merge-guide](merge-guide.md)를 기준으로 한다. v2~v4의 METADATA_ONLY/Topic 설명과 과거 합성 예시는 현행 v6 수집 절차가 아니다.

## 1. 준비와 최신 main

필수: Git, Python **3.11+**, **JDK 21**(java/javac/keytool/jcmd), Node **22.12+**와 npm, Docker Desktop의 Linux containers·Compose, Manifest V3 확장을 실행하는 Chrome, age·age-keygen. MySQL **8.4**는 Compose가 실행한다. AI 서버·모델은 RAW_ONLY 수집에 필요 없다. 설치 링크는 [필수 프로그램](individual-local-setup.md#1-필수-프로그램-설치)을 사용한다.

최초 저장소 설치만 아래 두 줄을 실행한다. 기존 저장소를 다시 clone해 기존 로컬 디렉터리를 잃지 않는다.

```sh
git clone https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git
cd 2026-2-Capstone-T01-focus-recovery
```

기존 작업 폴더에서는 `git status --short --branch`, `git remote -v`를 먼저 확인한다. 미커밋 작업·분기된 main·다른 워크트리 충돌이 있으면 변경을 보존하고 업데이트를 중단한다. 강제 덮어쓰기나 이력 변경으로 맞추지 않는다. **origin이 공식 저장소인 경우**:

```sh
git fetch origin main
git switch main
git pull --ff-only origin main
git rev-parse HEAD
```

Fork라면 공식 저장소를 가리키는 기존 upstream을 확인한 후 `git fetch upstream main`, `git switch main`, `git merge --ff-only upstream/main`, `git rev-parse HEAD`를 사용한다. upstream이 없으면 `git remote add upstream https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git`으로 추가한다. fork의 오래된 origin/main만 보고 최신이라고 판단하지 않는다.

모든 후속 명령은 저장소 루트의 **같은 터미널**에서 실행한다. 경로에 공백이 있으면 따옴표를 유지한다. 명령은 한 줄씩 실행하고 종료 코드 0을 확인한 뒤 다음 줄로 진행한다(macOS `echo $?`, PowerShell 외부 명령 `$LASTEXITCODE`). 실패하면 해당 단계에서 중단한다.

### macOS

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
javac -version
python3 --version
node --version
npm --version
docker info
docker compose version
age --version
age-keygen --version
npm ci --prefix fe
(cd be && ./gradlew bootJar --console=plain)
python3 tools/individual-local/local.py check
SLOT=A
C_DIR="$PWD/.collection/local"
umask 077
FIELD_ROOT="$PWD/.collection/field-records"
mkdir -p "$FIELD_ROOT"
RUN=$(mktemp -d "$FIELD_ROOT/run-XXXXXXXX")
```

### Windows PowerShell — 전체 장비 설치·운영 NOT_TESTED

Docker Desktop의 WSL2/가상화·Linux containers 조건을 확인한다. 다음 JAVA_HOME에는 **설치된 JDK 21 디렉터리**를 입력한다. 새 터미널을 열었으면 환경 변수와 아래 경로 변수도 다시 설정한다.

```powershell
$env:JAVA_HOME = Read-Host '설치된 JDK 21 디렉터리 경로'
if (-not (Test-Path "$env:JAVA_HOME\bin\javac.exe")) { throw 'JDK 21 경로를 확인하세요' }
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java -version
javac -version
python --version
node --version
npm --version
docker info
docker compose version
age --version
age-keygen --version
npm ci --prefix fe
Push-Location be
.\gradlew.bat bootJar --console=plain
Pop-Location
python tools/individual-local/local.py check
$Slot = 'A'
$LocalDir = Join-Path (Get-Location) '.collection\local'
$FieldRoot = Join-Path (Get-Location) '.collection\field-records'
New-Item -ItemType Directory -Force -Path $FieldRoot | Out-Null
icacls $FieldRoot /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"
$RunDir = Join-Path $FieldRoot ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $RunDir | Out-Null
```

java와 javac 모두 21, Python 3.11 이상, Node 22.12 이상인지 확인한다. Docker 연결 실패·Linux engine 미실행·필수 명령 누락이 있으면 setup으로 진행하지 않는다. **각 명령의 종료 코드가 0인지 확인한 뒤 다음 줄을 실행한다.** macOS는 `echo $?`, PowerShell의 외부 명령은 `$LASTEXITCODE`로 확인한다.

위 저장 위치는 Git 제외 대상의 예시이며 클라우드 동기화나 다른 사용자의 읽기까지 막지는 않는다. 승인된 동기화 제외·접근 통제 디스크를 사용한다. 기존 환경의 `C_DIR` / `$LocalDir`는 **이전부터 사용한 정확한 경로**로 설정하고 임의로 이동하지 않는다. 기본 포트는 HTTPS 9443 / DB 33101이다. 다른 서비스와 충돌하면 해당 서비스를 임의 종료하지 말고 담당자에게 확인한다.

## 2. 최초 설치와 기존 설치 구분

- **최초 설치**: 로컬 디렉터리와 본인의 기존 데이터·Credential·Volume이 모두 없음을 확인한 뒤 §3으로 진행한다. 기존 DB 백업 항목은 “해당 없음 — 최초 설치, 기존 DB 없음”으로 기록한다.
- **기존 설치**: config.json의 slot/project/dbPort/tlsPort만 확인하고 participant.json 내용은 출력하지 않는다. 본인의 슬롯·디렉터리·Chrome 프로필·Volume을 유지하면서 아래 사전 확인과 백업을 수행한다.
- 슬롯이 다르거나 다른 사람의 DB, owner.key 분실, 기존 DB의 config/Source가 불명확하면 중단한다. 새 설정으로 기존 데이터를 덮어쓰지 않는다. PC 이전·운영 복구는 별도 관리 절차이며 setup으로 새 Source에 바꿔 연결하지 않는다.

기존 세션은 가능하면 정상 종료하고 END ACK=acked·미완료 POST/PATCH=0을 기다린다. 격리로 종료할 수 없다면 새로운 탐색을 멈추고 로컬 Queue/Chrome 프로필을 유지한 채 해당 상태의 DB를 백업한 후 §6의 격리 복구로 진행한다. ACTIVE/CLEAR 상태에서 정책 변경을 강행하지 않는다.

### 업데이트 전 DB 확인 — 기존 환경만

먼저 기존 Volume으로 DB만 시작한다. `db` 명령은 새 Session이나 동의를 만들지 않는다.

macOS:

```sh
python3 tools/individual-local/local.py --directory "$C_DIR" db
PROJECT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["project"])' "$C_DIR/config.json")
MYSQL_ID=$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.service=mysql' --format '{{.ID}}')
```

Windows:

```powershell
python tools/individual-local/local.py --directory $LocalDir db
$Config = Get-Content -Raw (Join-Path $LocalDir 'config.json') | ConvertFrom-Json
$Project = $Config.project
$MySqlId = @(docker ps --filter "label=com.docker.compose.project=$Project" --filter 'label=com.docker.compose.service=mysql' --format '{{.ID}}')
if ($MySqlId.Count -ne 1) { throw '본인의 MySQL 1개를 확인할 수 없습니다' }
```

대상 ID가 **본인의 Project에 속한 실행 중 MySQL 정확히 1개**인지 확인한다. macOS도 비어 있거나 여러 개면 중단한다. 아래 SQL은 수량·Source/Participant/Consent ID·Session/Attempt ID·상태·Sequence만 조회하며 본문·URL·검색어·Credential을 출력하지 않는다. DB의 UTC 시각과 현지 시각을 구분한다. 결과 파일의 식별자는 비공개로 보관하고 Issue에는 필요한 접두부와 건수만 기록한다.

macOS:

```sh
docker exec -i "$MYSQL_ID" sh -c 'export MYSQL_PWD=$(cat /run/secrets/mysql-app); exec mysql -ufocus_collection --default-character-set=utf8mb4 --table focus_collection' < docs/data-collection/team-field-check.sql > "$RUN/db-before.txt"
```

Windows:

```powershell
Get-Content -Raw -Encoding UTF8 docs/data-collection/team-field-check.sql | docker exec -i $MySqlId[0] sh -c 'export MYSQL_PWD=$(cat /run/secrets/mysql-app); exec mysql -ufocus_collection --default-character-set=utf8mb4 --table focus_collection' | Set-Content -Encoding UTF8 (Join-Path $RunDir 'db-before.txt')
if ($LASTEXITCODE -ne 0) { throw 'DB 사전 확인 실패. 업데이트를 중단하세요' }
```

SQL 종료 코드와 출력을 확인하고 기존 건수·Source/Participant/Consent·모든 Attempt를 기록한다. SQL의 valid_visits는 진단용이며 현재 동의·공식 v5→v6 호환성을 포함한 Backend의 RAW 판정을 대체하지 않는다. 중복 Sequence를 찾는 마지막 SELECT는 0행이 정상이다.

### age 암호화 백업 — 기존 환경만

본인 보관용 **새 백업 키**를 이번 실행의 보호 디렉터리에 만든다. 통합 담당자의 공개 수신키와 역할을 구분한다. 기존 키를 사용할 때는 안전한 키 경로를 지정하고 age-keygen으로 덮어쓰지 않는다. 키를 잃으면 복호화할 수 없다.

macOS:

```sh
age-keygen -o "$RUN/backup.agekey"
BACKUP_RECIPIENT=$(age-keygen -y "$RUN/backup.agekey")
python3 tools/individual-local/local.py --directory "$C_DIR" backup --recipient "$BACKUP_RECIPIENT" --output "$RUN/before.sql.age"
shasum -a 256 "$RUN/before.sql.age"
age --decrypt --identity "$RUN/backup.agekey" "$RUN/before.sql.age" > /dev/null
```

Windows:

```powershell
age-keygen -o (Join-Path $RunDir 'backup.agekey')
$BackupRecipient = age-keygen -y (Join-Path $RunDir 'backup.agekey')
python tools/individual-local/local.py --directory $LocalDir backup --recipient $BackupRecipient --output (Join-Path $RunDir 'before.sql.age')
(Get-FileHash (Join-Path $RunDir 'before.sql.age') -Algorithm SHA256).Hash.ToLowerInvariant()
age --decrypt --identity (Join-Path $RunDir 'backup.agekey') (Join-Path $RunDir 'before.sql.age') | Out-Null
if ($LASTEXITCODE -ne 0) { throw '백업 복호화 확인 실패. 업데이트를 중단하세요' }
```

backup 성공 시 출력된 SHA-256과 별도 계산값의 일치 및 복호화 확인 exit 0을 기록한다. 복호화 평문을 파일·화면·로그에 출력하지 않는다. 이는 암호문 검증이며 실제 복원 성공을 의미하지 않는다. 키는 암호문과 분리한 승인된 위치에도 보호 보관한다. 실패·디스크 부족·SHA 불일치·키 분실이면 업데이트를 중단하고 원본 DB/Volume/Chrome 프로필을 보존한다. 실데이터를 `verify-restore.py`의 SYNTHETIC-101 fixture로 취급하지 않는다. 복원이 필요하면 담당자가 최신 철회·격리 원장과 함께 **별도 격리 대상**에서 검증하고 원본 DB에 직접 복원하지 않는다. [통합 가이드 §11·14](merge-guide.md)의 철회·사본 보존 원칙을 따른다.

## 3. 본인 슬롯 최초 설정 또는 v6 업데이트

다음은 최초 설치 및 백업을 마친 기존 환경에 공통이다. 공식 정책 파일의 SHA를 대조하고 CLI 정책 검증도 실행한다.

macOS:

```sh
shasum -a 256 docs/data-collection/TEAM_POLICY.json
cat docs/data-collection/TEAM_POLICY.sha256
python3 tools/individual-local/local.py policy-validate --policy docs/data-collection/TEAM_POLICY.json --policy-sha256 31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982
python3 tools/individual-local/local.py --directory "$C_DIR" setup --slot "$SLOT"
python3 tools/individual-local/local.py --directory "$C_DIR" build
python3 tools/individual-local/local.py --directory "$C_DIR" status
```

Windows:

```powershell
(Get-FileHash docs/data-collection/TEAM_POLICY.json -Algorithm SHA256).Hash.ToLowerInvariant()
Get-Content docs/data-collection/TEAM_POLICY.sha256
python tools/individual-local/local.py policy-validate --policy docs/data-collection/TEAM_POLICY.json --policy-sha256 31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982
python tools/individual-local/local.py --directory $LocalDir setup --slot $Slot
python tools/individual-local/local.py --directory $LocalDir build
python tools/individual-local/local.py --directory $LocalDir status
```

`POLICY_INSTALLED: focus-team-raw-v2/6; plan revision 1` 및 HTTPS health 200을 확인한다. health만으로 수집 Gate가 열리지는 않는다. 최초 setup은 Secret·TLS·전용 Volume·Source·Owner·Credential을 만들지만 **본인 동의는 생성하지 않는다**. 기존 setup은 같은 ID/DB/데이터와 유효한 Credential을 유지한다. 만료 등으로 재발급하면 같은 Participant로 재로그인한다.

정확한 공식 v2/v3/v4/v5 SHA에서만 v6로 자동 업데이트한다. 사용자 지정 정책·변조 SHA·다른 소유자를 자동으로 허용하지 않는다. 과거 v5 정상 데이터의 동의 ID는 변경하지 않으며 v6 본인 재동의 후 조건부 후속 이용으로 Export한다. 격리·철회·Tombstone은 해제하지 않는다.

기존 환경은 §2 SQL을 **동일 Project**에서 재실행해 db-after-update.txt라는 새 출력 이름으로 보관한다. 업데이트 전후 Session/Attempt/Visit 건수·ID·Source·Participant를 비교한다. 본인 재동의 후 새 Consent/Event가 추가될 수 있지만 과거 Consent가 사라지면 안 된다. 감소·ID 변경·의도하지 않은 슬롯 변경이면 수집을 시작하지 않는다. 최초 설치는 SQL과 본인 슬롯의 54/53 배정을 확인한다. setup으로 컨테이너 ID가 바뀔 수 있으므로 SQL 실행 전 MYSQL_ID를 다시 조회한다.

## 4. 인증서·Extension·참여자 직접 동의

1. `keytool -printcert -file "$C_DIR/tls/localhost.cer"`(macOS) 또는 `keytool -printcert -file (Join-Path $LocalDir 'tls/localhost.cer')`(PowerShell)로 생성 주체·SHA-256 지문·localhost SAN·유효기간을 확인한다. 사용자 지정 포트는 config.json의 tlsPort를 사용한다.
2. macOS는 키체인 접근에서 **본인의** localhost 인증서를 로그인 키체인에 가져와 SSL 신뢰를 설정한다. Windows는 확인한 인증서만 아래 명령으로 현재 사용자 Root 저장소에 설치한다.

```powershell
Import-Certificate -FilePath (Join-Path $LocalDir 'tls/localhost.cer') -CertStoreLocation Cert:\CurrentUser\Root
```

3. Chrome을 완전히 재시작하고 `https://localhost:9443/api/health`가 **인증서 경고 없이** 열리는지 확인한다(포트 변경 시 실제 tlsPort 사용). 경고 우회·TLS 검증 해제·자동 테스트용 SPKI pin을 현장 검증에 사용하지 않는다. 만료되면 수집을 중단하고 인증서 갱신·재신뢰를 담당자와 확인한다.
4. `chrome://extensions`에서 최초 설치만 개발자 모드 → 압축해제된 확장 프로그램 로드 → `fe/dist-real`을 선택한다. 기존 설치는 **확장을 제거하지 않고** 같은 경로에서 재빌드 후 새로고침한다. 기존 Chrome 프로필·IndexedDB/Queue를 보존한다. 다른 프로필로 기존 미전송 Queue를 복구할 수 없다.
5. 참여자 화면의 **로컬 Credential 파일 불러오기**에서 본인 LocalDir의 participant.json을 선택한다. Slot·SHA·Plan revision 1·서버 HTTPS 연결·A54/B53/C53 배정을 확인한다. Credential 원문을 붙여넣거나 공유·촬영하지 않는다.
6. 본인이 정책 v6의 목적·실제 제목/본문/허용 검색어·마스킹·제외·보관/철회를 읽고 체크한 뒤 **수집 동의 기록 저장**을 누른다. **서버 동의 유효**, 수집 Gate 활성, 정책 6을 확인한다. 설치나 자동화 테스트 동의로 참여자 직접 동의를 대체하지 않는다.

Windows 별도 확인표 — 완료 전까지 Windows 전체를 PASS로 표시하지 않는다.

- [ ] 실제 Windows/PowerShell 버전 기록
- [ ] JAVA_HOME 및 java/javac 21, Python/Node/age PATH 확인
- [ ] WSL2/가상화·Linux engine·Compose 확인
- [ ] 파일 ACL·경로 공백·UTF-8 입출력 확인
- [ ] localhost SAN·현재 사용자 Root 신뢰·Chrome 재시작 확인
- [ ] 동일 확장 경로/Chrome 프로필·기존 Queue 유지
- [ ] HTTPS/API·본인 인증·직접 동의·Gate 확인
- [ ] 아래 10 Visit·ACK·MySQL·Export 확인

## 5. 본인 장비의 최초 정상 수집

- 본인의 실제 배정 목록에서 1개를 선택하고 화면의 Plan ID·목표·시나리오를 기록한다. PLAN-018 등 과거 테스트 ID를 모든 팀원에게 고정하지 않는다. 목표 원문은 [확정 목표](confirmed-goals-proposal.md)를 따른다.
- Gate가 유효하면 **세션 시작**을 눌러 ACTIVE를 확인한다. 접근·수집 권한이 있는 공개 비민감 페이지를 **활성 창/탭에서 각 5초 이상** 읽고 유효 Visit 10개 이상(권장 12~15개)을 확보한다. 공개 기술 문서 등 목표에 맞는 페이지를 사용하며 로그인·CAPTCHA·구독 제한은 우회하지 않는다. 같은 URL의 추적 Query만 바꿔 건수를 만들지 않는다.
- 이메일/국내 휴대전화는 저장 전 `[EMAIL]`/`[PHONE]`으로 마스킹한다. 안전하게 가릴 수 없는 연락처나 추출·접근 실패 Visit은 제외될 수 있다. 실제 민감정보를 찾거나 자신의 개인정보를 입력해 시험하지 않는다. 세부 기준은 [수집과 제외](page-content-collection.md)를 확인한다.
- **세션 종료 · 수집 중지**를 누르고 ENDED·END ACK=acked·미완료 POST/PATCH=0·진행 상태의 전송 확인을 기다린다. `원본 RAW_COLLECTED / AI NOT_RUN`·유효 Visit≥10을 확인한다. AI 포함 status나 Window 품질 상태와 원본 수집 상태를 구분한다.
- §2 SQL을 db-after-collection.txt라는 새 출력 이름으로 실행한다. 새 Session/Attempt·실제 저장 Visit 수·양수/중복 없는 Sequence·5초 이상·SUCCESS·전송 count와 최종 Sequence를 화면과 대조한다. Sequence에 빈 번호가 있다는 이유만으로 실패로 판단하지 않는다.
- 10개 미만이면 ENDED/ACK/저장이 정상이더라도 `VISITS_BELOW_10 → RECOLLECT_REQUIRED`는 정상 판정이다. 유효 Visit 부족 사유를 기록하고 같은 배정을 새 Session/Attempt로 재수집한다. 기존 4개에 6개를 더해 종료된 세션을 10개로 바꾸는 방식이 아니다.

## 6. 장애 기록과 안전한 복구

아래는 **실제로 발생한 상황**의 대응 순서이며 민감정보를 이용한 장애 유발을 요구하지 않는다. 시각·Slot·Plan·오류 코드·식별자 접두부·건수·ACK/pending을 기록한다. URL의 민감 Query·본문·Credential·setup/backend 로그 전체를 Issue에 붙이지 않는다.

|상황|안전한 조치·중단 조건|
|---|---|
|일반 페이지 Visit 제외|공개/허용 범위·추출/접근 오류를 확인하고 다른 안전한 페이지로 이동한다. 제외 검사를 해제하지 않고 다음 Visit 증가 확인|
|0/N Visit 격리|**세션 종료 · 수집 중지**, 필요 시 **재전송 / 복구**. ENDED/QUARANTINED 및 격리 마감 접수를 확인한다. 회수 작업 완료는 마감 ACK와 별도 추적|
|다음 배정 시작|격리 마감·미처리 Queue 확인 후 본인의 다른 배정을 선택한다. 기존 세션 보존|
|동일 배정 재수집|이전 Attempt의 **재수집 사유** 선택 → **사유 기록 후 재수집 허용** → 같은 Plan 시작. 새 Session/Attempt ID와 이전 기록 보존 확인|
|ACK 유실/미전송|동일 Chrome 프로필/확장의 **재전송 / 복구** 사용. 서버 상태·연결·인증 확인. 시작 연타나 새 키/프로필로 우회하지 않음|
|Backend 재시작|동일 LocalDir에서 아래 stop→db→start. 기존 프로필로 인증·재전송/복구. DB 재생성 금지|
|인증 만료|동일 Owner/LocalDir/Slot의 setup으로 재발급 후 participant.json 재등록. ACTIVE 또는 과거 정책이면 아래 “동일 정책 복구”로 의도하지 않은 정책 변경 방지|
|정책/SHA 불일치|수집 중단. 공식 SHA·config/site-policy·확장 빌드 경로/API 포트를 대조하고 백업 후 setup/build/확장 새로고침. SHA 수동 변경으로 통과시키지 않음|
|ACTIVE_SESSION_POLICY_CHANGE|정상 종료/격리 마감을 먼저 수행. v5의 0 Visit 격리로 서버 ACTIVE/CLEAR라면 같은 공식 v5 정책으로 새 코드를 실행해 마감한 뒤 v6 업데이트. 아래 절차 참조|
|MYSQL_SHUTDOWN_UNCLEAN/exit137/OOM/Error|정상 종료로 간주하지 않음. 백업/Volume/설정을 유지하고 재시작 전후 SQL·Docker 종료/복구 로그를 담당자와 확인. 감소·불일치면 이후 수집/Export 중단|
|전체 동의 철회|신규 수집 중단 유지. setup/재수집으로 철회를 해제하지 않음. 과거 Export/백업 포함 회수 및 최신 privacy를 통합 담당자에게 전달|
|Import/백업/복구 실패|원본·키·Registry·DB 보존 후 중단. 성공 표시나 결과 파일을 수동으로 조작하지 않음|

정상 재시작은 stop의 정상 종료 확인 후에만 진행한다. 수집 종료·ACK·백업을 먼저 확인하며, 이미 장애가 발생했다면 탐색을 중단하고 미전송 Queue를 그대로 보존한다.

```sh
python3 tools/individual-local/local.py --directory "$C_DIR" stop && \
python3 tools/individual-local/local.py --directory "$C_DIR" db && \
python3 tools/individual-local/local.py --directory "$C_DIR" start && \
python3 tools/individual-local/local.py --directory "$C_DIR" status
```

```powershell
python tools/individual-local/local.py --directory $LocalDir stop
if ($LASTEXITCODE -ne 0) { throw '종료 이상. 담당자와 확인하세요' }
python tools/individual-local/local.py --directory $LocalDir db
if ($LASTEXITCODE -ne 0) { throw 'DB 시작 실패. 다음 단계를 중단하세요' }
python tools/individual-local/local.py --directory $LocalDir start
if ($LASTEXITCODE -ne 0) { throw 'Backend 시작 실패' }
python tools/individual-local/local.py --directory $LocalDir status
```

main은 MySQL에 60초 유예를 주고 exit=0/OOMKilled=false/Error 없음을 확인한다. 본인 Project의 MySQL만 대상으로 한다. 강제 종료나 Volume 삭제로 stop 실패를 해결하지 않는다. start 직후 status가 연결 대기이면 보호된 backend.log로 시작 완료를 확인한 뒤 재실행한다.

동일 정책 복구: 유효한 설치 정책을 그대로 재적용한다. 값 누락·불일치면 중단한다. v5 격리는 **새 탐색 없이 마감만** 수행한 뒤 §3의 정책 인자 없는 setup으로 v6로 진행한다. [제외·격리·재수집 상세](page-content-collection.md)를 따르며 이전 정책 원본도 백업으로 보존한다.

```sh
INSTALLED_SHA=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["policySha256"])' "$C_DIR/config.json")
python3 tools/individual-local/local.py --directory "$C_DIR" setup --slot "$SLOT" --policy "$C_DIR/site-policy.json" --policy-sha256 "$INSTALLED_SHA"
python3 tools/individual-local/local.py --directory "$C_DIR" build
```

```powershell
$InstalledSha = (Get-Content -Raw (Join-Path $LocalDir 'config.json') | ConvertFrom-Json).policySha256
python tools/individual-local/local.py --directory $LocalDir setup --slot $Slot --policy (Join-Path $LocalDir 'site-policy.json') --policy-sha256 $InstalledSha
python tools/individual-local/local.py --directory $LocalDir build
```

## 7. 팀원별 Export와 통합 담당자 Import

### 각 팀원 — 공개 수신키 확인 후 암호화 전달

통합 담당자가 [merge-guide §1](merge-guide.md)에 따라 키를 만들고 `age1...` 공개키만 팀원에게 전달한다. 본인 보관용 백업 키나 Credential은 보내지 않는다. 동의가 유효한 ENDED 데이터에서 수행하며 이번 실행의 새 Run 디렉터리를 사용한다. 기존 출력 파일이 있으면 덮어쓰지 않고 새 이름을 정한다.

macOS:

```sh
read -r AGE_RECIPIENT
TLS_PORT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tlsPort"])' "$C_DIR/config.json")
SERVER="https://localhost:$TLS_PORT"
python3 tools/individual-local/dataset.py export --server "$SERVER" --ca-file "$C_DIR/tls/localhost.pem" --credential-file "$C_DIR/participant.json" --recipient "$AGE_RECIPIENT" --output "$RUN/$SLOT-001.tar.age"
shasum -a 256 "$RUN/$SLOT-001.tar.age"
python3 tools/individual-local/dataset.py privacy --server "$SERVER" --ca-file "$C_DIR/tls/localhost.pem" --credential-file "$C_DIR/participant.json" --output "$RUN/$SLOT-privacy-001.json"
```

Windows:

```powershell
$AgeRecipient = Read-Host '별도 경로로 확인한 통합 담당자의 age1 공개키'
$TlsPort = (Get-Content -Raw (Join-Path $LocalDir 'config.json') | ConvertFrom-Json).tlsPort
$Server = "https://localhost:$TlsPort"
python tools/individual-local/dataset.py export --server $Server --ca-file (Join-Path $LocalDir 'tls/localhost.pem') --credential-file (Join-Path $LocalDir 'participant.json') --recipient $AgeRecipient --output (Join-Path $RunDir "$Slot-001.tar.age")
(Get-FileHash (Join-Path $RunDir "$Slot-001.tar.age") -Algorithm SHA256).Hash.ToLowerInvariant()
python tools/individual-local/dataset.py privacy --server $Server --ca-file (Join-Path $LocalDir 'tls/localhost.pem') --credential-file (Join-Path $LocalDir 'participant.json') --output (Join-Path $RunDir "$Slot-privacy-001.json")
```

Export는 바로 age 암호화한다. privacy는 본문을 포함하지 않지만 비공개 ID/동의/격리 메타데이터이므로 Git에 넣지 않는다. **Export 후 Import 직전** 본인이 최신 privacy를 조회한다. observedAt은 Export 이후이면서 현재부터 15분 이내여야 한다. 전달에 시간이 걸리면 기존 파일을 보존하고 새 privacy 파일명으로 다시 받는다. HTTPS/본인 인증을 유지하고 실데이터에 synthetic 예외 옵션을 사용하지 않는다.

Export 출력의 SHA와 shasum/Get-FileHash 결과가 일치하는지 확인한다. 암호문과 privacy 파일 2개 및 각 출력 SHA-256을 승인된 비공개 경로로 담당자에게 전달한다. 수신 파일에서 계산한 해시만으로 발신자 인증을 대체하지 말고 별도 인증 경로로도 대조한다. Slot·Commit·Source/Participant·Export ID·Plan·시각·기술 검증/본 수집 구분·배포처를 비공개 사본 대장에 기록한다.

### 통합 담당자

[merge-guide](merge-guide.md)의 §1 키 관리 → §4 verify(발신자가 확인한 암호문 SHA 필수) → §5 inspect → §7 최신 privacy → §8 merge(Import) → §9~11 중복/참조/철회 검사 → §14 보관 순서로 진행한다. macOS/Windows 실행 예를 구분했다. 별도 import 서브커맨드는 없으며 **merge가 Import를 수행한다**.

- Source/Participant/Slot/Plan checksum·Session–Attempt–Visit–Consent 참조·Sequence·5초·최신 Attempt·전송 확인을 검사한다. 같은 DB를 다른 Source로 취급하지 않는다.
- 같은 Export 재Import는 duplicateImports에 기록하고 Visit을 중복 합산하지 않는다. 확인할 때는 동일 Registry와 **다른 새 출력 이름**을 사용한다. Registry 초기화로 재시도하지 않는다.
- 최신 철회·QUARANTINED·Tombstone·privacy revision 불일치는 제외한다. v5 정상 세션은 공식 v6 본인 재동의와 서버의 후속 이용 허가가 필요하며 동의 ID 일치만으로 판단하지 않는다.
- 각 팀원 최초 1세션 Import가 PASS여도 전체 160세션 기준은 PARTIAL이다. RAW의 COMPLETE를 라벨링·학습 완료와 혼동하지 않는다.
- merge 검증 후 [학습 검수 데이터 생성](page-content-collection.md)의 training-review → verify를 실행한다. AI 추론은 실행되지 않는다. label=null/UNLABELLED·privacyReview=REQUIRED이며 사람의 개인정보·이용 권한·라벨 검수가 남는다.
- 원본 Export·백업·파생물·Registry·최신 privacy/철회 원장·사본 대장을 접근 통제해 보관하고 개인키는 분리 관리한다. 평가 종료+90일 보존 정책과 실제 삭제 예정일·책임자를 기록한다. 철회 시 즉시 이용 중단/격리·전체 사본 회수로 진행한다. 과거 파일은 자동 삭제되지 않는다.

## 8. Issue #112에 남길 본인 기록 — 각 1건

현재 **A/B/C 본인 장비 결과는 모두 NOT_TESTED**다. 아래 표를 각자 복사해 실제 수행한 항목만 갱신한다. 실패는 FAIL, 미실시는 NOT_TESTED로 기록한다. 최초 설치라 기존 DB가 없다면 백업/보존은 “해당 없음(최초 설치, 기존 DB 없음)”으로 기록하고 임의 PASS로 표시하지 않는다. Issue에 키·Credential·원문·실제 프로필·원본 로그·암호화 데이터셋·Registry를 첨부하지 않는다.

|항목|본인 기록|
|---|---|
|Slot / 담당|본인의 A / B / C 하나, 담당자|
|시각 / OS|NOT_TESTED — 실제 OS, PowerShell/셸, JDK/Python/Node/Chrome/age/Docker 버전|
|Commit SHA|NOT_TESTED — git rev-parse HEAD|
|Policy|NOT_TESTED — v6 / 실제 SHA|
|기존 DB 백업|NOT_TESTED — PASS/FAIL, 암호문 SHA, 복호화 확인, 키 분리 보관(키 자체는 기재 금지)|
|기존 데이터 보존|NOT_TESTED — PASS/FAIL, 전후 Session/Visit/Attempt/Consent 수, Source/Participant/기존 ID 유지|
|인증서 신뢰|NOT_TESTED — PASS/FAIL, 경고 없는 HTTPS|
|직접 동의|NOT_TESTED — PASS/FAIL, 본인 확인 시각, v6|
|본인 배정 / Plan|NOT_TESTED — 54/53/53, revision 1, 실제 선택 Plan ID|
|세션 시작|NOT_TESTED — PASS/FAIL, Session/Attempt 접두부|
|유효 Visit / MySQL|NOT_TESTED — 실제 수, 5초/Sequence/중복/저장 수|
|END ACK / pending|NOT_TESTED — PASS/FAIL, acked, POST/PATCH 0|
|RAW / AI|NOT_TESTED — 실제 RAW 상태 / NOT_RUN|
|Export 검증|NOT_TESTED — PASS/FAIL, 암호문 SHA, 담당자 verify 결과, 최신 privacy 시각|
|Import 검증|미실시 — PASS/FAIL/미실시, 담당자·결과 요약|
|발견된 문제|없다고 가정하지 않는다. 오류 코드·시각·조치·미해결 사항|
|최종 판정|NOT_TESTED — PASS/FAIL/NOT_TESTED 및 대상 범위|

최초 정상 수집의 PASS는 본인 동의·Gate·저장·10 Visit·ACK/전송·RAW·데이터 보존·Export/담당자 verify까지 실제 확인한 범위에만 부여한다. 격리/만료/재수집 등을 수행하지 않았다면 해당 분기의 현장 검증은 NOT_TESTED로 남긴다.

### 기존 자동화 증거와 현장 검증 구분

[안정화 검증](collection-stability-validation.md)에는 동일 Mac의 독립 A/B/C Source에서 각 10 Visit, 암호화 통합·중복·철회 기술 검증이 있다. [C 최종 검증 §12](issue112-slot-c-validation.md)에는 동일 C의 4→10 Visit 재수집·14 Visit 보존·137 종료의 1초 timeout 근거 및 수정 후 정상 종료·v5/v6/Import 회귀가 있다. **실제 팀원 장비 3대에서 수행했다는 뜻이 아니다.** Windows 전체 설치와 OS 인증서 신뢰도 NOT_TESTED다.

Issue 종료 판단은 A/B/C 각 본인 장비에서 최초 정상 수집과 기존 데이터 보존을 확인한 뒤 수행한다. 현장 장애·개별 Export·통합 Import/사람의 개인정보 검수·회수 책임이 남으면 계속 추적한다. 가이드 작성이나 자동화 PASS만으로 Issue #112를 닫지 않는다.


## 9. 이 문서의 검증 범위 — 2026-11-13

이번 작업은 문서와 읽기 전용 SQL만 변경했다. 제품 전체 테스트를 이번에 다시 실행한 것으로 표시하지 않는다.

|이번에 수행한 검사|결과|
|---|---|
|`local.py --help`, `dataset.py --help` 및 서브커맨드 도움말|CLI 옵션 확인|
|문서 local.py/dataset.py 예시를 실제 argparse로 파싱하고 실행 직전에 중단|macOS 36개·PowerShell 34개 PASS. **Windows 셸 실행을 의미하지 않음**|
|`bash -n`으로 sh 코드 블록 검사|27개 PASS|
|상대 문서 링크·앵커 검사|43개 PASS|
|`local.py policy-validate --policy docs/data-collection/TEAM_POLICY.json --policy-sha256 31db27f078c2c80223f3887e33d1853a378e6794098f32319769f01577c2c982`|JDK 21 검증 PASS, 목표20·배정160·revision1·슬롯 A54/B53/C53·공식 SHA 확인|
|`team-field-check.sql`을 기존 독립 C 기술 검증 MySQL에 읽기 전용 실행|Session2·Attempt2·Visit14(4/10)·Consent1, Sequence 중복0·철회/Retraction/Tombstone0 확인. 새 Session/Visit/동의 생성 없음|
|위 DB의 `local.py --directory 기존경로 db` → SQL → `stop`|동일 Volume 사용, exit0/OOMKilled=false/Error 없음 확인|
|`git diff --check` 및 변경 파일 비밀정보 점검|PASS. DB·키·Credential·원문·개인 프로필 미포함|
|Windows 전체 설치·실제 팀원 A/B/C 장비·참여자 직접 동의·운영 DB 복구|**NOT_TESTED**|

C SQL 실행은 기존 기술 테스트 데이터의 조회이며 팀원 C 현장 결과나 연구용 실적이 아니다. 실제 팀원은 §8 표를 각자의 실행 결과로 별도 제출한다.
