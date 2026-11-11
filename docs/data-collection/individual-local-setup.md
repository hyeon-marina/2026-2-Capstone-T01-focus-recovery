# 개인 PC 설치·실행 가이드 — Issue #101

**현재 실제 참여자 수집은 BLOCKED입니다.** 이 가이드는 설치와 승인 전 준비까지 실행할 수 있습니다. 실제 수집은 [Readiness](readiness-checklist.md)의 동의·목표·기관·사이트·보존/회수·개시 승인과 독립 DB Release를 모두 갖춘 뒤 시작합니다. 합성 계정·정책을 실수집 DB에 넣지 않습니다.

기본 연결은 `Chrome → IndexedDB → https://localhost:9443 Spring Boot → 127.0.0.1:33101 MySQL`입니다. FastAPI·모델·다른 팀원의 PC는 필요하지 않습니다. A/B/C는 **각자 PC에 새 DB/볼륨**을 만듭니다. 아래 명령은 저장소 루트에서 실행하며 기본 작업 경로는 `.collection/local`입니다. 실제 실행 증거와 OS별 한계는 [검증 보고](individual-local-validation.md)에 있습니다.

## 1. 준비 프로그램

| 프로그램 | 요구사항 / 확인 |
| --- | --- |
| Git | `git --version` |
| JDK | **JDK 21**, JRE만 설치하면 안 됨. `java -version`, `javac -version`, `keytool`, `jcmd` |
| Gradle | 별도 설치 불필요. 저장소 Wrapper **9.7.1** 사용 |
| Docker Desktop | Linux container 모드와 Compose v2. `docker info`, `docker compose version` |
| MySQL | Compose가 **8.4** 이미지를 실행. 호스트 MySQL 설치 불필요 |
| Node/npm | 저장소 요구 `>=22.12`; `node --version`, `npm --version` |
| Python | 3.11 이상. 추가 pip 패키지 없이 설치/Export/통합 도구 실행 |
| age | `age --version`, `age-keygen`. 공개 수신키 암호화에 사용 |
| Chrome | MV3 지원 Chrome. 테스트에는 개인 프로필 대신 Chrome for Testing 사용 |

