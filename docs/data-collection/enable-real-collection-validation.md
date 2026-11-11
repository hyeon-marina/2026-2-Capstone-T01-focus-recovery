# 실제 데이터 수집 환경 변경·검증 보고

검증일: 2026-11-11 KST. 이 보고의 합성 실적과 실제 외부 연구 수집은 구분한다. 실제 기관 승인·면제 결과를 만들지 않았으며 추가 승인 시스템·정책 발행 명령은 도입하지 않았다.

## 1. 기준 main과 작업 브랜치

- upstream/main: `211d7fc26e153d272876638a094d4b9c76c9c94f` (#107 merge).
- 작업 브랜치: `fix/105/enable-real-data-collection`.
- 기존 작업 보존. 공식 main 직접 Push·자동 Merge 없음.

## 2. #107의 실제 차단 원인

TEAM_POLICY는 공통 내용을 채택했어도 status/20개 goal이 DRAFT, 기간은 공란이었다. LocalCollectionPolicy는 teamDecisionRef·retentionRef·privacyEvidenceRef·startAuthorizationRef 및 기관 결과를 정책 설치 조건으로 함께 요구했다. policy-prepare는 goal/site/기관을 포함한 별도 증빙 파일·각 SHA·confirmedByRecordOwner를 필요로 했다. setup은 기본 정책을 적용하지 않아 팀원이 매번 외부 JSON/SHA를 준비해야 했다. [기존 PR](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/107).

## 3. 제거·간소화한 절차

기본 setup이 저장소 정책과 SHA를 자동 적용한다. 로컬 운영 검증에서 네 내부 참조 필수 조건을 제거하고 DB 호환 참조는 policy ID/version에서 기계적으로 도출한다. 별도 records.json·policy-prepare·goal/site 내부 의결 파일·confirmedByRecordOwner는 기본 수집 준비에서 사용하지 않는다. 기존 고급 호환 명령만 보존한다. 관리자 Credential·수동 DB Release를 도입하지 않는다.

## 4. 최종 공통 정책

- status CONFIRMED, RAW_ONLY, policyVersion `2`, buildId `focus-105-operational-v2`.
- 정책 유효기간: 2026-11-11T00:00:00Z ~ 2027-11-11T00:00:00Z.
- Plan revision1; 전체 정책 SHA-256 `fb4c6fdd8e97e657d6d5f460dba75e96def2b532d41071a9e65dfaf524c8084e`.
- Plan Checksum `73ae8c69e16559c95c15f1d4f37a4e2a835dc19367a280285306a64da41238cf`.
- 보존은 최종 평가 종료일+90일. 정확한 평가·삭제 날짜와 사본 삭제 실행은 운영 기록이다. 날짜 미등록으로 정책을 DRAFT로 되돌리지 않는다.
- institution UNRESOLVED는 확정 정책과 별개인 실제 개시 조건이다. 설치·로그인·정책 열람은 가능하며 실제 Session/저장은 차단한다. 기존 조건을 분리했으며 새 승인 시스템을 추가하지 않았다.

## 5. 목표20개·160세션

Java TeamPolicyProposalTest가 기존 goals.candidates의20개 원문과 TEAM_POLICY 설명을 대조한다. 기존 local-policy.draft의160배정 및 Java draft의 PlannedSessionId/Goal/Scenario/repetition/slot 전체와 일치한다. 네 시나리오·기존 완료 기준은 변경하지 않았다. 배정 A54/B53/C53, Plan revision1, 공통 participant 슬롯은 null이다. 별도 목표 재승인은 필요 없다.

## 6. A/B/C 기본 설치

[최종 합성 증거](evidence/enable-real-https.json): A/B/C 각각 자동 정책 설치·본인 슬롯 배정·Credential 파일 로그인·명시적 화면 동의·10개 유효 Visit PASS. 각 setup은 먼저 저장소 공통 정책을 자동 설치하고 기관 미확인·본인 동의 미완료를 표시한다. 이어 명시적인 합성 fixture에서 동일 Plan의 수집 경로를 실행한다. 합성 기관 값은 테스트 출력 폴더에만 있으며 실제 운영 정책을 변경하지 않는다.

## 7. 실제 사이트 범위

[읽기 전용 Chrome 증거](evidence/enable-real-sites.json):15/15 COMPATIBLE_SMOKE. HTTP200·scope·HTML·민감 DOM guard를 확인했다. Extension/Session/Credential 없이 수행했으므로 실제 탐색 데이터 수집 실적은0이다.

| Origin | Path Prefix |
| --- | --- |
| https://docs.github.com | /en/pages |
| https://developer.mozilla.org | /en-US/docs |
| https://docs.python.org | /3 |
| https://git-scm.com | /docs |
| https://www.w3.org | /WAI/ |
| https://science.nasa.gov | / |
| https://www.epa.gov | /recycle |
| https://www.metmuseum.org | /ko/art |
| https://www.hangeul.go.kr | / |
| https://philharmonia.co.uk | /resources/ |
| https://www.noaa.gov | /jetstream |
| https://notice.tistory.com | / |
| https://d2.naver.com | /helloworld |
| https://ko.wikipedia.org | /wiki |
| https://en.wikipedia.org | /wiki |

목록은 기술적으로 허용한 정확한 범위다. 각 페이지의 공개성·권리 조건·민감 guard를 계속 적용하며 접근 제한을 우회하지 않는다. 일반 블로그 전체·전체 웹 wildcard를 허용하지 않는다. 특정 미지원 서비스는 나머지15곳을 차단하지 않는다.

## 8. YouTube·Google·Naver

네 서비스는 활성 sites에 포함하지 않았다. 기존 HMAC/Query·SPA 합성 지원은 유지한다. 실제 서비스에서 이번 연구 방식의 허용 범위·Chrome 호환성을 모두 검증한 결과는 없다. [YouTube 약관](https://www.youtube.com/static?template=terms)은 자동 접근에 제한을 둔다. [Google 약관](https://policies.google.com/terms?hl=ko), [Naver 약관](https://policy.naver.com/rules/service.html)과 [검색결과 수집 정책](https://policy.naver.com/policy/search_policy.html)을 확인했으나 이를 프로젝트 수집 허가로 해석하지 않았다. 공개 문서15곳의 기술 경로는 이 서비스들에 의존하지 않는다.

## 9. Chrome Extension·HTTPS

npm build:real 및 package:collection이 실제 공통 정책으로 빌드·패키징됐다. CFT 기반 E2E는 본인 Credential 파일 로그인·체크박스/버튼의 명시적 테스트 동의·SPA Query·활성 체류·POST/PATCH/END·Queue·ACK·worker/browser 재시작을 검증한다. 초기 일반 Chrome은 자동 확장 로드 플래그를 지원하지 않아 테스트 Worker를 만들지 못했다. 확장 로드를 지원하는 설치된 Chrome for Testing으로 재실행했다. 팀원의 일반 Chrome 수동 ‘압축해제된 확장 로드’ 절차와 구분한다.

Python setup/API는 생성된 CA 파일·localhost SAN/기간을 검증한다. Chrome 자동 E2E는 정확한 인증서 SPKI pin만 허용하고 잘못된 pin의 ERR_CERT_AUTHORITY_INVALID를 검증한다. TLS 전체 검증 해제는 사용하지 않았다. 사용자 OS 키체인/Windows 인증서 저장소의 수동 신뢰 설치는 NOT_TESTED다.

## 10. 실제 공개 사이트 E2E

NOT_RUN: 기관의 실제 적용 여부 판단·승인/면제 결과가 없고 실제 참여자 동의도 이번 실행에서 얻지 않았다. 운영 정책은 DRAFT가 아니며 설치는 성공한다. 실제 외부 연구 세션을 임의 생성하지 않았다. 외부 사이트는 읽기 전용15/15, 저장·종료·암호화 통합은 합성 E2E로 구분 검증한다. 실제 사이트의10 Visit→MySQL→RAW_COLLECTED→Export/Import를 실행했다고 주장하지 않는다.

## 11. RAW_COLLECTED/NOT_RUN·age

A/B/C 각각10 Visit·POST/PATCH/END·Queue 완료·END ACK·RAW_COLLECTED·AI NOT_RUN PASS. age 암호화 Export3개→첫 통합3세션/30 Visit(PARTIAL)·중복 Import3개 멱등·A철회 후2세션 유지·과거 privacy 재사용 거절 PASS. [증거](evidence/enable-real-https.json). 원본 모드는 AI 프로세스를 요구하지 않는다. Export가 메모리에서 즉시 age 암호화하고 Manifest/SHA·공통 Plan·FK·Source/Participant·중복·최신 privacy 검사를 유지한다.

## 12. 보안·개인정보

Loopback/HTTPS·Credential/Owner Key·슬롯/참여자 접근·Build/Session Scope·민감 URL/DOM·동의 전 차단·철회/격리·age/Manifest/SHA·중복/철회 재유입 차단을 유지했다. 자동 정책 설치 후 철회된 계정의 같은 정책/Credential 갱신이 철회를 해제하지 않도록 했다. 다른 정책으로 철회를 해제하려는 시도는 차단한다.

URL Query가 있다는 이유로 일괄 차단하지 않는다. 기존 허용 page/p 숫자 Query·알려진 추적값·일반 anchor 처리를 유지하고 SPA Query 전환을 Chrome으로 검증한다. 미검토 Query/hash route·민감 키·인코딩 우회는 차단한다. 저장 필드는 세션별 HMAC 식별자·고정 Topic·METADATA_ONLY·검색어 미수집 표식이다. 전체 본문·원제목·Query/Fragment 원문·HMAC key는 Export하지 않는다. 기존 Flyway migration 원문은 변경하지 않았다.

## 13. 회귀 결과

| 검증 | 결과 |
| --- | --- |
| Backend 전체, 실제 MOCK FastAPI·Chrome·MySQL 연결 | 1031 중953 PASS·78 SKIPPED·failures/errors0 |
| 마지막 정책/기관 조건 추가 focused | 15 PASS (전체 회귀 이후 별도 실행) |
| Frontend Typecheck | PASS |
| Frontend Vitest | 917 PASS·2 SKIPPED |
| AI 기존 테스트 | 244 PASS |
| Python individual-local / collection | 35 / 5 PASS |
| Collection Contract | 30정의·80 schema cases·139 scenarios·216 rule combinations·κ4 PASS |
| 확정 공통 정책 Java 검증 |20목표·160배정·15sites·Checksum/SHA PASS |
| 실제 사이트 읽기 전용 |15/15 PASS |
| A/B/C Chrome·HTTPS·age 통합 | PASS: 각10 Visit·UI 동의·END ACK·RAW_COLLECTED/NOT_RUN·통합·중복·철회 |
| 실제 외부 연구 수집·OS trust 설치·Windows 전체 실행·실제 모델 추론 | NOT_RUN / NOT_TESTED |

SKIPPED는 PASS로 계산하지 않았다. 전체 회귀는 테스트 전용 retained SYNTHETIC DB에 새 스키마를 만들었으며 기존 원본은 변경하지 않았다. 합성 WebSocket 서비스 의존성은 기존 프로젝트 requirements의 uvicorn[standard]를 테스트 가상환경에 설치했다. 실제 수집 경로의 AI 실행은0이다.

## 14. 팀원 최종 실행 명령

[macOS/Windows 15단계](individual-local-setup.md). macOS 핵심:

```sh
npm ci --prefix fe
(cd be && ./gradlew bootJar)
python3 tools/individual-local/local.py setup --slot A
python3 tools/individual-local/local.py build
python3 tools/individual-local/local.py status
```

B/C는 setup의 슬롯만 바꾼다. Windows는 `(cd...)` 대신 `cd be`, `.\gradlew.bat bootJar`, `cd ..`를 순서대로 실행하고 `python3`을 `python`으로 바꾼다. 이후 인증서 신뢰·확장 로드·본인 파일 로그인·본인 동의·목표 선택·개시 조건 확인을 수행한다. [Export/Import 정확한 명령](merge-guide.md).

## 15. 남은 외부 확인

학교·기관 승인/면제 결과는 없다는 사용자 확인을 받았다. 요청에 따라 추가 기관 조사를 중단했다. 이미 확인한 [성공회대 기관생명윤리위원회 공식 안내](https://www.skhu.ac.kr/sanhak/2960/subview.do)는 인간대상연구·직간접 식별정보 및 심의면제 요건을 설명하고 연구지원팀 연락 경로 `irb@skhu.ac.kr`, 02-2610-4106을 제시한다. [서식](https://www.skhu.ac.kr/sanhak/2962/subview.do)에 심의면제 신청이 있다. 실제3인 가명 행동연구에 대한 대상/면제 여부는 기관의 실제 판단이 필요하며 이 보고가 결정을 대신하지 않는다. 자동 연락·신청·허위 승인 기록은 하지 않았다.

개인별 실제 동의, OS 인증서 신뢰, 평가 종료일/삭제일·사본 운영 기록은 실행 시 확인한다. 이미 확정한 내부 정책·목표를 다시 의결할 필요는 없다.

## 16. 최종 상태·Commit·PR

TECHNICALLY_READY: 검증한 macOS/CFT·합성 사이트 경로에서 YES. COLLECTION_AUTHORIZED: NO(기관 판단 미확인 및 실제 참여자별 현재 동의 필요). Commit SHA와 PR URL은 최종 응답 및 PR head를 기준으로 한다. 무조건적 실제 수집 가능 여부는 NO: 실제 기관 개시 판단 미확인이다. 기술적 오류는 이번 작업에서 수정·검증하며 이 외부 조건을 후속 개발 Issue로 넘기지 않는다.

최종 E2E는 `/tmp/enable105-complete`에서 실행했다. 이전 시도는 합성 fixture의 Plan 교체 충돌, 일반 Chrome 자동 확장 로드 미지원, Docker 주소 풀 소진을 발견했다. fixture가 공통 Plan을 유지하도록 고쳤고 CFT로 재검증했다. 이번 작업의 테스트 컨테이너/네트워크만 해제하고 DB 볼륨·Export·증거는 보존해 주소 풀을 복구했다.
