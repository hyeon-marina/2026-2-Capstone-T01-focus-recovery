# A/B/C 공통 정책 적용 가이드 (#105)

현재 운영 준비 절차는 [최종 Readiness](real-collection-final-readiness.md)를 따른다. 정책 내용과90일 보존을 채택하고 Plan revision1을 준비했다. 실제 기록이 없는 목표 승인/기관 판단은 DRAFT/UNRESOLVED로 남긴다. 실제 증거 입력 후 `local.py policy-prepare`가 Java 검증을 통과한 공통 파일/SHA를 생성한다. 아래 #105/#106의 기존 수치·제안/검증 내용은 당시 기록이며 최신 JSON은 접근 가능한15쌍으로 정리했다.

**저장소의 TEAM_POLICY.json은 실행 가능한 확정 정책이 아닌 완성된 기본안이다.** 사용자에게 정책 방향을 다시 선택하도록 요구하지 않는다. RAW_ONLY·행동/주제 메타데이터·원문 제외·20목표/160세션·90일 권고를 기본으로 한다. 다음은 선택 대신 실제 사실을 기록하는 단계다. DRAFT를 CONFIRMED로 바꾸기만 해서는 개시할 수 없다.

## 실제 기록 입력

| JSON 필드 | 필요한 실제 기록 |
| --- | --- |
| teamDecisionRef | A/B/C가 실제 읽고 의결한 기록 ID/일자/대상 파일 버전, 승인 사이트 검토표 |
| retentionRef / retentionPolicy | 최종 평가 종료일·90일 기산일·삭제일·담당자/연락·사본대장·삭제/검증 방법 |
| privacyEvidenceRef | 최소화·민감 페이지/철회·전체 사본 회수 점검 기록 |
| institution.decision / evidenceRef | 실제 학교/기관의 적용 필요 여부 판단과 근거. REQUIRED_SATISFIED 또는 NOT_REQUIRED; 확인 전 UNRESOLVED |
| startAuthorizationRef / collectionScope | 개시 책임자·연락·승인일·허용 PC/참여자/파일럿/수집 범위 |
| notBefore / expiresAt | 실제 승인 기간의 UTC ISO-8601 시각. 임의 과거/무기한 금지 |
| plan.goals[*].status / evidenceRef | 각 목표 원문·완료 기준·10 Visit 가능성의 팀 실제 검토 기록 |
| sites | 약관/경로/공개성/민감 DOM/Chrome 파일럿을 통과한 후보만 유지. 미확인·차단 서비스는 추가하지 않음 |

실명·연락·서명/기관 문서·개인 동의는 비공개 기록에 보관하고 JSON에는 실제 참조 ID만 넣는다. 검증기는 참조 문법을 확인할 뿐 문서 존재나 권한을 검증하지 못한다. 임의 문자열·테스트 증거·이 Issue 지시문을 실제 승인으로 사용하지 않는다. 테스트 정책은 실제 디렉터리에 설치하지 않는다.

## 공통 파일 확정 순서

1. `docs/data-collection/TEAM_POLICY.json`을 비공개 운영 위치의 `TEAM_POLICY.json`으로 복사한다. 기본안의 상세 문장을 유지하고 위 사실을 기록한다. 수집 허용 사이트는 30개 이하의 정확한 HTTPS origin/pathPrefix 쌍이다.
2. 실제 승인 후 status와 목표 상태를 CONFIRMED, plan.revision을 1로 설정한다. 기존 PLAN/Goal/type/repetition/slot ID와 160배정은 바꾸지 않는다. 공통 slots.participantId는 null이다. checksum은 원래 revision 0과 달라지는 것이 정상이며 이후 실적이 있는 Plan은 변경하지 않는다.
3. Plan checksum을 계산해 `planChecksum`에 넣는다. 파일을 최종 저장하고 전체 파일 SHA-256을 다시 계산한다. SHA를 파일 안에 넣지 않는다. UTF-8 bytes/줄바꿈이 바뀌면 전체 SHA는 달라진다.
4. Java 검증기를 통과한다. 그 다음 실제 증거를 사람이 대조한다. 동일 JSON bytes와 별도 신뢰 경로의 SHA-256을 A/B/C에게 전달한다.

macOS (저장소 루트, JDK21 선택 후):

