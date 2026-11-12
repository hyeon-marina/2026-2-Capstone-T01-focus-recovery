> 현재 실제 텍스트 수집·v5 재동의·설치·학습 변환은 [페이지 원본 수집 가이드](page-content-collection.md)를 따릅니다. 아래 버전별 메타데이터 설명은 당시 동작 기록입니다.

# 수집 절차

기본 설치는 [실행 가이드](individual-local-setup.md)의15단계다. 저장소의 확정 정책을 setup이 자동 설치한다. 별도 내부 승인 파일·정책 작성·관리자 계정·수동 DB Release는 필요 없다.

| 단계 | 확인 |
| --- | --- |
| 준비 | JDK21·Docker·Node·Python·Chrome·age, 공식 main·bootJar·npm ci |
| 초기화 | 본인 setup --slot A/B/C, 독립 MySQL·HTTPS·Credential |
| 정책 | CONFIRMED·Plan1·20목표·160배정·공통 SHA/Checksum |
| 설치 | local.py build, fe/dist-real, localhost 인증서 검증 |
| 로그인 | 본인 participant.json·본인 슬롯 |
| 개시 | 기관 비대상 NOT_REQUIRED 반영, 본인 명시적 동의, 목표·시나리오 선택 |
| 탐색 | 허용된 Origin/Path, 활성5초 이상 유효 Visit≥10 |
| 종료 | POST/PATCH Queue0·END ACK·전송 확인 |
| 원본 | RAW_COLLECTED·AI NOT_RUN |
| 전달 | age Export·최신 privacy·SHA, Manifest 검증·중복 방지 Import |

실제 외부 요건이 미충족이면 외부 탐색 수집을 수행하지 않는다. 합성 Chrome·Spring·MySQL E2E와 외부 읽기 전용 호환성 검증을 별도 기록한다. 실제160세션 실적으로 합산하지 않는다. 현재 기관 판단은 NOT_REQUIRED다. 실제 참여자 동의는 별도이며 자동 E2E 동의는 본인의 동의가 아니다.

URL은 정확한 사이트 범위·민감 키·인코딩을 검사한 직후 세션별 HMAC 페이지 식별자로 대체한다. Query가 있다는 이유만으로 일괄 차단하지 않으며 page/p와 알려진 추적값·anchor를 처리한다. 미검토 Query·hash route·민감 파라미터는 차단한다. 제목은 고정 Topic으로 제한하고 본문은 METADATA_ONLY 표식만 남긴다. 원본 URL·HMAC key는 Export하지 않는다.

전체 동의 철회 시 수집 중단·기존 격리·최신 privacy 기반 회수 및 재Import 차단을 유지한다. 보존은 최종 평가 종료일+90일이며 날짜·사본·삭제 실행은 별도 운영대장에 기록한다.
