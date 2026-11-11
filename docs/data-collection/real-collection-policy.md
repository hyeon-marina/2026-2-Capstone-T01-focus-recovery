# 실제 웹 탐색 원본 수집 정책 권고안 (#105)

이 문서는 개발 기본안이다. **실제 개시는 BLOCKED**다. [TEAM_POLICY.json](TEAM_POLICY.json)은 `focus-local-policy/1`, `RAW_ONLY`, `DRAFT`이며 실제 팀 의결·참여자 동의·기관 판단 증거가 없다. `UNRESOLVED`, 빈 증거/기간, Goal DRAFT, Plan revision 0을 유지한다. 이 PR이나 SHA-256만으로 승인되지 않는다. [적용 절차](policy-application-guide.md)의 실제 기록을 확보한 뒤 동일 Java 검증기를 통과해야 한다.

## 목적과 운영 범위

개발팀원 A/B/C 3명이 각자 PC의 Chrome Extension에서 명시적으로 시작·종료한 Session으로 웹 탐색 중 목표 유지·이탈·복귀 행동을 관찰한다. 저장은 각자의 로컬 Spring Boot + MySQL에 한정한다. 캡스톤 AI 모델 학습·평가에만 이용하며 원본을 공개하거나 외부 배포하지 않는다. 통합 담당자에게는 기존 age 암호화 Export만 전달한다. Credential·Owner Key·Secret·age 개인키를 공유하거나 Git에 넣지 않는다.

기존 20개 목표 원문/완료 기준/시나리오를 [상세 검토안](confirmed-goals-proposal.md)에 유지했다. 총 160세션, 목표당 8개(4시나리오×2회), A54/B53/C53, PLAN-001~160을 유지한다. 의도한 시나리오는 관찰 결과나 AI 정답이 아니다. 실제 행동을 별도 검토·라벨링해야 한다. 5초 유효 체류·4초 복귀·최초 5분 PATCH·최소 10 Visit·권장 12~15·size3/stride1·END ACK를 유지한다.

## 저장하는 값과 저장하지 않는 값

| 기존 필드/자료 | 이번 로컬 정책의 의미 |
| --- | --- |
| participant/source/goal/plannedSession/session/visit ID | 가명·출처·배정·방문 연결; 실제 이름/연락처 제외 |
| scenarioType | 계획한 행동 조건; 자동 정답 아님 |
| domain | 정확한 허용 호스트 |
| normalizedUrl | 실제로 열 주소가 아닌 `origin + 승인 prefix + /__focus_page__/ + 64hex HMAC` 식별자 |
| title | 원제목 대신 `Topic: GIT` 등 23개 고정 분류 또는 `Public browsing metadata` |
| content | `METADATA_ONLY: public browsing activity; page text, title and search terms were not collected.` 고정 표식; 본문 추출 성공을 뜻하지 않음 |
| searchQuery | 검색 페이지는 `[NOT_COLLECTED]`, 그 외 null. 검색어 수집 실적에 포함하지 않음 |
| isSearchResultPage | 검토된 검색 경로 여부. 결과 개수·결과 텍스트는 저장하지 않음 |
| sequence/visitedAt/activeDurationMs/tabSwitchCount/behaviorVersion | 기존 방문 순서·시각·활성 체류·탭 이동·누적 행동 |
| queue/ACK/rawQuality/analysisState | 전송 및 원본 품질 상태. RAW_COLLECTED와 NOT_RUN 구분 |

고정 분류: GIT, ACCESSIBILITY, PYTHON, HTTP_CACHE, RECYCLING, ENERGY, URBAN_CLIMATE, LIGHTING, MATERIALS, HANGUL, ART, LIBRARY, ARCHIVE, MUSIC, GEOLOGY, ASTRONOMY, WEATHER, TRANSPORT, BIOLOGY, TRAVEL, COOKING, HOBBY, OTHER. 제목의 제한된 키워드를 로컬에서 분류하며 원제목은 전송하지 않는다. OTHER/오분류가 가능하고 페이지 의미를 충분히 재현하지 못할 수 있다. 이 데이터만으로 본문 기반 의미 관련성 모델 학습이 충분하다고 보장하지 않는다. 원본 텍스트 확대가 필요하면 별도 정책 검토·새 버전·재동의를 먼저 수행한다.

이 최소화 경로는 `focus-local-policy/1`에 적용한다. 기존 real-collection의 독립 승인 Artifact/AI 증거·v1/합성·AI 활성 경로의 의미는 바꾸지 않는다. DB Migration과 `focus-raw-export/1` 필드/소유권/ID 대응은 변경하지 않는다. 기존 Export의 title/content가 원문일 수 있으므로 통합 시 정책 digest·수집 버전별로 해석한다.

## URL과 개인정보 보호

