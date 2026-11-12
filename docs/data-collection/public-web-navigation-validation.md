# 전체 웹 탐색 수집 검증 (2026-11-12)

기준은 공식 main의 #109 메타데이터 구현이며, 고정 Topic·세션 HMAC·NOT_REQUIRED 결정을 유지했다. 15개 사이트 제한을 제거한 최종 기능 변경을 별도의 테스트 데이터로 검증했다. 초기 다른 기준에서 수행한 탐색 실험 결과는 이 보고서의 근거에 포함하지 않는다.

| 검증 | 결과 |
|---|---|
| FE 타입/단위 테스트 | 919 PASS; 별도 환경 조건부 HTTP 2개는 Backend 연동 회귀에서 실행 |
| Backend 전체 HTTP/Chrome/MOCK AI 회귀 | 1033 사례 중 955 PASS, MySQL 조건부 78개를 포함한 추가 134개 PASS (skipped 0) |
| AI 단위 회귀 | 244 PASS, 실제 모델 가중치 미실행 |
| 개인 수집/수집 도구 | 37 + 5 PASS |
| v2 참조 계약 | 80 schema cases·139 scenarios·216 combinations PASS |
| 실제 외부 HTTPS A/B/C | 각 10개 Visit, 총 30개, 4개 공개 도메인 |
| 세션/행동 | SPA·뒤로 가기·탭 전환·worker/browser 재시작·민감 페이지 제외 PASS |
| 저장/종료 | 각자 HTTPS Spring/MySQL 저장, END ACK, RAW_COLLECTED / AI NOT_RUN |
| age Export/Import | A/B/C 각각 검증, 병합 30개, 중복 Import 3개 감지 |
| 계획/정책 | revision 1·목표20·160배정·A54/B53/C53 유지; A/B/C 동일 SHA |
| 스키마 | 기존 Flyway Migration 수정 없음, 신규 스키마 변경 없음 |

외부 탐색은 Python Docs → Python Blog → Hacker News → Books to Scrape → Python Docs 복귀를 포함한다. 테스트 계정/프로필/DB만 사용했고 실제 인간 참가자의 동의 또는 연구 실적으로 계산하지 않았다. 테스트 Export는 연구 데이터와 병합하지 않았다.

로컬 보호 증거 디렉터리: `/private/tmp/focus106-external`. `summary.json` SHA-256: `7006b1171d939d644df5299410b515d1de388c1c609f0dc25ccf04bd58ee7279`.

공통 정책 SHA-256: `33ea19c5ef99ef79ea1740c78933035b3d57f47545911c28b7befd898dc14830`. A/B/C 서버·Extension에 적용한 바이트와 저장소 `TEAM_POLICY.json`의 바이트가 일치했다.

한계: 인증서 검증은 테스트 인증서 SPKI pin 방식이며 OS 신뢰 저장소 설치를 대신하지 않는다. 실제 모델 가중치·분석 정확도를 검증하지 않았다. 공개 도메인의 로컬 DNS 재지정 및 모든 민감 서비스에 대한 완전한 판별을 주장하지 않는다. 보수적 필터가 공개 페이지를 제외할 수 있다.
