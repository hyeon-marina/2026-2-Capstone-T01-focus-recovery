# 데이터 수집 규격

## 1. 적용 범위와 결정 상태

[Issue #79](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/79)의 중간 발표 이후 정책이다. 분석 기준 코드는 공식 main `d0d40f892a8ed54253a12884fb6f64a149272f27`이다. **문서 변경으로 제품 동작이나 DB가 변경되지는 않는다.**

- **확정:** Issue와 작업 요청에 명시된 정책 및 기존 전송·개인정보 보호 계약.
- **제안 P1~P6:** 구현에 필요한 추가 설계다. 합의 완료를 뜻하지 않는다. [공통 연동 계약](data-analysis-contract.md)에 대안·근거·확정 담당자를 기록한다. 승인 전 제안마다 다른 방식을 구현하지 않는다.
- 우선순위: #79 확정 정책 → 승인된 공통 계약 → 기능명세. README·project-plan·과거 검증 보고서의 5페이지/확률 분류는 변경 전 기준이다. 과거 PASS는 새 정책의 검증 결과가 아니다.

## 2. 책임과 유효 방문

| 영역 | 책임 |
| --- | --- |
| FE | 방문·본문 수집, 활성 체류 측정, 5초 유효 방문 전달, 5분 행동 갱신, 영속 큐·복구 |
| BE | 방문 저장·순서·중복 관리, AI 요청, Window 식별자 발급·저장, 최종 상태·이력 저장 |
| AI | 페이지별 목표 관련성·합리적 우회 분석, 최근 유효 방문 3개 Window 구성, 결과 반환 |

유효 Page Visit은 활성 세션에서 수집 허용 URL·DOM·콘텐츠 조건을 만족하고 **활성 체류시간이 5초(5,000ms) 이상**인 방문이다. 4,999ms 이하는 분석 대상이 아니다. 일반 HTML 본문 최소 50 Unicode code points, Google·Naver 검색 결과는 검색어와 유기적 결과 1건 이상이라는 기존 기준을 유지한다. 제목만으로 분석하지 않는다.

추출을 끝내 실패한 관측은 **EXTRACTION_FAILED**로 별도 기록하고 유효 방문/Window 개수에서 제외한다. SHORT_DURATION, 민감 URL·DOM 제외와 구분한다. 실패를 NORMAL·UNRELATED·체류시간 0으로 대체하지 않는다. AI 실패도 처리 상태와 오류 코드로 기록하며 최종 상태는 null이다. UNJUDGEABLE은 사람의 정답 판단 불가 라벨이며 전송 오류 코드가 아니다.

수집은 사용자 시작부터 **종료 선택 직전까지** 계속한다. 기존 `MAX_CANDIDATES = 200`은 지속 수집과 충돌하므로 ACK 완료·재복귀 필요 여부에 따른 저장소 정리가 필요하다. 미전송 원본·실패 요청·재시도 스냅샷·sequence 상한을 한도 때문에 버리지 않는다. 저장 실패 시 기존 안전 중지·복구를 유지한다.

## 3. 방문 재사용과 콘텐츠

확정 정책: 동일 URL 복귀 간격 **4초 미만이면 같은 방문과 활성 체류 누적**, **4초 이상이면 새 visitId**다. 새 방문에서도 기존 제목·본문을 우선 재사용한다. 캐시 재사용은 방문 합치기를 뜻하지 않는다.

구현 경계는 **제안 P1**이다.

| 경계 | P1 권장 계약 |
| --- | --- |
| 기준 시각 | 동일 탭·탐색 대상의 활성 측정을 멈춘 leftAt부터 다시 활성화된 returnedAt까지. 서버 도착 시각 아님. 정확히 4,000ms는 새 방문 |
| 다른 앱·최소화·창 비활성 | 체류 중지 및 같은 4초 경계 적용. 중복 이벤트로 leftAt을 뒤로 밀지 않음 |
| 다른 탭의 동일 URL | browserTabKey가 다르므로 다른 방문. 세션 내 콘텐츠만 재사용 가능 |
| 같은 탭 A→B→A | A 이탈부터 복귀까지 <4초이며 동일 대상이면 A 재개. B는 별도 후보이고 5초 미만이면 제외 |
| 새로고침 | 동일 대상의 비활성 간격에 같은 4초 경계 적용. 기존 무조건 방문 유지 정책 변경 |
| SPA | 기존 URL identity와 주요 콘텐츠 동시 변경 판정 유지. 다른 검색어/게시글이면 새 대상, 같은 대상 복귀에만 4초 규칙 적용 |
| Worker·브라우저 재시작 | 관측 불가 시간을 더하지 않음. 간격·문서 동일성을 입증하지 못하면 recoveryRequired 경로로 보류 |

동일 URL 판정에는 **저장용 normalizedUrl만 사용하면 안 된다.** 기존 `shared/url.ts`의 로컬 identity와 검색어/콘텐츠 검증을 이용한다. Query를 제거한 검색 URL, `?id=100`/`?id=200`은 저장 URL이 같아도 다른 대상일 수 있다. 원본 Query 전체를 새 서버 필드로 저장하지 않는다. identity 비교·SPA 로딩 대기 세부값은 P1 승인 항목이다.

캐시는 세션·탐색 대상별 성공한 제목·본문만 사용한다. 매 복귀 때 권한·URL·민감 DOM을 재검사한다. 실패/권한 철회 자료는 재사용하지 않는다. 콘텐츠·검색어가 바뀌면 다시 추출한다. POST된 제목·본문은 불변이며 새 콘텐츠는 새 방문에 붙인다. 전송 후 민감 DOM으로 바뀌는 경우의 서버 정정·삭제 정책은 P2 선결 사항이다.

## 4. URL·본문·개인정보

- http/https만 허용한다. 호스트 소문자, 기본 포트·인증정보·Query·Fragment 제거, 경로 보존. domain은 서브도메인 포함 전체 hostname이며 포트를 제외한다.
- Google q, Naver query는 Query 제거 전에 추출한다. 일반 페이지 searchQuery는 null이다. 검색어를 추정하지 않는다.
- 광고·메뉴·푸터·숨김 요소·스크립트·폼을 제외한 본문을 공백 정리 후 **최대 5,000 Unicode code points**로 제한한다. UTF-16 code units나 바이트 수가 아니다. BE는 초과값을 자동 절단하지 않고 400으로 거절한다(PR #58).
- chrome/extension/file/data/blob/javascript URL, 로그인·인증·결제·금융·개인정보 입력 페이지, PDF 뷰어, 영상·음성 자체, 오류·빈 문서를 제외한다. 확실하지 않은 민감 페이지는 수집하지 않는다.
- 비밀번호·폼 값·쿠키·토큰·브라우저 저장소·클립보드·전체 키 입력·전체 방문 기록은 수집하지 않는다. 민감 원문을 로그/공개 Git에 게시하지 않는다.

## 5. 활성 체류시간·행동 갱신

activeDurationMs는 **탭과 Chrome 창이 모두 활성**인 시간의 누적 정수 ms다. 비활성·최소화·다른 앱·관측 불가 구간은 제외한다. tabSwitchCount는 A→B 실제 활성 탭 전환 때 **이전 A 방문**에 1을 더한다. 같은 탭 URL 이동·비활성 새 탭·앱 포커스만 변경은 전환이 아니다. 제외 대상 탭으로 나가도 직전 유효 방문에 귀속한다.

| 전달 시점 | 계약 |
| --- | --- |
| 최초 5초 도달 | 콘텐츠·권한 검증 후 POST를 영속 큐에 기록. ACK가 정확히 5초에 온다는 뜻은 아님 |
| 최초 5분 도달 | old < 300000 <= new일 때 누적값 PATCH를 영속 큐에 기록. 5분마다 반복 아님 |
| 이탈·탭 전환·종료 | 최종 누적값·버전 전달. 매초 HTTP 전송하지 않음 |

기존 10초 분석 준비 대기는 폐기 대상이다. 타이머가 300,120ms에 실행되면 실제 300,120을 보내며 300,000으로 고치지 않는다. 복구 시 임계값을 넘었으나 ACK가 없으면 같은 요청을 재전송한다. 5분·이탈 이벤트가 합쳐져도 BE는 누적값으로 통과를 판별한다(P3).

## 6. 식별자·순서·전송

| 필드 | 공통 계약 |
| --- | --- |
| visitId | FE UUID v4. 재전송·4초 미만 복귀·Worker 복구에서 유지, 새 방문은 새 UUID |
| sessionId | BE UUID. 방문은 한 세션에만 연결 |
| sequence | 양의 int32, 확정 후 재사용·재번호 금지. BE는 공백 허용 |
| browserTabKey | FE의 세션 내 탭 문자열(최대 100자). 한 탭에 여러 visitId 가능, Chrome 숫자 tabId와 구분 |
| activeDurationMs | 0 이상 int64, JSON은 JS safe integer 범위. 최초 유효 방문은 5,000 이상 |
| tabSwitchCount | 0 이상 int32, 방문별 누적값 |
| behaviorVersion | 0 이상 int64, JS safe integer 범위. 누적 행동값 변경 시 증가, 재전송은 같은 버전·값 |

기존 FE는 후보 생성 순서로 finalized까지 기다린 뒤 유효 방문에 연속 sequence를 부여한다. **그대로는 열린 탭의 5초 전달을 만족하지 못한다.** P2는 유효성 확정 시 발급하는 대안을 제시한다. 방문 시작 순서와 유효화 순서가 달라질 수 있어 팀의 명시적 선택이 필요하다. 기존 순서 의미를 몰래 바꾸지 않는다.

POST 원본을 동결하고 sequence 오름차순으로 한 건씩 전송한다. ACK 영속 저장 후 다음 POST를 보낸다. PATCH는 해당 POST ACK 이후 전송한다. 전송 중 요청을 바꾸지 않고 최신값은 다음 버전으로 보낸다.

BE는 낮은 behaviorVersion을 무시하고 최신 ACK를 반환한다. 같은 버전·같은 값은 멱등, 같은 버전·다른 값은 BEHAVIOR_VERSION_CONFLICT, 높은 버전에서 누적값 감소는 BEHAVIOR_COUNTER_DECREASED다. visitId 원본 불일치·sequence 중복의 기존 409를 유지한다. 현재 POST 원본 비교는 행동값을 제외하며 행동값은 PATCH로 동기화한다.

IndexedDB aggregate checkpoint, 직렬 이벤트, POST/PATCH ACK, 재시도 예산·수동 재시도, 손상/서버 변경 시 원본 보존, 권한 철회, Worker 복구를 유지한다. ACK 완료 자료 정리는 미완료 큐·재전송 영수증과 분리한다. 1~5초 구버전 방문을 새 정책 방문으로 재해석하지 않는다.

## 7. Window·최종 상태·상태 이력

Window Size **3**, Sliding Stride **1**. W1=[P1,P2,P3], W2=[P2,P3,P4], W3=[P3,P4,P5]. n개 유효 방문에서 max(0,n-2)개다. **AI가 구성 방문을 선택하고 BE가 windowId를 발급·저장**한다. 방문 1~2개는 분석 대기이며 NORMAL로 채우지 않는다(P4).

AI는 페이지별 DIRECT / JUSTIFIED_DETOUR / UNRELATED를 예측한다. BE는 Window 끝 방문 기준 **연속 무관 방문 suffix**와 해당 방문들의 활성 체류로 판단한다(P5). 관련/합리적 우회는 연속 무관 수를 끊는다.

| 평가 순서 | 조건 | finalState |
| --- | --- | --- |
| 1 | 필수 AI 결과 실패·누락·추출 실패 입력 | null, 판단 보류/실패 |
| 2 | 마지막 방문 DIRECT 또는 JUSTIFIED_DETOUR | NORMAL |
| 3 | 연속 UNRELATED 3개 | DRIFT |
| 4 | 연속 UNRELATED 1~2개, 하나라도 300,000ms 이상 | DRIFT |
| 5 | 연속 UNRELATED 2개, 모두 300,000ms 미만 | TRANSITION |
| 6 | 연속 UNRELATED 1개, 300,000ms 미만 | NORMAL |

과거 무관 페이지의 긴 체류가 최신 관련 페이지보다 우선하지 않는다. AI 확률·Context 중간 상태는 이 규칙을 대체하지 않는다. P5는 연속 범위·평가 순서의 구체화 제안이며 Issue의 여섯 조건 자체는 확정이다.

체류 갱신으로 새 Window나 AI 재호출을 만들지 않는다. BE는 해당 방문을 포함하는 **모든 기존 Window**를 고정 AI 결과와 새 행동 스냅샷으로 재판단한다. windowId + stateVersion(1부터), judgedAt, 방문별 activeDurationMs·behaviorVersion, finalState, 관련 AI 분석 ID·결과, ruleVersion을 append-only로 보존한다. 같은 상태라도 입력이 바뀌면 새 버전, 같은 입력 재처리는 새 버전이 아니다(P5).

예: P1·P2 DIRECT, P3 UNRELATED이면 W1 v1(5,000ms)=NORMAL, v2(300,000ms)=DRIFT. v1을 최신 방문 값으로 덮어쓰지 않는다. 실패 기록과 성공 이력을 구분하고 결과의 신선도/오류를 함께 제공한다. 오래된 Window 재판단이 최신 Window 상태·알림을 되돌리지 않는다.

## 8. 종료·미전송 복구

종료 **선택 즉시** 신규 수집·알림 중지 → 마지막 행동 확정 → POST/PATCH IndexedDB 보존 → 필수 ACK 영속 확인 → POST /api/sessions/{sessionId}/end → ENDED 확인 후 정리 순서다. FE END_PENDING은 BE 상태가 아니며 BE는 ACTIVE/ENDED를 유지한다.

선택 finalBehaviors의 원자적 반영을 유지한다. 현재 FE는 POST/PATCH drain 후 `{}`를 보낸다. 서버가 먼저 ENDED인데 미전송 데이터가 있으면 SESSION_ENDED를 데이터 ACK로 보지 않고 원본·충돌을 보존한다. 수동 복구 정책 없이 재번호·새 세션 복사·삭제하지 않는다. 종료 전 확정된 미완료 분석은 종료 후 저장할 수 있으나 새 알림은 금지한다.

## 9. 데이터셋·라벨링

| 항목 | 목표 |
| --- | --- |
| 작업 목표 / 참여자 | 20개 / 10명 |
| 본 수집 | 160세션, 참여자당 서로 다른 목표 16개 |
| 시나리오 | 목표 유지·합리적 우회·점진적 이탈·명확한 이탈, 참여자당 각 4세션 |
| 세션당 유효 페이지 | 최소 10, 권장 12~15 |
| Window | 최소 1,200개. 160×(10−2)=1,280개 구조상 가능하나 실패·판단 불가 제외 후 실수량 검수 |
| 자연 탐색 | 추가 20~40세션, 본 수집과 별도 집계 |

20목표를 네 작업 영역 각 5개, 목표당 약 8세션으로 균형 배정한다. 참여자에게 상태 정답을 알려주지 않는다. 시나리오는 정답 라벨이 아니다. 관련 페이지를 오래 읽는다고 DRIFT로 라벨링하지 않는다. 5분 경계가 관측되는지 파일럿에서 확인하고 최대 세션 시간은 별도 확정한다.

평가자 3명이 AI·BE 예측을 보지 않고 독립 라벨링한다.

1. Page Visit: DIRECT / JUSTIFIED_DETOUR / UNRELATED / UNJUDGEABLE.
2. Window: NORMAL / TRANSITION / DRIFT / UNJUDGEABLE. 정적 라벨 기준 스냅샷은 P6에서 지정한다.
3. Window 상태 이력: windowId + stateVersion마다 판단 당시 행동 스냅샷을 보고 NORMAL / TRANSITION / DRIFT / UNJUDGEABLE.

독립 투표 보존 후 2명 이상 일치하면 합의 라벨, 3명 불일치는 공동 검토한다. 근거가 부족하면 UNJUDGEABLE로 남긴다. Fleiss' κ는 조정 **전** 독립 라벨로 Page/Window/이력 각각 계산한다. UNJUDGEABLE 포함 비율·제외 후 표본 수와 κ를 함께 보고한다(P6). 예측 정확도 분모에서는 UNJUDGEABLE을 제외하고 건수를 공개한다.

작업 목표 단위 **Train 12 / Validation 4 / Test 4**로 먼저 고정한다. 같은 목표의 모든 참여자·세션·겹치는 Window·상태 버전·자연 탐색 자료는 같은 split이다. Window 무작위 분할 금지. 네 작업 영역을 각 split에 포함하고 Test로 모델·임계값·규칙을 조정하지 않는다. 합성 GOAL-001의 UNREVIEWED 후보 라벨·세션 LOSO는 코드 확인용이며 본 수집 평가와 섞지 않는다.

## 10. Export·버전·후속 작업

UTF-8 JSONL, UTC 밀리초, 정수 ms를 사용한다. sessions, visits, windows, window_states, ai_predictions, human_labels, collection_failures와 manifest의 키·필드·생성 주체·저장 위치는 [공통 계약](data-analysis-contract.md)에 정의한다. 참여자 ID·goalId·시나리오·수집 메타데이터는 관리 영역이며 모델 입력에서 제외한다. AI는 목표 **문자열**과 제한된 페이지·검색 맥락을 사용한다.

collectionSpecVersion, apiContractVersion, ruleVersion, datasetVersion, labelGuideVersion, modelVersions를 분리한다. 구버전 방문·5개 Window·확률 결과는 보존하고 v2와 분리한다. Flyway는 후속 Issue에서 새 버전만 추가하며 V1~V10을 수정·실행하지 않는다. API/DB 변경 전후·미확정·검증·후속 순서는 공통 계약을 따른다.