1. Extension은 정확한 origin과 path 경계를 확인한다. 형제 prefix·위장 호스트·인증정보·민감 경로/키·중복 기능 Query·다중 인코딩/인코딩 슬래시·상대 경로 우회를 차단한다. 모든 사이트를 허용하지 않는다.
2. 기능에 필요한 `q/query`, 공개 YouTube `v`, 블로그 공개 글 식별자, 숫자 페이지 번호만 잠시 정규화한다. 미검토 Query는 거절한다. 알려진 추적 값과 일반 앵커는 식별에서 제거한다. Hash SPA 라우트는 미지원/차단이며 임의로 경로로 승격하지 않는다.
3. 설치별 무작위 비밀키로 `sessionId + 정규화 URL`의 HMAC-SHA256을 생성한다. 키는 trusted-context 전용 로컬 Extension 저장소에만 있고 서버/Export/콘텐츠 스크립트로 전달하지 않는다. 동일 세션의 페이지를 구분하고 다른 세션/PC 간 연결을 줄인다. 검색어의 단순 SHA-256은 사전 공격에 취약하므로 쓰지 않는다. 키가 유출되면 보호가 약해진다. 가명화이며 완전 익명화가 아니다.
4. 원문 URL은 브라우저/메시지/Worker 메모리의 검증 단계에서만 취급한다. IndexedDB·POST·DB·Export에는 불투명 주소만 남긴다. 인증 Token·Cookie·입력값은 읽지 않는다. 민감 DOM을 감지하면 기존 격리 동작을 유지한다. Backend는 로컬 정책에서 고정 title/content/query·식별자 형식·정확한 사이트·Build/Session digest를 재검증한다. 서버가 원래 웹페이지를 재방문하거나 HMAC을 복호화하지는 않는다.
5. 로그인/인증·계정·이메일/메신저/개인 문서·금융/결제·의료/건강·개인정보·비공개·허용 밖 콘텐츠는 수집 제외다. YouTube 영상·음성·자막·댓글·계정·개인화 추천은 읽거나 저장하지 않는다. 공개 블로그도 제3자 개인정보 위험이 있어 공개성만으로 승인하지 않는다.

정규식과 DOM 검사만으로 민감 페이지를 완전히 식별할 수 없다. 제목 분류도 민감 맥락을 완전히 탐지하지 못한다. 폼 사용/동적 로그인/iframe/비표준 UI·사이트 변경은 오탐/미탐을 만들 수 있다. 별도 수집용 비로그인 Chrome 프로필에서 승인된 공개 주제만 탐색한다. 민감 페이지를 발견하면 즉시 종료하고 해당 세션을 격리·철회 처리한다. 안전장치를 우회하거나 개인정보를 제거했다고 가정하지 않는다. 회귀/실행 결과는 [검증 보고](issue105-validation.md)에 구분한다.

## 사이트와 이용 조건

[사이트 검토표](site-collection-review.md)의 20개 쌍은 관리 가능한 **DRAFT 후보**다. Google/Naver Search·YouTube·Naver Blog·Britannica는 별도의 미확정 목록이며 TEAM_POLICY sites에는 없다. 사용자 수동 탐색이라는 사실이 Extension의 자동 처리를 당연히 허용한다는 근거가 되지 않는다. 특히 [YouTube 약관](https://www.youtube.com/static?template=terms), [Google 자동 트래픽 정책](https://developers.google.com/search/docs/essentials/spam-policies), [Naver 검색결과 수집 정책](https://policy.naver.com/policy/search_policy.html)을 확인했으며 허가/적용 범위를 실제로 판단하기 전 활성화하지 않는다. 호환성 테스트와 이용 허가는 다르다. 로그인·구매·댓글 작성·개인정보 입력·자동 검색·대량 복제는 수집 시나리오에 포함하지 않는다.

## 동의·보존·삭제·철회

보존 기본 **제안**은 최종 평가 종료일부터 90일이다. 현재 실제 평가 종료일·기산일·삭제 실행일·담당자/연락 경로가 확인되지 않았다. `retentionRef`의 실제 비공개 운영 기록에 날짜, 원본 PC 3개·Chrome 프로필/IndexedDB/HMAC 키·통합본·Export·백업 사본 대장, 각 담당자와 완료 확인자, 암호키 처리, 삭제 증빙 위치를 확정해야 한다. 개인정보를 포함한 운영 기록 자체는 공개 Git에 넣지 않는다. 이 PR은 자동 삭제 작업을 예약하거나 이미 삭제했다고 주장하지 않는다.

각 참여자는 정책/항목/보존/철회 설명을 읽고 Extension에서 스스로 명시적 동의를 기록한다. setup·정책 설치·Credential 회전이 동의를 만들지 않는다. 철회 버튼은 즉시 신규 수집을 중단하고 서버/Queue 격리·동의 철회를 요청한다. 네트워크가 끊겼으면 재연결하여 철회 ACK를 확인한다. 통합 담당자는 최신 privacy snapshot/hash를 전달받아 과거 Export의 재유입을 차단한다. 이전 원본/암호화 Export/통합/백업/모델 영향까지 사본 대장대로 회수·이용 중단·삭제하고 증거를 기록한다. QUARANTINED와 PURGED는 다르다. 외부 사본까지 자동 삭제되었다고 표시하지 않는다.

실제 전원 의결·동의, 기관 REQUIRED_SATISFIED/NOT_REQUIRED 판단 근거, 보존/회수 책임, 개시 승인과 실제 HTTPS 파일럿을 확보하기 전에는 실제 데이터를 수집하지 않는다.
