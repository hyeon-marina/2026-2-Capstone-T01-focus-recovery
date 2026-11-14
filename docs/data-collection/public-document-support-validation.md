# 공개 블로그·본문 프레임 지원 검증 — Issue #121

기준 main: 70f9f9c4bd84b3cf7f8208a2ec9fff4b5dbfa236 (PR #120 병합).
현재 상태: 구현·회귀 및 독립 E2E 검증 진행 중. C 운영 반영 전.

## 원인과 수정 범위

- 네이버 재현 URL의 바깥 문서는 본문0, 같은 출처 mainFrame 내부는 기존 .post-body에서 2,006자 추출됐다. 내부 선택자 부재라는 초기 가설은 기각했다. 실제 원인은 최상위 문서만 관찰하던 경계다.
- 일반 블로그의 비시맨틱 본문과 오래된 테이블/줄바꿈 글을 인식하지 못했다. 알려진 본문 루트와 일관된 문단 그룹/텍스트 밀도가 있는 국소 컨테이너를 지원한다. body 전체 fallback/메뉴·링크 목록 수집은 하지 않는다.
- 공개 뉴스레터의 수동 email autocomplete 필드가 전체 layout 제외를 유발했다. 입력값은 읽지 않고 모든 폼/입력을 제외하며, 포커스 시 관찰을 제외한다. 로그인/카드/주소/OTP·Token 등 보호는 유지한다.
- 티스토리의 익명 댓글 작성·닫힌 수정/삭제 password UI가 공개 본문까지 격리했다. 별도 읽을 수 있는 공개 본문이 있고, 알려진 댓글 범위의 정확한 비활성 컨트롤인 경우만 구분한다. 댓글 범위 전체를 본문에서 제외한다. 일반 password 마커, autocomplete 인증정보, 열린 수정창, 실제 password 포커스, 카드/Token 등은 계속 차단한다. 값은 읽지 않는다.

## 문서·개인정보 경계

Manifest all_frames=false와 권한은 유지한다. Content Script의 소유자는 최상위 문서이며, 공개 본문이 없을 때만 화면에 보이는 주된 같은 출처 프레임 하나를 검토한다. Worker는 서버 인증/동의/정책·전경 탭·최상위 문서와 실제 Chrome child frameId/documentId/URL/parent/lifecycle을 검증해 별도 본문 grant를 준다. 추출 전후·비동기 검증 후 현재 문서를 재확인한다.

본문 프레임의 URL은 일시적으로만 사용하고 기존 세션 HMAC 설명으로 변환한다. 원문 URL/프레임 출처 객체는 Visit/진단/Export에 저장하지 않는다. 실제 본문 문서의 제목·텍스트를 사용하고 연락처 마스킹/고위험 검사·상위 문서의 개인정보/유료/접근 제한도 유지한다. 실제 자식 탐색은 후보를 무효화하고, 다른 광고 프레임의 탐색은 건드리지 않는다.

교차 출처·sandbox/srcdoc·중첩/여러 큰 프레임·준비되지 않은 문서는 우회하지 않는다. FRAME_UNAVAILABLE/UNSUPPORTED/AMBIGUOUS/POLICY_BLOCKED/SOURCE_STALE 고정 진단을 제공한다. 기존 BE failure code·IndexedDB format2·Visit ID/sequence·POST/PATCH/END/ACK·5초/4초/1.5초·본문50/5000 계약은 유지한다. 새로운 DB migration/정책 SHA/권한 확대는 없다.

## 사전 명시한 최종 검증 계획

1. FE 전체/TypeScript/공식 real build/package와 실제 대규모 DOM 관찰 예산을 확인한다. 기존 opt-in HTTP2건은 실제 BE 전체 회귀에서 별도 실행한다.
2. 최종 코드 고정 후 신규 프로필·합성 Participant/동의·별도 MySQL Volume **3회 × 10 Visit**: 같은 출처 프레임·프레임 내부 SPA·지연 DOM·일반/레거시 본문·수동 입력·비활성 광고·Worker/Chrome/네트워크·ACK 유실·멱등성·END/RAW·Export/Import/검수 계약. 실제 관찰 시간을 쓰며 시계를 늘리지 않는다.
3. 실제 공개 사이트 목록은 `fe/tests/fixtures/public-document-pages.json`에 고정한다. 네이버/티스토리/Blogger/WordPress/레거시 에세이/일반 기술 글 **신규3환경 × 10 실제 Visit**을 검증한다. 공개 페이지를 mock으로 대체하지 않고 자동 기술 검증 데이터를 사람 행동 데이터로 채택하지 않는다.
4. 별도 새 HTTPS 환경에서 프레임 안의 실제 합성 고위험 텍스트 → 0/N Visit 격리·공식 마감·재수집·이전 행/동의 보존을 확인한다. 운영 세션은 사용하지 않는다.
5. BE 전체/실제 MySQL·HTTP/회수 receiver·AI/데이터셋 검수를 실행한다. 최초 실패를 보존하고 최종 실행과 분리한다.

## 현재까지의 증거

증거 디렉터리 `/private/tmp/focus121-evidence` (원문/Secret/실제 참여자 데이터는 Git에 포함하지 않음).
수정 전 iframe/layout7 FAIL, 바깥 paywall 우회1 FAIL, newsletter/legacy2 FAIL, 줄바꿈1 FAIL,
댓글 생성/수정 UI 및 반복 문서 스캔 FAIL을 각각 보존했다. 수정 중 controlled3×10은 실제 MV3/BE/MySQL·저장/ACK/RAW 및 장애 복구 PASS이며, 실행 중 보강이 있었으므로 최종 동일 코드 반복의 대체 증거로 쓰지 않는다.

실제 사이트 DOM 사전 점검은 네이버·티스토리·WordPress·Blogger·레거시 에세이·기술 글10개에서 본문 인식을 확인했다. 이는 아직 Visit/서버 저장 E2E 성공을 의미하지 않는다. 초기 Tistory 실패(댓글 마커), 레거시 실패, probe 작업 디렉터리 실수도 로그에 보존했다.

## 운영 반영 경계와 남은 범위

현재 실제 C 세션은 사용자 탐색 중일 수 있다. 자동 종료/새 동의/재수집/Export/확장 교체/reload/Backend·MySQL 재시작을 하지 않는다. 최종 후보 검증 후 세션 종료·Queue drain·암호화 백업/복구·동일 확장 ID/경로/Profile/정책 확인과 별도 승인을 받은 FE만 반영한다. 운영 반영 전까지 실제 C에서 새 기능이 검증됐다고 표시하지 않는다.

모든 웹사이트 수집을 보장하지 않는다. 유료·로그인·개인/민감 페이지, PDF/이미지 전용 글, 검증 불가 프레임은 정상 제외/진단 대상이다. 다른 OS·브라우저/외부 구조 변경과 공개 댓글 컴포넌트 변경은 별도 위험이다. 미확인 상태를 PASS로 쓰지 않는다.