```sh
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$JAVA_HOME/bin:$PATH"
python3 tools/individual-local/local.py policy-checksum --policy TEAM_POLICY.json
# 출력된 planChecksum을 JSON에 반영하고 저장 후 다시 실행
python3 tools/individual-local/local.py policy-checksum --policy TEAM_POLICY.json
python3 tools/individual-local/local.py policy-validate --policy TEAM_POLICY.json --policy-sha256 TEAM_CONFIRMED_SHA256
```

Windows PowerShell (**NOT_TESTED**; JDK21의 실제 경로를 사용):

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
py -3 tools/individual-local/local.py policy-checksum --policy TEAM_POLICY.json
# planChecksum 입력/저장 후 재계산
py -3 tools/individual-local/local.py policy-checksum --policy TEAM_POLICY.json
py -3 tools/individual-local/local.py policy-validate --policy TEAM_POLICY.json --policy-sha256 TEAM_CONFIRMED_SHA256
```

`policy-validate`는 DB/참여자/동의를 만들지 않는 Gradle JavaExec이다. 실제 설치와 같은 LocalCollectionPolicy/CollectionPlanService/CollectionSitePolicy 검증기를 사용한다. DRAFT 정책에서는 배정/hash를 출력한 뒤 LOCAL_POLICY_DRAFT로 **실패하는 것이 정상**이다. SHA 일치와 문법 통과는 실제 승인 증거가 아니다.

## 각자 실행

macOS:

```sh
python3 tools/individual-local/local.py setup --slot A
# B는 --slot B, C는 --slot C
python3 tools/individual-local/local.py setup --slot A --policy TEAM_POLICY.json --policy-sha256 TEAM_CONFIRMED_SHA256
python3 tools/individual-local/local.py build
python3 tools/individual-local/local.py verify
```

Windows PowerShell (**NOT_TESTED**):

```powershell
py -3 tools/individual-local/local.py setup --slot A
py -3 tools/individual-local/local.py setup --slot A --policy TEAM_POLICY.json --policy-sha256 TEAM_CONFIRMED_SHA256
py -3 tools/individual-local/local.py build
py -3 tools/individual-local/local.py verify
```

설치/인증서 신뢰는 [로컬 설치](individual-local-setup.md)를 따른다. Extension은 빌드가 출력한 dist-real/ZIP을 자기 전용 Chrome 프로필에서 설치한다. HTTPS 인증서를 OS/Chrome에서 검증하고 경고를 우회하지 않는다. `participant.json` 파일 로그인 → 자기 슬롯/정책 버전/상태/Plan SHA 확인 → 방침 읽기 → 본인 동의 → 자기 배정 선택 → 시작 → 승인 공개 페이지 12~15개 탐색 → 종료 → Queue 0·END ACK·RAW_COLLECTED·AI NOT_RUN 확인. 정책이 DRAFT면 동의/수집 시작이 허용되지 않는다. 실제 버튼/오류 화면은 [참여자 가이드](participant-guide.md)를 따른다.

같은 슬롯 setup은 UUID/기존 데이터를 유지한다. Credential 만료/분실은 `setup --slot A --rotate-credential` 후 파일로 재로그인한다. 기존 Token은 폐기된다. Owner Key·로컬 Secret을 다른 사람에게 보내지 않는다. 정책 변경은 활성 세션을 먼저 종료하고 새 버전/날짜/빌드/hash로 적용·재빌드·재동의한다. DB/Volume 삭제나 다른 슬롯으로 setup하여 오류를 해결하지 않는다. 키 유실은 기존 DB 인수로 해결하지 않는다.

## 데이터 전달과 복구

[통합 가이드](merge-guide.md)의 기존 age 명령을 그대로 사용한다. 통합 담당자가 개인키를 보관하고 공개키만 배포한다. 참여자는 공개키로 Export 한 번을 실행하며 별도 수동 평문 암호화가 필요 없다. ciphertext hash와 최신 privacy/hash를 별도 신뢰 경로로 전달한다. 담당자는 자기 개인키로 Import·Manifest/행 수/SHA/source/participant/계획·최신 privacy·철회 레지스트리를 검증한다. 개인키는 A/B/C에게 배포하지 않는다.

401은 Credential 재발급/재로그인, 정책 불일치는 동일 파일/hash 및 Extension 재빌드, TLS/네트워크 오류는 `status`/`logs`와 인증서 기간·SAN·신뢰 확인, Queue 재전송은 UI 다시 시도, 만료/기관/미동의/철회는 각각 실제 조건을 해결한다. checksum만 맞추거나 정규식을 제거하여 시작하지 않는다. 철회 후 재발급은 privacy 조회용이며 수집을 재활성화하지 않는다.