다운로드/설치의 기준은 [Temurin 공식 설치](https://adoptium.net/installation/), [Docker Windows 설치](https://docs.docker.com/desktop/setup/install/windows-install/), [Docker macOS 설치](https://docs.docker.com/desktop/setup/install/mac-install/), [Node 공식 다운로드](https://nodejs.org/en/download), [Python 다운로드](https://www.python.org/downloads/), [age 공식 설치](https://github.com/FiloSottile/age#installation)입니다. Windows의 WSL2/가상화·Docker 요구사항은 현재 공식 안내에 맞춥니다. 학교 PC의 설치 권한은 담당자에게 요청하고 수집 중에는 관리자 권한으로 실행하지 않습니다.

macOS에서 Homebrew를 이미 사용하는 경우 필요한 프로그램만 설치합니다.

```sh
brew install age
# JDK/Chrome/Docker/Node/Python이 없다면 위 공식 설치 프로그램 사용.
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

Windows PowerShell에서는 공식 설치 프로그램 또는 다음 패키지를 사용할 수 있습니다. 설치 후 새 터미널을 열고 JDK21의 `JAVA_HOME`과 `bin` PATH를 확인합니다. **Windows 전체 절차는 NOT_TESTED**입니다.

```powershell
winget install --exact --id EclipseAdoptium.Temurin.21.JDK
winget install --exact --id FiloSottile.age
java -version
javac -version
python --version
```

디스크에는 MySQL 볼륨·Chrome 원본/Queue·암호화 Export가 함께 남습니다. 수집 전 여유 공간과 승인된 로컬 디스크 암호화/백업 정책을 확인합니다. 개인 클라우드 동기화 폴더에 Secret·DB·Export를 두지 않습니다.

## 2. 프로젝트 준비

새 폴더에서 개인 Fork를 복제합니다. 기존 작업 폴더나 브랜치를 덮어쓰지 않습니다.

```sh
git clone https://github.com/hyeon-marina/2026-2-Capstone-T01-focus-recovery.git
cd 2026-2-Capstone-T01-focus-recovery
git remote add upstream https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git
git fetch origin
git switch --track origin/feat/101/v2-individual-local-collection
cd fe
npm ci
cd ../be
./gradlew bootJar
cd ..
python3 tools/individual-local/local.py check
```

Windows는 같은 Git 명령을 사용하고, 빌드는 아래처럼 실행합니다.

```powershell
Set-Location fe
npm ci
Set-Location ../be
.\gradlew.bat bootJar
Set-Location ..
python tools/individual-local/local.py check
```

## 3. 최초 로컬 설정

A는 `--slot A`, B/C는 자신의 슬롯을 사용합니다. 각 PC이므로 포트는 모두 같은 기본값을 사용해도 됩니다.

```sh
python3 tools/individual-local/local.py init --slot A
```

```powershell
python tools/individual-local/local.py init --slot A
```

결과는 `.collection/local`의 신규 전용 Compose 프로젝트명, 랜덤 DB 비밀번호 파일, PKCS12 및 localhost 인증서, **DRAFT** 사이트 정책입니다. 참여자·동의·관리자·수집 승인 데이터는 생성하지 않습니다. 기존 디렉터리는 거절하므로 재시작할 때 `init`을 반복하지 않습니다.

| 위치 | 내용 |
| --- | --- |
| `config.json` | 자기 슬롯·전용 project·DB/TLS 포트, 비밀번호 없음 |
| `secrets/` | DB root/app 및 PKCS12 비밀번호. 인수·화면·Git에 출력하지 않음 |
| `tls/backend.p12` | 서버 개인키 포함, 공유 금지 |
| `tls/localhost.pem`, `localhost.cer` | 공개 인증서. localhost/127.0.0.1 SAN, 90일 유효 |
| `site-policy.json` | 초기 DRAFT·허용 사이트 없음. 승인 담당자가 검토한 Artifact로만 교체 |
| `backend.log`, `backend.json` | 실행 로그와 PID/프로세스 식별값 |

POSIX는 디렉터리700/파일600, Windows는 `icacls`로 상속 제거 후 현재 사용자만 허용합니다. `local.py`와 Java 최초 운영자 초기화에 Windows ACL 경로가 있지만 **Windows NTFS·ACL 실행은 NOT_TESTED**입니다. ACL 설정 실패 시 진행하지 않습니다.

## 4. 로컬 HTTPS 인증서 신뢰

인증서 경고를 무시하거나 Chrome의 `--ignore-certificate-errors`를 사용하지 않습니다. 먼저 인증서의 SHA-256 지문과 SAN을 확인합니다.

```sh
keytool -printcert -file .collection/local/tls/localhost.cer
```

macOS: `localhost.cer`를 키체인 접근의 **로그인** 키체인으로 가져오고, 이 PC에서 생성한 인증서의 지문을 확인한 뒤 SSL 신뢰를 설정합니다. Chrome을 완전히 종료했다가 다시 시작합니다. 이 문서 작성 환경에서는 **사용자 키체인에 인증서 신뢰를 설치하지 않았습니다(NOT_TESTED)**. 대신 Python 명령은 `localhost.pem`을 명시적 신뢰 대상으로 사용해 TLS를 실제 검증했습니다.

Windows PowerShell: 지문을 확인한 이 인증서만 현재 사용자 저장소에 등록합니다. 컴퓨터 전체 Root 저장소를 변경할 필요가 없습니다.

```powershell
Import-Certificate -FilePath .collection/local/tls/localhost.cer -CertStoreLocation Cert:\CurrentUser\Root
```

Chrome에서 `https://localhost:9443/api/health`를 열어 인증서 경고가 없는지 확인합니다. 경고가 남으면 **수집을 시작하지 않습니다**. 인증서 만료/교체는 서버 중지 후 새 키·공개 인증서를 준비하고 동일 검증을 반복합니다. 기존 PKCS12를 임의 덮어쓰는 갱신 자동화는 제공하지 않습니다.

## 5. DB와 Backend 시작

Docker Desktop을 먼저 켭니다.

```sh
python3 tools/individual-local/local.py db
python3 tools/individual-local/local.py start
python3 tools/individual-local/local.py status
python3 tools/individual-local/local.py verify
```

```powershell
python tools/individual-local/local.py db
python tools/individual-local/local.py start
python tools/individual-local/local.py status
python tools/individual-local/local.py verify
```

`db`는 자기 Compose 프로젝트만 `up -d --wait`하며 기존 볼륨의 행을 보존합니다. `start`는 JAR를 background 실행하고 `backend.log`에 기록합니다. `status`가 시작 직후 실패하면 잠시 기다린 뒤 로그와 DB health를 확인합니다. 성공은 `HTTPS health: 200`입니다. **Health 200은 수집 승인 완료가 아닙니다.**

Profile은 정확히 **`individual-local` 하나**입니다. `real-collection`과 동일한 Artifact·독립 DB Release·현재 승인 동의·Build/Session Scope·허용 사이트를 검사합니다. storage flag는 있어도 승인 Artifact가 없으면 저장 Gate가 닫힙니다. AI Dispatcher는 false이고 기본 AI 서비스 Secret은 없습니다. 다른 Profile을 함께 지정해 승인 Gate를 우회할 수 없습니다.

Flyway V1~V17을 적용합니다. 기존 Migration 원문은 변경하지 않았습니다. 볼륨 이름은 `config.json`의 project에 `_local-db`를 붙인 값이고 MySQL 내부 경로는 `/var/lib/mysql`입니다. Docker Desktop VM 내부 볼륨이므로 Finder/탐색기에서 DB 파일을 직접 수정하지 않습니다. 포트는 둘 다 loopback에만 bind합니다.

## 6. 최초 관리자·참여자·계획 준비 — 운영 담당자만

실제 위임/기관/동의/사이트 승인 근거를 먼저 확보합니다. 일반 참여자는 이 절의 DB·승인 작업을 하지 않고 본인 Credential만 전달받습니다. 관리자 권한은 수집 승인이나 정책 Seed를 대신하지 않습니다.

Backend를 중지한 상태에서 DB만 실행하고, 신뢰된 담당자가 `.collection/local/bootstrap-request.json`을 보호된 방식으로 준비합니다. 필드는 `identityReferenceHash`(별도 가명 연결표 참조의 SHA-256), `authorityRef`(실제 위임 근거), `credentialFile`(새 owner-only 파일의 절대경로)입니다. 실명·이메일을 넣지 않습니다. 테스트값으로 실제 역할을 발급하지 않습니다.

```sh
python3 tools/individual-local/local.py bootstrap --request .collection/local/bootstrap-request.json
python3 tools/individual-local/local.py start
```

Windows는 `python`을 사용합니다. Windows 초기 Credential 생성은 owner ACL 초기 속성을 사용하며 미검증입니다. 기존 관리자가 있으면 초기화를 반복하지 말고 현재 관리자의 Credential 발급/회전 절차를 사용합니다. 최초 운영자 Credential은 1시간 한도이며 사용 중 만료되기 전에 기존 `issue`로 교체합니다. 자동 재발급은 없습니다.

인증된 관리 CLI에는 로컬 공개 인증서를 명시합니다.

```sh
python3 tools/collection/manage.py --server https://localhost:9443 \
  --ca-file .collection/local/tls/localhost.pem \
  --credential-file .collection/local/operator.json init
python3 tools/collection/manage.py --server https://localhost:9443 \
  --ca-file .collection/local/tls/localhost.pem \
  --credential-file .collection/local/operator.json plan --output .collection/local/plan.json
```

[관리 API](../contracts/collection-operations-api.md)의 `enroll --input`, `issue --participant UUID --input --output`으로 자기 PC의 참여자를 등록하고 별도 안전 경로로 Credential을 전달합니다. `--output` Credential은 새 파일이어야 합니다. Windows 명령은 한 줄로 실행하거나 PowerShell backtick 줄연결을 사용합니다.

운영 책임자가 동일한 목표20개 원문·근거와 배정160개를 준비합니다. 각 PC의 Plan revision을 동일하게 맞추되 **A PC에는 A 슬롯의 로컬 participantId, B/C PC에는 자기 슬롯의 ID**를 연결할 수 있습니다. goal/assignment checksum은 로컬 참여자 UUID와 별개입니다. `prepare-plan.py`는 DRAFT 설명만 병합하고 확정하지 않습니다. 팀 승인 없이는 CONFIRMED를 저장하지 않습니다. 시작한 목표·배정·소유자는 수정할 수 없고 A54/B53/C53 분포도 보존해야 합니다.

현재 실제 승인 Artifact/DB Release/정책은 제공되지 않았습니다. 승인 파일의 필드·독립 DBA Release·정책 등록 절차는 [운영 가이드의 #99 절](operator-guide.md)을 따릅니다. 원본 전용 실행도 모든 기존 승인 참조를 요구합니다. `modelEvidenceRef`를 임의로 만들지 않고, AI 미실행 원본 수집 범위의 검토 근거를 실제 담당자가 확정해야 합니다. 모델 실행은 이번 Profile의 런타임 전제가 아닙니다.

## 7. Extension 빌드·설치와 준비 판정

```sh
python3 tools/individual-local/local.py build
```

```powershell
$env:PYTHON = 'python'
python tools/individual-local/local.py build
```

기존 `build:real`과 패키징을 재사용합니다. 출력은 `fe/dist-real`, ZIP은 `fe/packages/focus-v2-real-*.zip`입니다. `build-info.json`의 apiOrigin이 `https://localhost:9443`인지 확인합니다. `checksums.json`은 파일별 SHA-256, 패키징 출력은 ZIP SHA-256입니다. 실행 JAR·설치 ZIP은 승인된 Commit에서 재빌드해 인계합니다.

Chrome의 별도 수집 프로필 → `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드합니다** → `fe/dist-real` 선택. ZIP을 받았다면 새 폴더에 풀어 해당 폴더를 선택합니다. 툴바 확장 메뉴에서 Focus Recovery를 고정하고 아이콘을 눌러 화면을 엽니다. [화면별 실습](participant-guide.md)을 이어갑니다.

준비 판정은 로그인 성공, 현재 동의 유효, 본인 배정, 확정 목표, 서버·빌드 정책 digest 일치, 독립 Release, 사이트·기관·보존·시작 승인이 모두 필요합니다. DRAFT 패키지는 서버만 접근하고 사이트 수집 권한이 없습니다. 정책을 바꾸면 Extension도 새 digest로 재빌드해야 합니다.

## 8. 종료·재시작·로그·장애

먼저 Extension에서 세션 종료 → POST/PATCH0 → 종료 ACK acked → 원본 RAW_COLLECTED를 확인합니다.

```sh
python3 tools/individual-local/local.py stop
python3 tools/individual-local/local.py db
python3 tools/individual-local/local.py start
python3 tools/individual-local/local.py status
python3 tools/individual-local/local.py logs
```

Windows는 `python`으로 동일하게 실행합니다. `stop`은 JDK `jcmd`로 PID의 실행 식별값을 대조한 뒤 해당 Backend만 종료하고 자기 MySQL만 중지합니다. 볼륨·DB·파일을 삭제하지 않습니다. stale PID/프로세스 검사 실패면 다른 프로세스를 종료하지 않고 멈춥니다. 실제 프로세스가 종료되었는지 확인한 운영자만 stale `backend.json`을 별도로 보관·이름 변경한 뒤 재시작합니다.

| 증상 | 조치 |
| --- | --- |
| 포트 사용 중 | 다른 프로세스를 임의 종료하지 않음. 최초 init에서 `--db-port`, `--tls-port`로 빈 포트 지정. TLS 포트 변경 후 새 Extension 빌드 |
| Docker 연결 실패 | Docker Desktop 실행·Linux container 모드·현재 사용자 권한 확인 |
| TLS 실패 | 공개 인증서 경로·SAN·기간·Chrome 신뢰 확인. 검증 해제 금지 |
| DB 비밀번호 오류 | 최초 init의 secrets와 볼륨의 계정을 대조. 기존 볼륨에서는 환경변수 변경만으로 비밀번호가 바뀌지 않음 |
| 401 | Credential 만료/폐기 확인 후 본인으로 재인증. 이전 Queue를 다른 계정으로 전송하지 않음 |
| 409 COLLECTION_POLICY_BLOCKED | Artifact·DB Release·승인 기간·현재 정책·빌드 digest·세션 scope 확인 |
| 원본 미완료 | 유효 Visit10 이상·종료 ACK·Queue·전송 보고·동의/격리 확인. AI 미실행 자체는 원본 실패 원인이 아님 |
| 디스크/저장 오류 | 수집 중지, 로그·공간 확인. IndexedDB/볼륨을 삭제하거나 새 세션 ID로 바꾸지 않음 |

로컬 DB 복구용 백업도 기본 평문 파일을 만들지 않습니다. 담당자의 age 공개 수신키를 준비한 뒤 다음을 실행합니다. 이 `.sql.age`는 **DB 복구용 백업**이며 참여자 JSONL Export/통합용 파일이 아닙니다.

```sh
read -r AGE_RECIPIENT
python3 tools/individual-local/local.py backup --recipient "$AGE_RECIPIENT" --output .collection/local/backup-001.sql.age
```

Windows는 `python`과 PowerShell 공개키 변수를 사용합니다. 백업은 MySQL app 계정으로 single-transaction dump를 메모리에서 직접 암호화하고 신규 출력만 게시합니다. 복구는 운영 담당자가 신규 격리 DB에만 수행하고 최신 철회 원장 적용으로 모든 Release를 폐기한 상태에서 검증합니다. 승인/Secret/참여자 정보를 포함할 수 있으므로 일반 팀원 간 전달용으로 쓰지 않습니다.

로그는 로컬에서 검토하며 원문·Credential·비밀번호를 공개 Issue에 붙이지 않습니다. 백업 복구는 별도 격리 DB와 최신 철회 원장을 사용합니다. [통합/회수 가이드](merge-guide.md)와 기존 `restore-quarantine.py`를 따르고, 복원 후 Release를 자동 재승인하지 않습니다.
