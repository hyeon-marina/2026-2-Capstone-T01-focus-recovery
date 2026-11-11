# 기관 비대상 반영·실제 공개 사이트 기술 검증

기준: 2026-11-11 KST, upstream/main `e023f12104ee984b78627cc13f45278f87124751` (#108 merge). 브랜치 `fix/105/institution-not-required`.

## 운영 정책 변경

사용자가 학교·기관에 직접 확인하여 본3인 캡스톤에는 별도의 심의·승인 절차가 필요하지 않다고 전달했다. 이를 `institution.decision=NOT_REQUIRED`, `evidenceRef=docs/data-collection/institution-not-required.md`로 반영했다. [간단한 운영 기록](institution-not-required.md)은 접수일·전달 경로·판단 범위·미제공 항목을 구분한다. 실제 확인일, 세부 전화/이메일 방식, 담당자 이름, 공식 문서 번호는 제공되지 않아 만들지 않았다. 이 기록은 공식 승인서나 심의면제 결과가 아니며 REQUIRED_SATISFIED로 표시하지 않는다. 재조사·재확인·새 승인 시스템을 요구하지 않는다.

기존 변경 계약이 기관 판단 변경에도 정책 버전·Build 갱신·재동의를 요구하므로 버전2 기반에서 **policyVersion3 / buildId focus-105-operational-v3**으로 갱신했다. notBefore는 이전 버전보다 뒤인2026-11-11T00:00:01Z다. CONFIRMED·RAW_ONLY·원래20목표/완료 기준/네 시나리오·Plan revision1·160배정·A54/B53/C53·15사이트·민감정보 제외·최종 평가 종료+90일 보존·age 방식을 유지한다.

- 전체 정책 SHA-256: `8af39d4851d4a01e00d6ce87fe28e887207a862a9824d8127768175878c25c25`.
- Plan Checksum(변경 없음): `73ae8c69e16559c95c15f1d4f37a4e2a835dc19367a280285306a64da41238cf`.
- 기본 설치는 저장소 JSON/SHA를 그대로 사용한다. records.json·policy-prepare·추가 정책 발행·관리자 승인·수동 DB Release는 필요 없다.
- 기존 #108 공식 버전2의 정확한 SHA가 고정된 PC는 같은 setup으로 버전3을 자동 적용한다. 이전 설치 파일이 SHA와 일치하는지 먼저 검사하며 변조 파일은 거절한다. 사용자 지정 정책은 자동 교체하지 않는다. Extension 재빌드/새로고침 후 본인이 재동의한다.

## 차단 조건

LocalCollectionPolicy는 기존 스키마의 NOT_REQUIRED와 evidenceRef를 검증하고 CollectionSitePolicy/ConsentService/Session API/Extension은 기존 경로를 사용한다. 운영 정책에서 INSTITUTION_BLOCKED는 발생하지 않는다. 미동의·Credential 오류·허용 밖/민감 URL·DOM·정책/Build/Session Scope 불일치·철회 차단은 유지한다. UNRESOLVED 입력에 대한 차단 회귀도 유지한다. CollectionAdministration의 관리자 기능은 개인 로컬 설치에 필요하지 않으며 새 권한을 부여하지 않았다. 기존 Flyway migration 원문은 변경하지 않았다.

## 실제 공개 사이트 자동 E2E와 사람의 참여 구분

실제 참여자 A/B/C의 본인 동의나 자연 탐색은 이번 자동 실행에서 얻지 않았다. 테스트는 새로운 전용 MySQL3개·Spring HTTPS3개·Chrome 프로필3개와 자동 생성한 테스트 계정으로 수행한다. Extension 화면의 체크박스/버튼을 자동으로 조작한 **테스트 동의**이며 사람의 동의라고 주장하지 않는다.

공통 운영 정책을 수정하거나 테스트 사이트로 교체하지 않고 기본 setup으로 설치한다. 미동의 상태에서 CONSENT_REQUIRED, INSTITUTION_BLOCKED 없음, Plan1을 확인하고, 테스트 동의 후 실제 공개 Python Docs를 탐색한다. 네트워크 모킹·합성 HTML·403/404 우회는 사용하지 않는다. GOAL-003의 본인 배정을 선택한다.

실제 HTTPS 페이지10개:

- /3/library/venv.html
- /3/installing/index.html
- /3/tutorial/venv.html
- /3/using/index.html
- /3/using/cmdline.html
- /3/tutorial/modules.html
- /3/tutorial/index.html
- /3/tutorial/controlflow.html
- /3/tutorial/errors.html
- /3/tutorial/stdlib.html

Origin은 모두 https://docs.python.org 이며 기존 /3 범위 안이다. [공식 라이선스](https://docs.python.org/3/license.html)는 문서를 PSF License Version2로 제공한다. 이 실행에서는 본문/코드를 복제·배포하지 않고 최소 행동 메타데이터만 저장했다. [실행 증거](evidence/institution-not-required-external.json): A/B/C 각각10개 응답200·유효 Visit, 총30 Visit의 전체 경로 PASS. A/B/C 각각10 Visit·활성 체류≥5초·탭 전환·worker/browser 재시작·POST/PATCH/END·END ACK·RAW_COLLECTED·AI NOT_RUN·Backend Export·age CLI verify·Import 통합을 검사한다. Export에 원문 URL Query·본문·원제목이 없고 HMAC/고정 Topic/METADATA_ONLY임을 확인한다.

운영 프로필을 그대로 사용하므로 backend의 source enum은 PARTICIPANT다. 그러나 이 실행의 계정·동의·행동은 자동 테스트 전용이다. 파일 이름·보호된 새 디렉터리·증거 kind를 AUTOMATED_EXTERNAL_SITE_TECHNICAL_E2E_NOT_HUMAN_CONSENT로 표시하며 **실제 연구160세션 데이터에 합치지 않는다.** 실제 사람 동의/연구 실적은0이다.

## HTTPS

Python 클라이언트와 Export CLI는 생성된 localhost 인증서·SAN·기간을 검증한다. Chrome 자동 실행은 해당 로컬 인증서의 정확한 SPKI만 허용하고 잘못된 SPKI는 ERR_CERT_AUTHORITY_INVALID로 거절하는 음성 대조를 수행한다. 외부 Python Docs의 HTTPS 검증은 그대로 유지한다. TLS 전체 검증 비활성화는 사용하지 않는다. OS 키체인/Windows 인증서 수동 신뢰 설치는 NOT_TESTED이며 팀원이 실행 가이드대로 수행해야 한다.

## 회귀 결과

[최종 회귀 증거](evidence/institution-not-required-regression.json):

| 검증 | 결과 |
| --- | --- |
| Backend 전체, 실제 MOCK FastAPI/uvicorn[standard]·MySQL·Chrome 연결 | 1032개 중954 PASS·78 SKIPPED·실패/오류0 |
| FE Typecheck / Vitest | PASS / 917 PASS·2 SKIPPED |
| AI 기존 테스트 |244 PASS |
| Python individual-local / collection |36 / 5 PASS |
| Collection Contract |30정의·80 schema cases·139시나리오·216규칙조합·κ4 PASS |
| 정책/Plan/SHA·원문20목표·160배정·15사이트 | PASS, 기존 Plan/sites 전체 동일 |
| A/B/C 실제 공개 사이트 자동 E2E | 각각10 Visit, 총30, RAW_COLLECTED/NOT_RUN·age Export/Import·중복3 PASS |
| #108 버전2→3 자동 갱신·기관 차단 해제·재동의 | PASS |
| 본인 미동의·인증·사이트/Build/Session Scope·철회·민감정보 | 기존 보안 회귀 유지·PASS |

SKIPPED는 PASS로 계산하지 않았다. 실제 모델 추론과 Windows 전체 실행은 이번 검증 범위가 아니다.

## 재현 명령

JDK21·Docker·age·npm 의존성·bootJar 준비 후 전용 Chrome for Testing 실행 파일을 사용한다. 이 명령은 사람의 동의를 대신하지 않는 자동 기술 테스트다. 새 출력 경로만 사용하며 만들어진 계정/데이터를 실제 연구 실적으로 사용하지 않는다.

```sh
python3 tools/individual-local/run-external-site-e2e.py --automated-test-only --output /private/tmp/new-external-test --chrome "$CHROMIUM_PATH"
```

## 팀원 실제 실행

[macOS/Windows15단계 가이드](individual-local-setup.md), [Export/Import](merge-guide.md).

```sh
npm ci --prefix fe
cd be
./gradlew bootJar
cd ..
python3 tools/individual-local/local.py setup --slot A
python3 tools/individual-local/local.py build
```

B/C는 자기 슬롯을 사용한다. 이후 인증서 신뢰 설정, Chrome `fe/dist-real` 설치, participant.json 로그인, 본인 동의, 목표·시나리오 선택 후 수집한다. 기관 결과를 다시 입력하거나 정책 파일을 발행하는 단계는 없다. 기존 버전2 환경도 같은 setup을 사용한다. Windows는 `.\gradlew.bat bootJar`와 `python`을 사용한다.


## 기존 버전2 갱신 검증

[실제 설치 검증](evidence/institution-not-required-upgrade.json): 새 테스트 DB에 #108 원본 버전2를 설치하고 자동 테스트 동의를 기록한 뒤, 기본 setup --slot A만 재실행했다. 같은 Participant/Credential을 유지하며 버전3으로 자동 갱신되고 INSTITUTION_BLOCKED가 사라졌다. 이전 버전2 동의는 새 정책을 허용하지 않아 CONSENT_REQUIRED가 남았다. 실제 참여자가 Extension에서 재동의해야 하며 자동으로 동의하지 않는다. 이 검증용 동의도 실제 사람의 동의가 아니다.

## 회귀 중 수정한 기술 오류

uvicorn[standard]의 HTTP parser에서 Java 기본 h2c 업그레이드 요청을 거절해 AI 회수·철회 확인이 실패했다. 분석 클라이언트와 달리 RetractionDispatcher만 HTTP 버전을 지정하지 않고 있었다. 기존 분석 경로와 동일하게 HTTP/1.1로 고정하고, AI에 직접 음성 요청을 보내는 RetractionLiveHttpTest 클라이언트도 같은 전송 규격으로 맞췄다. 인증·HTTPS·재시도·격리·확인 응답 검증과 테스트의 PRIVACY_RETRACTED/409 기대값은 유지했다. 처음 실패한 실행은 PASS로 계산하지 않는다.


## 최종 판정

기관 개시 조건은 NOT_REQUIRED로 충족됐고 INSTITUTION_BLOCKED는 해제됐다. 검증한 macOS/Chrome for Testing 기술 경로는 TECHNICALLY_READY다. 각자의 실제 수집 허용은 본인의 현재 정책 동의·유효 Credential·Build/Session Scope·사이트/개인정보 검사에 따른다. 자동 테스트 동의를 실제 참여자의 동의로 승계하지 않는다.

머지 후 A/B/C가 기존 설치 명령을 실행하고 인증서 신뢰·Extension 설치·본인 로그인/동의·목표 선택 후 허용된 실제 공개 사이트에서 수집할 수 있는가: **YES**. 별도 정책 작성·승인 파일 생성·기관 판단 재확인·추가 개발 단계는 없다. 실제 사람의 자연 탐색160세션과 Windows/OS 인증서 수동 신뢰 설치를 완료한 것으로 주장하지 않는다.

테스트 전용 컨테이너/네트워크는 종료·해제했고 DB 볼륨·암호문·개인 증거는 보존했다. 자동 기술 테스트의 원본은 /tmp/institution109-external, 갱신 검증은 /tmp/institution109-upgrade, 최종 Backend 회귀는 /tmp/institution109-regression-final이다. Commit SHA/PR URL은 최종 응답 및 PR head를 기준으로 한다. 공식 main 직접 Push·자동 Merge는 하지 않는다.
