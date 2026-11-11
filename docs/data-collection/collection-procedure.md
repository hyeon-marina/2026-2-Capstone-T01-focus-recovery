# 참여자 수집 절차 — Issue #99

최신 개인 PC 준비는 [#103 셀프 초기화](individual-local-setup.md), 실행 결과는 [검증 보고](local-self-setup-validation.md)를 따른다. 목표·정책이 DRAFT이면 계정·배정 준비까지 완료하고 실제 수집 단계는 BLOCKED로 남긴다.

## #101 개인 PC 원본 수집 — 현재 경로

각자의 Chrome → IndexedDB → localhost HTTPS Spring → localhost MySQL로 수집합니다. AI/FastAPI 없이 시작·Visit POST·Behavior PATCH·END·ACK·원본 품질·진행률·철회·Export가 동작합니다. [설치](individual-local-setup.md) 후 [실제 버튼/27단계 매뉴얼](participant-guide.md)을 따릅니다. 실제 수집 개시는 BLOCKED다. #103 individual-local은 `setup --slot`의 OS 소유자 경계와 확정 공통 RAW_ONLY 정책/hash로 기술 Release를 자동 연결한다. Build/Session Scope·현재 본인 동의·허용 사이트·기관 판단은 유지한다. real-collection의 독립 운영 승인은 그대로다.

`POST /api/collection/assignments/{plannedId}/start` → 기존 Visit/Behavior API → `POST /api/sessions/{id}/end` → END ACK/Queue0 → 기존 `POST /api/collection/attempts/{id}/delivered` → `GET /api/collection/progress`의 `attempts[].rawStatus=RAW_COLLECTED`를 확인합니다. `analysisState=NOT_RUN`을 분석 성공으로 표시하지 않습니다. 기존 `QUALITY_PASSED`는 AI까지 포함한 의미를 유지합니다.

수집 종료 후 `dataset.py export`로 age 암호화 파일을 만들고 [통합 관리자 매뉴얼](merge-guide.md)의 최신 privacy·해시·Import 검증을 수행합니다. 본문/Secret/Export를 GitHub에 올리지 않습니다. 아래 #99/#97 절은 AI 활성 경로 또는 당시 기록이며 원본 전용 흐름에 AI 실행을 요구하지 않습니다.


현재 실제 참여자 수집은 **BLOCKED**입니다. 이 절차는 승인·운영 배포 후의 실제 `real-collection` 화면과 통제된 일반 HTML 검증에 사용한 동일 Adapter를 설명합니다. 실제 사람의 등록·동의·공용 서버·가중치·허용 사이트·기관 확인을 테스트가 대신하지 않습니다. [현재 검증 결과](real-collection-validation.md)를 먼저 확인합니다.

1. **Chrome 준비**: 공식 Chrome을 설치하고 `chrome://settings/help`에서 버전을 확인합니다. Manifest의 최소 버전은106이지만 실행 검증 버전은 보고서에 별도로 적습니다. 전용 Chrome 프로필을 사용하고 개인 계정에 로그인하지 않습니다. Windows는 아직 NOT_TESTED입니다.
2. **설치**: 운영자에게 ZIP·SHA-256·`build-info.json`의 Commit/배포 ID/서버/정책 digest를 받습니다. ZIP 체크섬을 확인하고 별도 폴더에 풉니다. `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드합니다** → `manifest.json`이 있는 폴더를 선택합니다. 패키지의 API·허용 사이트 권한을 운영자의 승인 목록과 대조합니다. 현재 제공되는 빈 허용 목록 DRAFT 패키지는 수집을 시작할 수 없습니다.
3. **화면 열기**: 확장 아이콘을 클릭하면 `participant/index.html`이 열립니다. 하단 버전·Commit·mode·서버를 확인합니다. v1/synthetic/participant/pilot은 별도 빌드입니다.
4. **로그인**: **발급 자격정보**에 로컬 setup이 발급한 본인 Credential(파일 불러오기 지원)을 입력하고 **인증 / 계정 전환**을 누릅니다. 정상 표시는 **인증됨**입니다. Credential을 캡처·메신저 공개방·GitHub에 올리지 않습니다. Chrome 전체 종료 후에는 재로그인합니다.
5. **정책과 동의**: 정책 버전/상태, 목적, 항목, 이용 범위, 보존·삭제 참조, 승인 근거를 직접 읽습니다. 체크박스를 선택한 뒤 **수집 동의 기록 저장**을 누릅니다. SYNTHETIC 정책이면 버튼은 **합성 동의 기록 저장**이며 실제 동의가 아닙니다. 동의 기록과 수집 Gate는 별개입니다. **서버 동의 유효**와 **서버 수집 Gate 유효**를 모두 확인합니다. 하나라도 차단이면 탐색을 시작하지 않습니다.
6. **배정 확인**: **배정 목표**에서 본인의 PLAN을 선택합니다. 목표와 시나리오를 확인합니다. 후보 원문과 일치하는 목표는 시나리오별 수행 방법·종료 기준도 표시합니다. 다른 목표의 상세 절차는 운영자가 확인한 안내를 따릅니다. DRAFT 목표로는 시작할 수 없습니다. 시나리오는 AI/사람의 정답이 아닙니다.
7. **시작**: **세션 시작**을 눌러 **세션 상태 ACTIVE**를 확인합니다. 서버가 확정 배정·본인 소유권·현재 동의·승인 배포·유효기간을 다시 검증합니다. 같은 시작 요청은 같은 세션으로 복구됩니다.
8. **탐색**: 승인된 origin/path 안에서 일반 공개 HTML 또는 승인된 Google/Naver 검색 결과를 탐색합니다. 별도 사이트 이동은 먼저 승인 목록을 확인합니다. 로그인·폼 입력·구매·개인정보 검색을 하지 않습니다. 목표·시나리오에 맞추되 개인정보가 등장하면 즉시 중단합니다.
9. **자동 수집**: 활성 창·활성 탭·보이는 페이지에서 실제 관측한 시간만 셉니다. 연속 관측 gap이1,500ms를 넘으면 그 간격은 더하지 않습니다. 5,000ms 이상이고 추출에 성공해야 유효 Visit입니다. 4,000ms 미만 같은 대상 복귀는 누적, 이상은 새 Visit입니다. 장시간 활성300,000ms 최초 도달과 이탈/종료 시 행동 PATCH를 보냅니다. 임의로 시간을 채우지 않습니다.
10. **확인**: 확장 화면의 **서버 수신 Visit**, **미완료 POST/PATCH**, **미전송 알림 영수증**을 봅니다. 화면을 앞으로 가져오면 기존 탭의 활성 체류는 중단됩니다. 최소10개, 권장12~15개 유효 Visit을 확보합니다. 검색/본문 추출 실패는 유효 Visit이 아닙니다.
11. **알림**: 확장 화면에 **처음의 목표를 확인하세요**가 나타나면 **목표로 돌아가기** 또는 **탐색 계속하기**를 누릅니다. 화면 표시·선택 ACK가 영속 전송됩니다. 현재 알림 UI는 참여자 화면이며 웹페이지 위 팝업은 구현하지 않았습니다.
12. **종료**: 목표별 종료 기준과 최소 Visit을 확인한 후 **세션 종료 · 수집 중지**를 누릅니다. 별도 일시정지/재개 버튼은 없습니다. 탭 비활성화는 시간 측정만 멈추며 명시적 수집 종료는 이 버튼입니다.
13. **전송 완료**: **종료 ACK acked**, 미완료 POST/PATCH0, 미전송 알림 영수증0을 확인합니다. **재전송 / 복구**, **진행 상태 새로고침**을 누릅니다. 종료 ACK만으로 품질 완료가 아닙니다.
14. **결과**: **나의 진행**의 PLAN·source·status·Visit/Window·전송 확인을 확인합니다. 10 Visit이면 ordered Window8개, AI/최신 BE 상태 이력, 전송 확인이 모두 있어야 `QUALITY_PASSED`입니다. 실제 `completed`와 SYNTHETIC 품질 실적은 분리됩니다.
15. **오류·재시작**: 네트워크 복구 후 **재전송 / 복구**를 누릅니다. Chrome/Worker 재시작 시 IndexedDB가 Queue를 복원하며 관측하지 않은 시간은 더하지 않습니다. 전체 Chrome 종료 후 같은 계정으로 로그인합니다. 인증 만료 시 `local.py setup --slot A/B/C --rotate-credential` 후 새 파일로 재로그인합니다. 다른 계정의 Queue는 전송되지 않습니다. 저장 오류·격리·정책 변경·버전 불일치는 담당자에게 PLAN/오류 상태만 전달합니다. 원문·Token을 보내지 않습니다.
16. **재수집**: 데이터 부족·분석 실패·`RECOLLECT_REQUIRED`는 운영자가 이전 attempt의 사유를 기록한 뒤 같은 PLAN의 새 시도를 안내합니다. 기존 attempt를 덮어쓰지 않습니다. 세션 ID/IndexedDB를 직접 수정하거나 Extension을 재설치하지 않습니다.
17. **철회**: **전체 동의 철회 · 수집 즉시 중지**를 누르면 새 수집·전송을 즉시 차단하고 철회 요청을 영속화합니다. 서버 확인이 없으면 연결 복구 후 같은 계정으로 재전송합니다. `QUARANTINED`는 격리 접수이며 전체 삭제 완료가 아닙니다. 로컬 current/archive·백업·Export·학습 사본의 안전 폐기는 담당자가 승인 정책에 따라 별도로 확인해야 합니다.

수집 필드와 제외 항목은 [참여자 안내서](participant-guide.md), 서버 저장/장애 처리는 [데이터 흐름](data-flow-and-storage.md), 확인 방법은 [데이터 검증](data-verification.md)에 있습니다. 실제 문의·사고 대응 담당자는 아직 지정되지 않아 BLOCKED입니다. 운영자가 비공개 연락 경로를 전달하기 전에는 참여자 파일럿을 진행하지 않습니다.
