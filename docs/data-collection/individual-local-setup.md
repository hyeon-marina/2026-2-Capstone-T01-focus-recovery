> 팀원은 [A/B/C 현장 검증 순서표](team-field-validation.md)에서 시작합니다. 이 문서는 설치 도구의 설명이며, 현행 v6 수집·마스킹 기준은 [페이지 원본 수집 가이드](page-content-collection.md)를 따릅니다.

# A/B/C 실제 로컬 수집 실행 가이드

현재 공식 정책은 v6·RAW_ONLY·실제 제목/본문/허용 검색어 수집입니다. [버전 4 범위·갱신 가이드](public-web-navigation.md)는 과거 정책의 변경 이력입니다. 기존 설치는 setup 전에 [백업·보존 절차](team-field-validation.md#2-최초-설치와-기존-설치-구분)를 수행합니다.

공통 운영 정책은 [TEAM_POLICY.json](TEAM_POLICY.json)의 CONFIRMED 버전이다. 목표20개·160배정·A54/B53/C53·Plan revision1을 사용한다. `records.json`, `policy-prepare`, 관리자 Credential, 수동 DB Release는 기본 설치에 필요 없다. 학교·기관 직접 확인 결과를 전달받아 NOT_REQUIRED로 반영했다. 기관 조건에 따른 차단은 해제되며 본인 동의는 계속 필요하다. [검증 결과](institution-not-required-validation.md)를 확인한다.

## 1. 필수 프로그램 설치

Git, Python3.11+, JDK21(java/javac/keytool/jcmd), Node22.12+/npm, Docker Desktop(Compose·Linux containers), Chrome, age/age-keygen이 필요하다. MySQL8.4는 Docker가 설치한다. FastAPI·AI 모델은 원본 수집에 필요 없다.

macOS: [Temurin21](https://adoptium.net/installation/), [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/), [Node](https://nodejs.org/en/download), [Python](https://www.python.org/downloads/), [Chrome](https://www.google.com/chrome/)을 설치한다. Homebrew 사용 시 `brew install age`.

```sh
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
javac -version
docker info
docker compose version
node --version
age --version
```

Windows PowerShell: [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)의 WSL2·가상화 조건을 충족하고 실행한다. Git/Python/Node/Chrome 설치 후 새 터미널을 연다.

```powershell
winget install --exact --id EclipseAdoptium.Temurin.21.JDK
winget install --exact --id FiloSottile.age
java -version
javac -version
python --version
node --version
docker info
docker compose version
age --version
```

JAVA_HOME과 PATH가 JDK21을 가리켜야 한다. Windows 전체 실행은 NOT_TESTED다.

## 2. Repository Clone 또는 업데이트

```sh
git clone https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git
cd 2026-2-Capstone-T01-focus-recovery
```

기존 작업 폴더는 변경을 보존한 뒤 `git fetch origin`, `git switch main`, `git pull --ff-only origin main`을 실행한다. Fork 사용자는 공식 upstream/main을 기준으로 갱신한다.

macOS:

```sh
npm ci --prefix fe
cd be
./gradlew bootJar
cd ..
python3 tools/individual-local/local.py check
```

Windows PowerShell:

```powershell
npm ci --prefix fe
cd be
.\gradlew.bat bootJar
cd ..
python tools/individual-local/local.py check
```

## 3. 본인 Slot 설정

A/B/C는 각자 PC에서 자기 한 줄만 실행한다(macOS).

```sh
python3 tools/individual-local/local.py setup --slot A
python3 tools/individual-local/local.py setup --slot B
python3 tools/individual-local/local.py setup --slot C
```

Windows는 `python3` 대신 `python`을 쓴다.

```powershell
python tools/individual-local/local.py setup --slot A
python tools/individual-local/local.py setup --slot B
python tools/individual-local/local.py setup --slot C
```

## 4. Backend/MySQL 최초 구성 및 기존 환경 재사용

setup이 개인 Secret·Owner Key·TLS·전용 Docker MySQL·로컬 Spring을 만들고 Credential을 `.collection/local/participant.json`에 저장한다. 값은 출력하지 않는다. HTTPS localhost:9443, DB127.0.0.1:33101만 사용한다. 다른 슬롯으로 기존 DB를 바꿀 수 없다. 재실행은 기존 UUID·데이터·유효 Credential을 보존한다. 만료 시 같은 setup으로 갱신한다. 세션은 종료·ACK 후 setup한다.

동일 PC의 격리 테스트만 `--directory NEW --db-port 33231 --tls-port 19543`처럼 새 폴더와 빈 포트를 지정한다. DB/볼륨을 삭제해 오류를 해결하지 않는다. Owner Key·DB·개인키·Credential·Chrome 프로필은 공유·Git 업로드·클라우드 동기화하지 않는다.

## 5. 공통 정책 자동 적용

setup은 저장소 JSON의 전체 SHA-256, 정책 식별자·기간, Plan Checksum·revision·20목표·160배정·빈 공통 슬롯·사이트를 검증하고 본인 슬롯에만 UUID를 연결한다. `POLICY_INSTALLED`를 확인한다. 설치한 정확한 바이트의 SHA를 개인 config에 고정한다. 정확한 공식 v2/v3/v4/v5 SHA가 확인되면 정책 인자 없는 setup으로 저장소 v6를 자동 적용한다. 사용자 지정 정책은 보존하고 변조는 차단한다. `--policy FILE --policy-sha256 HASH`는 검증된 특정 정책을 명시하는 옵션이며, 과거 정책으로 격리 마감할 때의 절차는 [현장 복구](team-field-validation.md#6-장애-기록과-안전한-복구)를 따른다.

정책·목표를 다시 작성하거나 승인 증빙 JSON을 만들지 않는다. 운영 정책은 기관 비대상 NOT_REQUIRED이며 INSTITUTION_BLOCKED가 발생하지 않는다. [판단 출처](institution-not-required.md)는 저장소에 포함된다. 본인 동의 전 수집은 계속 차단한다. 날짜 미등록은 정책을 DRAFT로 바꾸지 않는다. 보존기간은 최종 평가 종료일+90일이며 운영 시 삭제일·사본·책임·실행을 기록한다.

## 6. Chrome Extension 빌드

```sh
python3 tools/individual-local/local.py build
```

Windows:

```powershell
python tools/individual-local/local.py build
```

Chrome `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → 저장소 `fe/dist-real`을 선택한다. 다른 정책/포트로 빌드한 Extension을 사용하지 않는다. 정책 변경 후 다시 build하고 확장 프로그램을 새로고침한다.

## 7. 인증서 설정

```sh
keytool -printcert -file .collection/local/tls/localhost.cer
python3 tools/individual-local/local.py status
```

macOS: 키체인 접근에서 생성된 `localhost.cer`를 로그인 키체인으로 가져와 지문·localhost SAN·유효기간을 확인하고 SSL 신뢰를 설정한다. Chrome을 완전히 재시작한다.

Windows PowerShell(현재 사용자 저장소):

```powershell
keytool -printcert -file .collection/local/tls/localhost.cer
Import-Certificate -FilePath .collection/local/tls/localhost.cer -CertStoreLocation Cert:\CurrentUser\Root
python tools/individual-local/local.py status
```

Chrome에서 `https://localhost:9443/api/health`가 인증서 경고 없이 열리는지 확인한다. TLS 검증 비활성화·경고 우회는 사용하지 않는다. 인증서는90일 유효하므로 만료 시 수집을 멈추고 인증서를 갱신·재신뢰한다. 자동 갱신은 제공하지 않는다. 자동 E2E의 인증서 SPKI pin 검증과 OS 신뢰 설치는 구분한다.

## 8. Credential 로그인

확장 프로그램 아이콘으로 참여자 화면을 열고 ‘로컬 Credential 파일 불러오기’에서 본인 `participant.json`을 선택한다. 본인 슬롯·정책 SHA·Plan revision1·HTTPS 연결을 확인한다. 관리자에게 Credential을 요청하지 않는다.

## 9. 본인 동의

목적·수집 항목·이용 범위·보존·제외 정책을 읽고 본인이 체크박스와 동의 버튼을 누른다. setup은 동의를 생성하지 않는다. 본인 동의는 setup이나 자동 테스트로 대신하지 않는다. 전체 동의 철회는 즉시 신규 수집을 중단하고 기존 데이터 격리·회수 경로를 유지한다.

## 10. 목표 선택

본인 배정에서 목표·시나리오를 고른다. [기존 목표 원문·완료 기준·네 시나리오](confirmed-goals-proposal.md)를 그대로 따른다. PlannedSessionId를 바꾸지 않는다. 시나리오는 AI 정답 라벨이 아니다.

## 11. 실제 수집 시작

기관 비대상 판단은 저장소 정책에 이미 반영됐다. 본인 동의를 완료하고 화면의 수집 준비가 유효할 때 세션 시작을 누른다. 공식 v6는 PUBLIC_HTTP_HTTPS 범위와 빈 sites 목록으로 일반 공개 웹을 허용한다. 사용자 지정 정책이 있는 경우에만 해당 정책의 Origin/Path Prefix 제한도 따른다. 403/404·로그인·접근 제한은 우회하지 않는다. 사이트·민감 URL/DOM 검사는 계속 적용된다.

활성 창·탭에서 의미 있는 페이지를5초 이상 읽는다. 유효 Visit10개 이상, 권장12~15개를 수집한다. 일반 HTTP/HTTPS 공개 웹사이트에서 수집한다. 원본 URL/Query/Fragment는 저장하지 않으며, 검사한 Query/SPA route는 세션 HMAC 입력에서 구분한다. 허용 Google/Naver 검색어만 별도 필드로 수집한다. 민감 파라미터 이름·URL/DOM·사설 IP·내부망은 차단한다. SPA·뒤로 가기·탭 전환에서도 같은 활성 세션을 이어간다. 추적 Query만 바꿔 Visit을 채우지 않는다.

## 12. 세션 종료

세션 종료·수집 중지를 누르고 미완료 POST/PATCH=0, 종료 ACK=acked를 기다린다. 실패 시 재전송/복구를 누른다. 확장 프로그램/DB를 삭제하지 않는다.

## 13. RAW_COLLECTED 확인

진행 상태 새로고침에서 해당 시도 `RAW_COLLECTED`, AI `NOT_RUN`, 유효 Visit≥10 및 전송 확인을 확인한다. Window/AI 완료 수와 원본 수집 완료 수는 다르다. 부족하면 종료 후 사유를 기록하고 본인 재수집 기능을 사용한다.

## 14. 암호화 Export

[통합 가이드](merge-guide.md)의 공개 age 수신키를 받아 `dataset.py export --recipient`를 실행한다. Export 명령이 즉시 암호화한다. 별도 평문 저장·수동 재암호화가 필요 없다. 최신 privacy와 출력 SHA도 전달한다.

## 15. 데이터 통합

통합 담당자는 age 개인키로 verify/merge한다. Manifest/SHA·Source/Participant·공통 Plan·FK·중복·최신 철회 상태를 검증한다. 철회 데이터 재유입은 차단된다. 3인160개 실제 세션이 완료되기 전에는 PARTIAL이다. [정확한 명령](merge-guide.md)을 따른다.
