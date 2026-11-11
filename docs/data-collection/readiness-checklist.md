# 실제 수집 준비 체크리스트

공통 정책은 CONFIRMED·Plan revision1이다. 목표20개·160배정·A54/B53/C53은 채택된 운영 계획이며 재승인 파일이 필요 없다. 실제 실행 근거와 테스트별 PASS/NOT_TESTED는 [이번 검증 보고](institution-not-required-validation.md)에 기록한다.

| 항목 | 설치·수집 조건 |
| --- | --- |
| 프로그램 | JDK21, Python3.11+, Node22.12+, Docker/Compose, Chrome, age |
| 기본 설치 | 본인 setup --slot A/B/C, 독립 로컬 MySQL·Spring·Credential |
| 정책 | 저장소 JSON·전체 SHA·Plan Checksum·정책 버전·정확한 사이트 범위 |
| 확장 프로그램 | local.py build, fe/dist-real 설치, 정책/Build 일치 |
| HTTPS | localhost 인증서 SAN·유효기간·신뢰 확인, TLS 검증 유지 |
| 본인 인증 | participant.json 로그인·본인 슬롯 확인 |
| 본인 동의 | 목적·항목·보존·철회를 읽고 Extension에서 직접 동의 |
| 외부 개시 조건 | NOT_REQUIRED: 사용자가 직접 확인한 심의 비대상 판단 반영. REQUIRED_SATISFIED와 구분 |
| 세션 | 본인 목표/시나리오·Session Scope·허용 사이트·민감 URL/DOM 검사 |
| 완료 | 유효 Visit≥10, Queue0·END ACK·전송 확인·RAW_COLLECTED·AI NOT_RUN |
| 전달 | age Export, Manifest/SHA·Source/Plan/FK 검사, 최신 privacy·중복/철회 재유입 차단 |
| 보존 | 최종 평가 종료일+90일, 실제 삭제일·사본·담당·실행 기록은 운영 시 등록 |

records.json·policy-prepare·별도 내부 의결 SHA·관리자 Credential·수동 DB Release는 기본 준비 조건이 아니다. 과거 운영 방식은 선택적 호환 경로로만 남긴다.

TECHNICALLY_READY는 설치·동의·수집·저장·종료·암호화 전달 경로의 실행 근거가 있을 때만 선언한다. COLLECTION_AUTHORIZED는 실제 외부 개시 조건과 해당 참여자의 현재 동의를 충족해야 한다. 건강/계정/개인 문서 등 민감 데이터·전체 본문·검색어·원제목·Query/Fragment 원문은 제외한다.

실제 외부 수집은 미확인 기관 판단이나 참여자 동의를 우회해 실행하지 않는다. 합성 E2E, 외부 읽기 전용 호환성, 실제 외부 파일럿을 구분한다. Windows 전체 OS 설치·OS 인증서 신뢰·실제 참여자160세션의 실적은 별도 검증이 필요하다.

[macOS/Windows 정확한 15단계 명령](individual-local-setup.md) · [Export/Import 명령](merge-guide.md)
