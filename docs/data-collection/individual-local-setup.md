# A/B/C 로컬 셀프 초기화 — Issue #103

#105의 현재 로컬 정책은 [공통 정책 권고안](real-collection-policy.md)과 [TEAM_POLICY.json](TEAM_POLICY.json)을 기준으로 한다. **DRAFT/UNRESOLVED·실제 개시 BLOCKED**는 유지한다. [정책 적용 절차](policy-application-guide.md), [목표20개 원문/완료 기준/시나리오](confirmed-goals-proposal.md), [사이트 검토](site-collection-review.md), [이번 실행 결과](issue105-validation.md)를 먼저 확인한다. 원본문장/검색어/제목 대신 행동·불투명 URL 식별자·고정 Topic만 저장한다. 기존 v1/AI 활성 경로의 본문 규격과 구분한다.


각 PC의 전용 MySQL·Spring과 본인 Chrome 프로필로 원본을 수집한다. 공용 서버·사설망·FastAPI·Qwen·별도 Credential 발급 관리자는 필요 없다. **실제 팀 정책·목표·개인정보/기관 판단은 현재 BLOCKED**다. 설치·계정 준비와 실제 수집 개시를 구분한다. 실행 결과와 미검증 범위는 [검증 보고](local-self-setup-validation.md)에 기록한다.

## 1. 프로그램 준비

Git, Python 3.11+, **JDK21**(java/javac/keytool/jcmd), Docker Desktop(Linux containers·Compose), Node >=22.12/npm, age/age-keygen, MV3 Chrome이 필요하다. MySQL8.4는 Docker가 실행하며 호스트 설치는 필요 없다. Gradle은 저장소 Wrapper를 쓴다.

macOS: 설치된 Homebrew로 `brew install age`, 나머지는 [Temurin](https://adoptium.net/installation/), [Docker](https://docs.docker.com/desktop/setup/install/mac-install/), [Node](https://nodejs.org/en/download), [Python](https://www.python.org/downloads/) 공식 설치 프로그램을 사용한다. JDK 선택:

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
javac -version
```

Windows PowerShell(전체 Windows 실행 **NOT_TESTED**): [Docker Windows 설치](https://docs.docker.com/desktop/setup/install/windows-install/)의 WSL2/가상화 조건을 확인한다. JDK21·Node·Python·Git·Chrome을 설치하고 새 터미널의 JAVA_HOME/PATH를 확인한다.

```powershell
winget install --exact --id EclipseAdoptium.Temurin.21.JDK
winget install --exact --id FiloSottile.age
java -version
javac -version
python --version
```

두 OS 모두 Docker Desktop을 켜고 `docker info`, `docker compose version`, `node --version`, `age --version`을 확인한다. Secret·DB·Export는 개인 클라우드 동기화 폴더에 두지 않는다.

## 2. 저장소와 빌드

```sh
git clone https://github.com/hyeon-marina/2026-2-Capstone-T01-focus-recovery.git
cd 2026-2-Capstone-T01-focus-recovery
git remote add upstream https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git
git fetch origin
git switch --track origin/feat/103/v2-local-self-setup
npm ci --prefix fe
cd be
./gradlew bootJar
cd ..
python3 tools/individual-local/local.py check
```

Windows는 같은 Git/npm 명령 후 `be`에서 `.\gradlew.bat bootJar`를 실행하고, 이후 모든 `python3`을 `python`으로 바꾼다. PowerShell에서는 아래 여러 줄 shell 명령을 한 줄로 입력한다.

## 3. 본인 슬롯 초기화

A/B/C는 **각자 PC에서 자기 한 줄만** 실행한다.

```sh
python3 tools/individual-local/local.py setup --slot A
python3 tools/individual-local/local.py setup --slot B
python3 tools/individual-local/local.py setup --slot C
```

신규 설정·랜덤 Secret·TLS → 자기 Compose MySQL → 오프라인 소유자·UUID·Credential·DRAFT 배정 → HTTPS Spring → 연결 검사 순서다. 실행 중인 자기 서버는 jcmd nonce로 확인해 중지 후 갱신하고 재시작한다. 현재 세션은 먼저 종료·ACK를 확인한다. 실제 수집 중에는 setup을 실행하지 않는다.

화면의 `READY: slot A; credential saved ... (value hidden); HTTPS verified`는 **인증 준비**이며 수집 허가가 아니다. 이어지는 `BLOCKED: common policy and 20 goals are DRAFT`는 정상적인 현재 상태다. 다른 슬롯 재실행은 차단된다. 같은 슬롯 재실행은 UUID/배정/기존 데이터를 유지한다. 유효 Credential도 유지하고, 유실·만료·폐기된 Credential만 새로 발급한다. 초기 실패 시 DB·볼륨을 삭제하지 말고 원인을 해결한 뒤 같은 명령을 반복한다.

기본 경로 `.collection/local`:

| 파일 | 용도 |
| --- | --- |
| `config.json` | 슬롯·전용 project·DB33101/TLS9443 |
| `owner.key` | 최초 OS 소유자 증명. 공유·Git 업로드 금지; 유실 시 DB를 임의 인수하지 않음 |
| `participant.json` | 본인 Credential·만료·UUID·슬롯. owner-only, 값 출력/캡처 금지 |
| `tls/backend.p12`, `secrets/` | 개인키·비밀번호, 공유 금지 |
| `tls/localhost.pem`, `localhost.cer` | 공개 인증서, SAN/지문/90일 기간 확인 |
| `site-policy.json` | 설치한 공통 정책의 정확한 바이트 |
| `setup-runtime.jar`, `backend-runtime.jar` | 실행 시점 JAR 사본. 작업 폴더 재빌드가 실행 중 JVM을 바꾸지 않음 |
| `setup.log`, `backend.log` | 보호된 진단 로그. 공유 전 검토 |

POSIX 소유자·700/600과 symlink 차단, Windows 현재 사용자 ACL을 검사한다. 이전 #101 `init` 설정은 DB가 비어 있을 때만 setup으로 이어갈 수 있다. 기존 참여자/세션/계획/정책이 있는 DB는 인수하지 않는다. 기존 데이터는 Export로 보존하고 별도 신규 디렉터리·빈 포트를 사용한다. 같은 PC에서 테스트할 때만 `--directory NEW --db-port 33231 --tls-port 19543`처럼 격리한다. 실제 A/B/C 슬롯을 다른 PC로 복제하지 않는다.

## 4. 로컬 HTTPS

```sh
keytool -printcert -file .collection/local/tls/localhost.cer
python3 tools/individual-local/local.py status
```

macOS는 생성한 인증서를 로그인 키체인에 가져와 지문을 확인한 뒤 SSL 신뢰를 설정한다. Windows는 확인한 공개 인증서만 현재 사용자 저장소에 설치한다.

```powershell
Import-Certificate -FilePath .collection/local/tls/localhost.cer -CertStoreLocation Cert:\CurrentUser\Root
```

Chrome을 완전히 재시작하고 `https://localhost:9443/api/health`에 경고 없이 연결되는지 확인한다. Python은 `localhost.pem`으로 서버 인증서를 검증한다. 인증서 경고 무시·TLS 검증 해제는 사용하지 않는다. Chrome OS 신뢰 설치와 실제 승인된 HTTPS 수집은 이 작업에서 **NOT_TESTED**다. 인증서 만료 시 수집 중지 후 개인키·인증서 교체/신뢰 검증이 필요하다. 기존 PKCS12를 자동 덮어쓰지 않는다.

## 5. 팀의 공통 정책 적용

[TEAM_POLICY.json](TEAM_POLICY.json)은 수집 기본안을 채운 DRAFT이며, [local-policy.draft.json](local-policy.draft.json)은 기존 빈 양식으로 보존한다. 같은 정책 선택을 다시 할 필요 없이 [실제 증거 입력 절차](policy-application-guide.md)를 따른다. 팀의 실제 최종 목표20개·수집 목적/항목/이용·보존/삭제·민감페이지/본문/검색어 처리·변경/만료·정확한 HTTPS 사이트/경로·명시적 개시 범위·근거를 채운다. 기관 판단은 `REQUIRED_SATISFIED` 또는 실제 근거가 있는 `NOT_REQUIRED`와 `evidenceRef`다. 미확정은 `UNRESOLVED`로 남기며 수집은 차단된다. 모델 실행 증거 필드는 RAW_ONLY에 없다.

공통 Plan은 revision>=1, 목표 `CONFIRMED`와 실제 원문/evidenceRef, 160개 기존 배정, 빈 participantId 슬롯3개를 포함한다. 로컬 UUID는 setup이 자기 슬롯에만 연결한다. 다른 PC의 UUID를 공통 파일에 넣지 않는다. A54/B53/C53·목표별4유형×2회는 고정이다.

팀이 확정 파일을 만든 뒤 다음 명령으로 공통 Plan checksum을 계산한다.

```sh
python3 tools/individual-local/local.py policy-checksum --policy TEAM_POLICY.json
```

출력 `planChecksum`을 파일의 해당 필드에 넣고 **다시 실행**해 최종 파일 SHA-256을 확인한다. Plan checksum은 키를 정렬한 compact UTF-8 JSON의 SHA-256(줄바꿈 없음)이다. 팀은 파일과 **별도 인증 경로로 확인한 최종 SHA-256**을 세 명에게 동일하게 전달한다. SHA-256은 파일 무결성 확인이며 실제 사람/기관 승인을 증명하는 서명은 아니다. 실제 검토 기록과 담당자·회수 연락 경로를 별도로 보관한다. 제공되지 않은 승인 값을 임의 생성하지 않는다.

```sh
python3 tools/individual-local/local.py setup --slot A --policy TEAM_POLICY.json --policy-sha256 TEAM_CONFIRMED_SHA256
```

B/C는 자기 슬롯을 쓴다. CLI는 정확한 파일 hash와 정책·Plan·기간·사이트를 검사하고 DB 동의 정책과 Release/scope 메타데이터를 **한 번에 자동 연결**한다. 별도 운영자 등록/발급/DBA Release 요청은 없다. HTTP 관리자 API는 individual-local에서 기본 비활성이다. 기존 real-collection의 독립 승인·모델 증거 경로는 그대로다.

정책 변경의 notBefore는 이전 정책보다 뒤여야 한다. 정책 변경은 새 policyVersion·새 파일 hash·재빌드·재동의가 필요하다. 활성 세션이 있으면 적용을 거절한다. 실행 이력이 있는 공통 Plan은 변경하지 않는다. 이전 정책 세션을 새 정책에 자동 재연결하지 않는다. 복원 도구가 폐기한 Release를 같은 정책 재실행으로 되살리지 않으며, 실제 재검토한 새 버전이 필요하다.

## 6. Extension 설치·로그인·동의

```sh
python3 tools/individual-local/local.py build
```

`fe/dist-real`과 설치 ZIP이 만들어진다. Credential은 정적 Extension에 포함되지 않는다. `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드합니다** → `fe/dist-real` → 아이콘으로 참여자 화면을 연다. 본인 전용 Chrome 프로필을 쓴다.

**로컬 Credential 파일 불러오기**에서 `.collection/local/participant.json`을 선택한다. 파일은 본인 프로필의 확장 UI에서만 읽고 Token은 MV3 trusted-context **session storage**에 저장한다. 콘텐츠 스크립트/local/sync/IndexedDB에 복제하지 않는다. 파일 업로드나 다른 프로필 자동 전파를 하지 않는다. 수동 password 입력도 가능하다. Chrome 완전 종료 후 다시 파일을 선택한다.

화면에서 로컬 슬롯·HTTPS 연결·Credential 준비·정책 SHA-256·차단 사유를 확인한다. 목적·항목·범위·보존/삭제·민감페이지/검색어/본문 처리·철회를 읽고 체크박스를 직접 선택해 **수집 동의 기록 저장**을 누른다. setup은 동의하지 않는다. 목표를 선택하고 시나리오를 읽는다. **세션 시작**은 본인 배정·확정 목표·유효 정책·동의·빌드 일치 상태에서만 가능하다. 정책을 바꿨다면 build 후 확장을 새로고침하고 재로그인한다.

## 7. 탐색·완료·Export·철회

1. **세션 시작** 후 허용 사이트의 공개 페이지에서 목표/시나리오대로 탐색한다. 로그인·계정·금융·결제·민감 DOM/URL은 제외한다.
2. 활성 탭/창의 실측5초 이상 Visit만 유효하다. 4초 미만 복귀 누적·최초5분 PATCH·size3/stride1은 유지한다.
3. 서버 수신 Visit10개 이상(권장12~15), Queue와 오류를 확인한다.
4. **세션 종료 · 수집 중지** → POST/PATCH0 → 종료 ACK `acked` → 전송 확인 → `원본 RAW_COLLECTED`·`AI NOT_RUN`을 확인한다. AI 포함 QUALITY_PASSED와 구분한다.
5. 부족/실패하면 **재수집 사유**를 선택하고 **사유 기록 후 재수집 허용**을 누른 뒤 같은 PLAN을 새 시도로 수행한다. 본인의 종료·CLEAR 세션만 가능하며 이력은 남는다. 최신 유효 시도만 집계한다.
6. [Export/암호화/통합 가이드](merge-guide.md)대로 `.tar.age`를 신규 출력한다. 암호문과 별도 SHA-256·최신 privacy를 전달하며 원문/키/Token은 GitHub에 올리지 않는다.
7. 철회하려면 **전체 동의 철회 · 수집 즉시 중지**를 누른다. 연결이 없으면 요청이 보존되며 복구 후 재전송한다. `QUARANTINED`는 전체 삭제 완료가 아니다. 최신 상태를 통합 담당자에게 전달하고 외부 사본·백업의 회수/삭제를 실제 방침에 따라 확인한다.

## 8. 복구와 Credential 회전

```sh
python3 tools/individual-local/local.py setup --slot A --rotate-credential
```

기존 Credential을 원자 폐기하고 본인 UUID를 유지한다. 이전 파일의 값은 다시 인증할 수 없다. 확장에서 새 파일을 선택한다. 철회 후에도 이 명령은 **최신 privacy 조회용 인증만** 갱신하며 철회·격리·수집 차단을 해제하지 않는다. 비활성 계정과 소유자 키 불일치는 거절한다.

| 상황 | 조치 |
| --- | --- |
| 설치 누락/JDK | setup의 MISSING_PROGRAMS/JDK_REQUIRED를 확인하고 위 프로그램 준비 |
| 서버·Docker 오류 | Docker 실행, `status`, 보호된 backend.log/setup.log, 포트 확인 |
| TLS 오류 | SAN·지문·기간·Chrome 사용자 신뢰 확인; 검증 해제 금지 |
| Credential 없음/401 | setup 재실행 또는 `--rotate-credential`, 새 파일로 재로그인 |
| 로컬 미초기화/다른 슬롯 | 본인 디렉터리와 슬롯 확인; 기존 DB 인수/슬롯 전환 금지 |
| 정책 없음/DRAFT/목표 미확정 | 실제 공통 확정 파일/근거를 받아 적용. 자동 확정 금지 |
| 정책 hash/기간/빌드 불일치 | 확정 SHA-256·적용 기간 확인, setup 적용 후 build/확장 새로고침/재동의 |
| 사이트 차단 | 공통 허용 사이트의 공개 경로만 탐색; 민감 페이지 허용 확대 금지 |
| 미동의/철회·격리 | 본인 동의 또는 실제 사본 회수 절차; 철회 계정 재활성화 금지 |
| Queue/저장 오류 | 재전송/복구, 디스크·저장소 확인. IndexedDB/볼륨 삭제 금지 |

평상시 재시작은 `db` → `start` → `status`, 종료는 Extension ACK 후 `stop`이다. `stop`은 자기 nonce 확인 프로세스와 Compose만 중지하고 볼륨을 보존한다. stale PID는 다른 프로세스를 죽이지 않는다. 소유자가 실제 종료를 확인한 뒤 기록 파일을 별도 보관해 복구한다. 미완성 init에서 TLS 파일이 없으면 `setup`이 남은 인증서 생성/내보내기를 재시도한다. 기존 개인키를 덮어쓰지 않는다.

DB 복구 백업은 `local.py backup --recipient PUBLIC_AGE_KEY --output NEW.sql.age`다. 팀원 통합에는 DB dump를 사용하지 않는다. 기존 [복원/격리 절차](operator-guide.md)를 따르고 원본·최신 철회 원장·볼륨을 임의 수정/삭제하지 않는다.
