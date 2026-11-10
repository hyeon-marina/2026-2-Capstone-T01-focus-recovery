# Issue #81 — v2 정책 결정안과 구현 검토

## 1. 상태와 검토 기준

**이 문서는 승인 요청안이다. P1~P6 모두 PROPOSED이며 운영 확정 계약이 아니다.** Schema를 검증할 수 있다는 사실은 정책 승인이나 제품 구현을 뜻하지 않는다.

- 검토일: 2026-11-10 KST. 기준 공식 main: `6e15dd3fa1789e96c42bc4f33250c4221d6d2616` (PR #80 merge). 시작 HEAD `5e49cb3125e32b9e040c00b4167f8041d8bfabeb`, detached, tracked 수정·미추적 파일 없음.
- origin: `hyeon-marina/2026-2-Capstone-T01-focus-recovery`, upstream: `SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery` (모두 GitHub HTTPS). fetch 및 `ls-remote`로 최신 main 확인. 동일 로컬/원격 작업 브랜치 없음 확인 후 `docs/81/v2-contract-decisions` 생성. main 직접 commit/push 없음.
- [#81](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/81): OPEN, 댓글 0. [#79](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/79): CLOSED/completed, 댓글 0. [#80](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/80): MERGED, 문서 6개만 변경. PR 본문은 P1~P6를 최종 확정하지 않았다고 명시한다.
- 관련 #43/#46/#48/#51/#59/#64/#67/#74/#77은 API로 CLOSED 확인. 대응 PR #45/#47/#50/#52/#61/#65/#70/#76/#78은 main merge log와 대조했다. 확인 시 open PR 없음. 과거 결함을 현행 미수정으로 보고하지 않는다.
- 별도 repo AGENTS.md/CONTRIBUTING 없음. project-plan의 develop 통합 설명보다 사용자의 이번 공식 main 대상 PR 지시를 따른다. 개인 Fork 브랜치로만 제출하고 merge하지 않는다.

| 상태 | 뜻 | 필요한 근거 |
| --- | --- | --- |
| APPROVED | 이미 수용된 상위 정책 또는 담당자들이 명시 승인한 세부 결정 | Issue/PR/회의 결정 링크, 승인자·날짜·대상 버전 |
| PROPOSED | 이번에 비교·권고한 구현 계약 | 승인 근거 없음, 구현/배포 전 담당 영역 검토 |
| BLOCKED | 필수 외부 근거나 기술 선결이 없어 활성화 불가 | 해결 조건과 담당자. 단순 미승인을 승인으로 바꾸지 않음 |

#79/#80에서 수용된 **상위 요구**(5초, 4초 경계, 최초 5분 갱신, size3/stride1, AI 구성/BE 식별·최종 판단, 여섯 상태 조건, 데이터 수집 목표)는 APPROVED 기준으로 유지한다. **이 사실은 세부 P1~P6 승인 근거가 아니다.** 보존기간·동의/기관 절차는 P6의 BLOCKED 하위 항목이다. 승인 후 아래 각 결정에 실제 링크를 추가하고, Schema 버전·Fixture 기대값을 함께 검토한다.

## 2. 코드의 현재 동작과 회귀 위험

경로는 기준 커밋에 고정된 근거다. 구현 제안과 현재 동작을 혼동하지 않는다.

| 추적 경로 | 확인한 현재 동작 | 목표 차이·회귀 위험 |
| --- | --- | --- |
| [collector.ts](../fe/src/background/collector.ts) `validate/assignSequences/navigate/observe` | >=1000ms valid. 생성순 후보를 순회하다 첫 미종료 후보에서 중단. reload 동일 identity는 무조건 재사용; 탭 복귀는 시간 경계 없음; 같은 탭 A→B는 A 확정, 복귀 캐시 없음. 후보200개에서 중지 | 5000ms 조기 POST는 finalized 의존 제거 필요. 탭별 짧은 복귀와 POST 불변성 양립 필요 |
| [active-time.ts](../fe/src/background/active-time.ts), [index.ts](../fe/src/background/index.ts) | Date.now 기반 차이, 음수0·activeTimeCursor로 중복 방지. 누적 증가마다 behaviorVersion++. 직렬 dispatch·foreground 재조정; 미관측 Worker 시간 가산 안 함. content 1100ms 확인/분당 복구 alarm은 5초·5분 타이머가 아님 | 시계 전진 과대계측, 임계 이벤트 유실을 다뤄야 함. 버전을 타이머 횟수로 만들면 안 됨 |
| [url.ts](../fe/src/shared/url.ts), [content-change.ts](../fe/src/shared/content-change.ts), [content/index.ts](../fe/src/content/index.ts), [extraction.ts](../fe/src/content/extraction.ts), [search.ts](../fe/src/content/search.ts) | transient raw URL 보호 검사. 서버 URL은 query/fragment 제거, identity는 fragment 제외 URL SHA256(query 포함). SPA는 identity **및** 주요 콘텐츠 변경이 함께 있어야 분리; 같은 identity에서 본문만 바뀌면 분리 안 됨. 일반50 code points, 검색어+유기결과, 본문5000, 제목/검색어500 | 저장 URL 충돌·same-URL 동적 문서·hash router 위험. 보안 검사보다 캐시 적중이 우선하면 안 됨 |
| [visit-delivery.ts](../fe/src/background/visit-delivery.ts), [behavior-delivery.ts](../fe/src/background/behavior-delivery.ts), [durable-state.ts](../fe/src/background/durable-state.ts) | POST 동결, 오름차순 한 건·ACK 뒤 다음; PATCH POST 영속 ACK 뒤. sending 영속 후 HTTP, 재시도는 같은 원본. IDB DB_VERSION1/aggregate format1/revision CAS/legacy 영수증 검증. valid>=1000, finalized prefix·연속번호·배열 길이 결합 검증 | 단순 상수 변경은 구 checkpoint를 corrupt로 만들고 ACK 정리가 endDataDrained를 깨뜨림. 새 형식과 영수증 설계 필요 |
| [session-end.ts](../fe/src/background/session-end.ts), index `permissions.onRemoved` | END_PENDING에서 drain→동결{}→END→ENDED 검증. SESSION_ENDED는 ACK 아님. ACTIVE 권한 철회는 suspend·샘플/큐 삭제, nextSequence 보존, 재허용 후 명시 재개. END_PENDING이면 철회에서도 종료 자료 보존 | 권한 철회가 서버 삭제를 수행하지는 않음. 개인정보 회수 작업을 전송 큐 삭제와 독립 보존해야 함 |
| [WorkSessionService](../be/src/main/java/com/focusrecovery/domain/session/service/WorkSessionService.java) | 시작 key 재전송, goal strip, 다른 목표422. 종료 세션 쓰기잠금·선택 finalBehaviors 원자 적용, 이미 ENDED면 기존 결과; 모든 미요청 Window 분석 등록 | 종료와 구성 backlog race; 새로운 관측 금지와 기존 자료 후처리 구분 |
| [PageVisitService](../be/src/main/java/com/focusrecovery/domain/visit/service/PageVisitService.java), [CreatePageVisitRequest](../be/src/main/java/com/focusrecovery/domain/visit/dto/CreatePageVisitRequest.java), [PageVisit](../be/src/main/java/com/focusrecovery/domain/visit/entity/PageVisit.java) | POST>=1000, title/content nullable, 검색 플래그·행동 기본값. 원본 비교는 행동 제외, 동일 ID/원본200(ENDED에서도 replay 우선). sequence UNIQUE, 원본 불일치409. PATCH 낮은 버전 false/같은 값 false/상충409/높은 누적감소409 | v2 강한 필수 검증을 legacy에 소급 금지. 높은 버전·같은 값도 현행 applied=true이므로 판단은 fingerprint로 중복 제거 |
| [AnalysisWindowService](../be/src/main/java/com/focusrecovery/domain/window/service/AnalysisWindowService.java), [AnalysisRequestService](../be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisRequestService.java) | BE size5 구성, sequence 공백 허용. 첫 Window 전에는 역순 저장 가능, 이후 마지막 끝보다 작은 신규번호 거절. 마지막 방문>=10000 또는 종료 때 분석 요청; PATCH는 해당 방문으로 끝나는 미요청 Window만 확인 | 비동기 AI 구성 전 구간이 없으면 역순 삽입 가능. v2는 즉시 단조 저장 watermark와 구성 커서 분리 필요 |
| [AiAnalysisClient](../be/src/main/java/com/focusrecovery/domain/analysis/client/AiAnalysisClient.java), [AiAnalysisRequest](../be/src/main/java/com/focusrecovery/domain/analysis/client/AiAnalysisRequest.java) | HTTP/1.1, IDs·확률0~1/합·UTC millis·modelVersions 검증. 5방문, v2 pageResults 없음 | v1 확률 검증기를 v2에 그대로 적용 불가; 소속·page 1:1·fingerprint 검증 추가 |
| [AnalysisExecutor](../be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisExecutor.java), [AnalysisRecovery](../be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisRecovery.java) | commit 후 PENDING→RUNNING claim, network 밖 transaction, RUNNING만 완료; queue full/timeout 기록, recovery는 stale을 FAILED 확정하고 자동 AI 재요청 안 함 | 늦은 응답은 FAILED 덮기 금지. 구성 작업의 재시도와 분석 재시도를 구분 |
| [AnalysisQueryService](../be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisQueryService.java), [AnalysisResult](../be/src/main/java/com/focusrecovery/domain/analysis/entity/AnalysisResult.java) | Window당 결과1개; 최신 windowIndex 순 조회, list/detail/input snapshot, 조회는 부작용 없음 | 최신 Window pending을 과거 성공으로 위장 금지. 행동 재판단은 결과 row 추가가 아닌 별도 이력 |
| [AlertService](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertService.java), [AlertDisplayService](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertDisplayService.java), [AlertTaskProcessor](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertTaskProcessor.java) | 최신 COMPLETED DRIFT·ACTIVE·모드·shown 기반 최소간격/연속 DRIFT. analysisId당 후보/작업1개. shown과 후보 분리; 늦은 표시 ACK는 시각 검증, 첫 표시·첫 선택 멱등/충돌 | 같은 analysis에서 NORMAL→DRIFT는 현행 키로 처리 불가. 늦은 실제 표시 기록과 새 표시 허가를 구분 |
| [main.py](../ai/main.py), [pipeline.py](../ai/pipeline.py), [context.py](../ai/models/context.py) | FastAPI `/api/ai/analyses`, 5방문·position1~5 정렬; 모델/PageVisit은 title/content만 받아 searchQuery 미전달. iter_windows5/stride1은 오프라인 도구, BE API 구성 endpoint 없음. Context는 FOCUSED/JUSTIFIED_DETOUR/DRIFTING | 단순 WINDOW_SIZE=3으로 페이지별 라벨을 만들 수 없음. DTO→모델·프롬프트·출력 경로 새 검증 필요 |
| [embedding.py](../ai/models/embedding.py), [classifier.py](../ai/models/classifier.py), [train.py](../ai/training/train.py), [dataset.py](../ai/training/dataset.py) | Qwen3 title/content cosine [-1,1], 텍스트 SHA LRU; 학습 classifier predict_proba·gamma 판정, artifact가 context/behavior 선택. Context warm-up·학습 JSONL 캐시; 기존5개 라벨 loader/세션 LOSO·nested 평가 | cosine은 확률 아님. 기존 중간 enum/분류기를 페이지 label로 치환 금지, legacy 비교·가중치 보존 |
| main `AnalysisRegistry`/모델 상태 | 최근1000 완료 메모리·진행중 보존. 같은 ID 다른 payload409, 진행중409, 완료 동일응답, 실패 discard. 재시작/eviction 후 기억 소실. 모델 로드 전503 | 영속 멱등은 BE에 있어야 함. 현재 예외 str/traceback은 원문 유출 위험, v2 오류는 일반 메시지만 |

기존 [sequence.test](../fe/tests/sequence.test.ts), [durable-state.test](../fe/tests/durable-state.test.ts), [behavior-delivery.test](../fe/tests/behavior-delivery.test.ts), [session-end-state.test](../fe/tests/session-end-state.test.ts), BE [Window 테스트](../be/src/test/java/com/focusrecovery/domain/window/AnalysisWindowTest.java)·[방문 API](../be/src/test/java/com/focusrecovery/domain/visit/PageVisitApiTest.java)·[분석 복구](../be/src/test/java/com/focusrecovery/domain/analysis/AnalysisRecoveryTest.java)·[알림](../be/src/test/java/com/focusrecovery/domain/alert/AiAlertCandidateTest.java)의 1초/5개/10초 및 ACK 경계를 확인했다. 기대값은 변경하지 않았다. AI에 추적된 자동 테스트 디렉터리는 없다.

## 3. P1 — 방문 식별과 캐시

| 결정 기록 | 내용 |
| --- | --- |
| 현재 구현 | §2 collector/identity: 탭복귀·reload 무조건 유지, SPA는 URL+본문 동시변경만 분리 |
| 목표 정책 | 동일 대상 <4000ms 복귀 유지, >=4000 신규; 새 방문에도 성공 콘텐츠 재사용 가능 |
| 필요한 결정 | 이탈/복귀 시점, 대상 동일성 증거, 같은 URL 본문 변경·hash 라우팅·재시작 처리 |
| 검토 대안 | normalizedUrl만 비교(간단하나 다른 query 문서 병합); URL identity만 비교(same-URL 콘텐츠 놓침); 탭+대상 증거+콘텐츠 세대(권장) |
| 권장안·근거 | 아래 이벤트 표. 방문 합치기와 콘텐츠 캐시는 별도 키/판정. 확신 없으면 병합 보류/신규로 오염 방지 |
| 코드 영향 | collector 탭별 최근 이탈 대상 인덱스, content-change·snapshot generation, 단조시간과 checkpoint 형식 |
| 데이터·개인정보 영향 | 방문 수/체류 분포 변화. raw query/fragment·로컬 identity 해시를 서버/Export에 추가하지 않음 |
| 승인 담당·상태 | FE·데이터·개인정보 담당, **PROPOSED**, 승인 링크 없음 |

`leftAt`은 해당 대상의 활성 탭+활성 Chrome 창 조건이 처음 깨진 **관측 시점**이다. 같은 이탈의 중복 blur/pagehide는 갱신하지 않는다. `returnedAt`은 대상이 다시 활성화된 **이벤트 관측 시점**이며 추출 완료 시점/서버시각이 아니다. 검증이 늦어도 재활성 시각을 따로 보존하고 검증 전까지 병합하지 않는다. 누적 체류에는 둘 사이 공백을 넣지 않는다. 동일 Worker 세대의 monotonic elapsed로 3999/4000을 비교하고 UTC는 감사·방문 시각용으로 저장한다.

| 경우 | 제안 동작 |
| --- | --- |
| 같은 탭 같은 대상 3999ms / 4000ms | 이전 visitId 누적 / 새 visitId·체류0. sequence 이미 발급되었어도 과거번호 유지 |
| A→B→A | A를 탭별 최근 이탈 레코드에서 확인. A <4초 복귀면 유지, B는 별도 후보. B가5초 유효화됐으면 그 기록 취소 금지 |
| 다른 탭 같은 URL | browserTabKey가 달라 독립 visitId. 탭 간 방문 병합 금지 |
| reload | pagehide/새 document 활성 사이 간격+동일 대상·동등 콘텐츠 증거 충족 시만 <4초 재개. 4초 이상 새 방문. 현재 무조건 재사용 변경 |
| SPA URL만 변경, 본문 아직 이전 | 안정된 새 콘텐츠 확인까지 후보 보류; 이전 스냅샷을 새 URL에 연결하지 않음 |
| 검색어/문서 query/실제 게시글 변경 | 새 대상. 동일 normalizedUrl이어도 query identity+검색어+추출 본문 증거로 분리. 검색어만 바뀌고 결과 대기면 전송 보류 |
| same URL 본문 교체·hash router | 허용된 본문 전체의 주요 변화/라우트 전환으로 contentGeneration 새로 발급. fragment는 보호 검사 후 transient 비교만, 저장 금지. 댓글 덧붙임·메뉴 변화는 대상 변경 증거로 보지 않음 |
| 비활성 창·최소화·다른 앱 | leftAt 및 체류 중지. 재활성 때 같은4초 기준. 단순 창 이벤트를 tabSwitch로 더하지 않음 |
| SW 재시작 | monotonic 세대가 달라 4초 증명 불가. 누적 미관측 시간0, 기존 POST/PATCH 유지, 미확정 후보는 recoveryRequired. 재관측은 신규 방문으로 제안; 이전 미결 후보는 기존 명시 복구로 처리 |
| Chrome 재시작·시계 변경 | tabId 재사용으로 병합 금지, 새 browserTabKey/측정 세대. 음수·벽시계 전진을 체류로 사용하지 않음. 검증 불가한 간격은 자동 병합 금지 |

대상 키는 세션+browserTabKey+보호 검사 통과한 transient URL identity+안정된 검색어/문서·contentGeneration이다. URL 해시는 익명화가 아니므로 장기 서버 식별자로 전송하지 않는다. 동일 normalizedUrl만 일치할 때는 동일 대상이라고 주장할 수 없다. 주요 콘텐츠 변화 heuristic은 오탐/누락이 있어 파일럿·프레임/라우트 회귀로 승인해야 한다.

**콘텐츠 캐시:** 세션 내 성공·검증된 대상별 제한 캐시. 재사용 전에 권한·URL·민감 DOM·대상·콘텐츠 세대를 확인한다. 새 visitId에도 동등한 본문이면 재사용 가능; 같은 visitId라도 주요 본문이 달라지면 새 방문이다. 캐시가 없으면 재추출하며 추출 지연은 P2의 유효화 순서에 반영한다. POST 원본을 캐시 갱신으로 변경하지 않는다. 이탈 후4초 판단에 필요한 작은 레코드와 본문 캐시 수명/용량은 분리한다. 권한 철회·민감 판정은 캐시 즉시 폐기한다.

## 4. P2 — sequence와 조기 전송

| 결정 기록 | 내용 |
| --- | --- |
| 현재 구현 | 후보 생성 순서에서 finalized prefix만 발급. 열린 A가 후속 valid B를 막음; valid 자체는1000ms |
| 목표 정책 | >=5000ms·콘텐츠 성공·보호 검사 후 지체 없이 영속 전송 준비, 순서/멱등·복구 유지 |
| 필요한 결정 | sequence의 의미, 추출 지연의 순서 영향, 서버 조기 저장 자료의 회수 |
| 권장안 | **B 유효성 확정 순서**, sequence 발급+POST 동결을 같은 IDB commit. visitedAt은 시작 시각으로 별도 보존 |
| 권장 근거 | 기존 한 건씩 ACK 전송/BE 정렬 키를 유지하면서 열린 후보 차단 제거. 시작순 정렬로 재구성하지 않아 Window 불변 |
| 코드 영향 | assignSequences·readyVisits·durable 형식/검증·전송 정리 전면 경계 수정, BE 저장 watermark 추가 |
| 데이터·개인정보 영향 | 시작시각 순서와 분석순서 차이 명시, 구버전 분리. 조기 유출 위험 때문에 아래 회수 체계가 배포 선결 |
| 승인 담당·상태 | FE·BE·AI·데이터·개인정보 담당, **PROPOSED**. 회수 수단 구현 전 조기 POST 활성화 **BLOCKED** |

| 평가 축 | A 시작 순서 | B 유효화 순서(권장) | C 식별/분석 두 순서 |
| --- | --- | --- | --- |
| 코드 변경 | 후보 순서 보존, 5초 발급하려면 앞 미결 해결/예약번호 필요 | valid시 번호발급, finalized 의존/IDB 검증 변경. 기존 POST/PATCH ID 유지 | candidateOrder+analysisOrder, DTO/DB/조회/Export/커서 모두 추가 |
| 열린 탭 | 앞 후보의 유효/민감 여부 기다리면 후속 지연. 예약번호로 먼저 보내면 늦은 작은번호 삽입 위험 | 열린 후보가 후속 발급 막지 않음 | 분석순서를 유효화로 하면 해결, 시작순서면 A 문제 지속 |
| 동시 이벤트·추출 지연 | serial 후보 시작순, 느린 A가 B 막음 | Background 직렬 처리/IDB revision 순으로 결정. A 느리면 B1/A2 가능 | 두 순서 관계·동률·영속 CAS 추가 |
| 순서 의미 | 사용자 대상 최초 관측순, 제외될 후보 포함 잠정순서 | **분석 가능한 방문으로 확정된 순서**, 방문 시작 chronology 아님 | 방문 chronology와 분석 준비 chronology 둘 다 제공 |
| BE 제약 | 첫 Window 이후 작은 신규번호 거절과 충돌 가능 | 단조 POST+ACK, 세션 수신 high watermark로 역순 거절 | 새 UNIQUE·기존 sequence 해석/마이그레이션 필요 |
| Window 일관성 | 늦은 후보를 끼우면 기존 구간 재구성 필요 | 확정 순서 size3/stride1, 생성된 멤버 불변 | 분석순서 고정하면 B와 같고 두 순서 혼용시 오류 |
| 중복·복구 | 예약/취소·누락 후처리 추가 | 동일 ID/원본·동결 sequence/ACK 복구 유지 | 두 high watermark와 복구 비교 추가 |
| 기존 데이터 | 기존 FE 의미에 가깝지만 번호 예약은 현재와 다름 | collectionSpecVersion=2.0인 신규 세션만. v1 재해석 금지 | v1에 없는 필드 null/별도 legacy 경로 |
| 라벨링 | 시작 흐름 해석 쉬움, 대기 편향 | 평가자에게 sequence가 분석순임을 고지, visitedAt도 제공. 추출지연 편향 보고 | 라벨 가이드에서 어떤 순서가 판단 대상인지 고정해야 함 |

B의 구체 계약: 후보 시작만으로 번호를 소비하지 않는다. 측정>=5000 **그리고** 추출 성공·보호 조건 충족 시 직렬 전이에서 번호1부터 증가. 동일 시각은 이벤트 처리순, 네트워크 도착순 아님. 게시 후 같은 방문 재개는 번호 불변, 새로운 콘텐츠는 새 방문. 이미 번호를 발급한 자료의 제외/철회·권한 재개가 만든 공백은 재사용하지 않는다. 5초 이전 콘텐츠 실패는 sequence 없는 진단이다. 5초에 추출이 끝나지 않았으면 `eligibleMeasuredAt`과 실제 commit 시점은 다르며 전송을 보류한다. 추출 성공이5000ms에서 더 늦어도 과거에 전송한 것으로 기록하지 않는다.

BE v2 신규 방문 저장은 세션 쓰기잠금 안에서 `sequence > lastAcceptedSequence`를 요구한다(공백 허용). 동일 visit 원본 replay를 먼저 처리하고, 기존 번호 다른 ID 충돌을 다음으로 처리한다. 첫 Window 이전에도 역순 신규 삽입은 거절한다. 현행은 첫 Window 전 역순 허용하므로 **동작 변경**이다. FE는 ACK 영속 후 다음 POST라 정상 큐는 이 조건을 만족한다. AI `afterSequence`와 별개인 수신 watermark가 구성 요청 중 늦은 삽입을 막는다. 여러 독립 FE writer가 같은 세션을 쓰는 것은 지원하지 않으며 다른 장치에 임의 재번호하지 않는다.

### 4.1 전송 후 민감 판정: 이미 보낸 자료의 처리

| 대안 | 장점 | 문제 |
| --- | --- | --- |
| 이후 수집만 제외 | 가장 작음 | 서버 원문/AI input/캐시·Export에 잔존, 해결안으로 부적합 |
| 기존 POST 정정 | 같은 ID 유지 | 불변 원본 멱등과 충돌; 이전 분석·과거 Export는 따로 회수해야 함 |
| 물리 삭제만 | 원문 제거 | V3/V4/V6/V7/V9 FK로 단순 visit DELETE 불가. 파생 자료/진행중 응답이 다시 저장할 수 있음 |
| **즉시 격리·파생 무효화→검증된 삭제** | 회수 범위·재시도·응답 race를 다룸 | 새 API·작업·tombstone·캐시 삭제·운영 절차 필요, 권장 |

제안 `POST /api/sessions/{sessionId}/visit-retractions` ([PrivacyRetraction](contracts/v2/README.md)). 기존 POST/PATCH와 별도이며 ENDED에서도 본인 세션 회수는 허용한다. 인증/소유권 체계가 현행에 충분하지 않으므로 서비스 인증·참여자 연결·관리자 접근·동의 철회 절차 승인 전 외부 노출 금지. 임의 UUID만으로 다른 참여자 데이터 삭제 권한을 주지 않는다.

1. FE는 민감 관측 직후 수집/캐시/해당 전송 중지, 원문을 복제하지 않는 retractionId·visitId·reason·observedAt을 영속화. ACK 유실 POST도 이미 저장됐을 수 있으므로 회수 대상이다. ACTIVE 권한 철회의 기존 로컬 원문 삭제와 병행하여 **식별자만 있는 회수 작업**은 별도 보존한다. END_PENDING의 데이터 원본을 임의 삭제하지 않고 회수/종료 충돌을 UI에 드러낸다.
2. BE는 세션→방문/Window 순 잠금으로 tombstone을 먼저 기록한다. 미존재 visitId 회수도 tombstone(향후 같은 ID POST 차단), 동일 retractionId payload 재전송은200, 다르면409 RETRACTION_ID_CONFLICT. 최초 격리202/QUARANTINED, 삭제 완료200/PURGED. 발급 번호/수신·구성 high watermark는 되감지 않는다.
3. 해당 방문과 포함 Window/analysis/state/candidate를 INVALIDATED, 조회 finalState=null/errorCode=PRIVACY_RETRACTED·알림 차단. 진행중 구성 응답은 입력 revision/CAS 및 tombstone 재확인하여 폐기; 진행중 분석은 소유권·유효성 검증 후 민감 결과를 저장하지 않는다. 이후 새 Window가 철회 방문을 포함해도 구성 거절/격리한다.
4. 원문(title/content/query/URL) 및 모든 복제(input_snapshot/feature/context/rationale/response snapshot/학습 캐시/로컬 IDB·메모리·임베딩/Context 캐시/오류 로그)를 회수 작업으로 삭제한다. 캐시 방문 역색인이 없으면 관련 프로세스 캐시 전체 무효화/재시작 등 증명 가능한 삭제가 필요. SHA256 키만 지우고 값은 남기지 않는다. v1 추론 예외에 원문이 섞였는지도 점검한다.
5. FK 때문에 기존 테이블에서 단일 DELETE 불가. 후속 migration에서 payload 분리/nullable 전환 또는 자식 task→response/notification→state/analysis→window_visit/window→visit 순 종속 삭제와 최소 tombstone 설계를 검토한다. 원문 없는 식별·무효화·삭제상태 감사만 제한 보존; append-only 상태 이력도 개인정보 삭제 예외가 우선한다.
6. 삭제 후 남은 방문을 이어 붙여 과거 Window를 자동 재생성하지 않는다. 세션 분석을 격리하고 새 세션/명시적 재구성은 별도 승인. 일반 EXTRACTION_FAILED 제외와 민감 회수의 연속성 영향은 다르다. 운영 과거 알림을 취소한 사실로 실제 shown/선택을 지어내지 않으며 연결된 로그도 삭제 범위 검토.
7. 모든 배포 Export manifest 버전을 철회/비공개, 다운로드 수신자 회수·로컬 사본 삭제 확인. 차기 datasetVersion은 제거/제외 원인·수량만 기록. 학습에 사용됐다면 학습을 중지하고 artifact 배포 차단, 영향 데이터 없이 재학습/기존 artifact 폐기 여부를 담당자 승인. 이미 학습된 영향을 단순 row 삭제로 제거했다고 주장하지 않는다. 백업은 재복원 시 tombstone 재적용 및 승인된 폐기 절차 필요.

보존기간/백업 만료/삭제 완료 SLA는 임의 숫자를 정하지 않는다. 삭제 실패는 QUARANTINED를 유지하고 정상 분석/배포를 재개하지 않는다. 진단/공개 Fixture에는 합성 데이터만 사용한다.

## 5. P3 — 활성 체류 갱신과 장기 저장

| 결정 기록 | 내용 |
| --- | --- |
| 현재 구현 | 이벤트 settle마다 누적 증가/버전 증가, PATCH ACK/동결 재시도 존재. 5분 임계 이벤트 없음. BE applied는 버전 기준 |
| 목표 정책 | 활성 탭+활성 Chrome 창 누적>=5000 유효, 최초300000 통과와 이후 이탈/전환/종료 최종값 |
| 필요한 결정·대안 | 새 threshold endpoint(불필요한 중복), 기존 PATCH+FE 트리거+BE 누적 비교(권장), 주기 전송(저장/트래픽 증가) |
| 권장안·근거 | PATCH body 그대로. FE durable crossing marker, BE 적용 전후 old<300000<=new; 지연에도 누적값으로 복구 |
| 코드 영향 | active-time monotonic 세대·threshold pending 상태, behavior-delivery/IDB compaction; BE 변경 적용 이벤트→판단 작업 |
| 데이터·개인정보 영향 | 측정/수신/판단 시각 구분, 관측불가 구간 미가산, ACK된 원문의 불필요한 장기 보관 축소 |
| 승인 담당·상태 | FE·BE·데이터 담당, **PROPOSED**, 승인 링크 없음 |

- `behaviorVersion`은 동일 방문의 누적 duration 또는 tabSwitchCount가 바뀐 committed snapshot에만 증가. 타이머 재기동·재전송·ACK 수신만으로 증가 금지. 여러 측정 이벤트를 한 snapshot으로 합치는 것은 가능하나 동일 버전 다른 값을 보내면 안 된다. FE가 보낸 버전과 서버 적용버전은 ACK 전까지 다를 수 있다.
- 최초300000 이벤트는 timer/foreground/leave/end 어느 경로에서도 검출 가능. timer가 늦게301234에 깨어나면301234를 큐에 보낸다. 휴면/최소화·미관측 Worker 시간은 추정 가산하지 않는다. `thresholdQueued`와 retry payload를 같은 IDB commit에 보존; ACK까지 marker를 소비 완료로 처리하지 않는다.
- BE는 잠금 안의 적용 전 `old`와 요청 `new`로 비교한다. 299999→300000은 crossing, 300000→300000은 아님. 낮은 버전은 applied=false/현재값, 같은버전 같은값 false, 다른값409, 높은버전 누적감소409. 높은버전 같은값은 현행 true일 수 있지만 실제 입력 fingerprint 중복 방지. `applied=true`가 곧5분 통과는 아니다.
- POST가 처음부터300000 이상이면 첫 저장의 duration을 판단 입력으로 쓰며 별도 PATCH crossing을 기다리지 않는다. POST ACK 전에 PATCH 금지. ACK 유실은 동결 재시도, ACK가 더 최신이면 단조 병합하되 상충은 수동 복구. 재시작 뒤 동일 임계 이벤트를 중복 가산하지 않는다.
- 서버 received/applied `updatedAt`, FE의 측정 관측시점, BE `judgedAt`은 다르다. PATCH body에는 새 타임스탬프를 추가하지 않는다. 최초 threshold의 정확한 발생시각·즉시 알림을 ACK나 judgedAt에서 역산하지 않는다. 지연 통계는 별도 비민감 관측 메타로 측정한다.
- 변경된 모든 유효 행동 snapshot은 P5 입력 변경 이력 대상. 5분 최초 통과는 상태가 바뀔 가능성이 큰 트리거이며 이후 이탈 값도 같은 Window 재판단 대상이다. AI 미완료 중 변경은 최신값으로 병합하고 존재하지 않았던 중간 판단 이력을 합성하지 않는다.

**저장소 정리 제안:** 200개에서 영구 중지 대신 ACK 완료+finalized+짧은 복귀 대상 아님+pending behavior 없음인 자료만 compaction. 본문 POST 원본은 replay가 필요한 동안 보존하고 완료 뒤 최소 영수증(visitId/sequence/original hash·서버 ACK 버전)을 보존한다. 종료 drain은 배열 길이가 아닌 영수증+미확인 큐로 검증하도록 새 checkpoint 설계 필요. sequence 상한·POST/PATCH retry·END 영수증·오류·recoveryRequired는 quota 이유로 삭제 금지. 구 format1→새 format은 성공 commit·영수증 확인 전 원본 삭제 금지, 진행 중 v1 세션은 v1로 종료. 캐시 LRU와 큐 저장소는 분리; quota 접근/commit 실패 시 backpressure·수집 안전중지와 명시 복구 안내, 아직 전송하지 않은 방문을 성공으로 처리하지 않는다. 용량·캐시 크기는 파일럿 측정 후 승인하며 무근거 숫자를 운영 한도로 정하지 않는다.

## 6. P4 — AI 구성과 BE 저장

| 결정 기록 | 내용 |
| --- | --- |
| 현재 구현 | BE size5 구성→Window FK 확보→analysis_result 저장→commit 후 AI 분석, 별도 구성 API 없음 |
| 목표 정책 | size3/stride1 구성 책임AI, windowId/index·영속 저장BE, 최종상태BE |
| 필요한 결정 | 구성/분석 두 HTTP 단계, 커서/작업 저장, 재시도·동시성·부분입력 의미 |
| 권장안·근거 | **A 구성→저장→기존 분석API(v2)**. NOT NULL FK와 기존 claim/recovery/조회/알림 흐름 활용 |
| 코드 영향 | compose job/cursor·수신 watermark 신규, window service 역할 변경; AI deterministic compose endpoint·v2 pageResults |
| 데이터·개인정보 영향 | 구성에는 visitId/sequence만 전달(본문 없음), 분석은 최소 의미 입력만. 동결 요청 개인정보 회수 범위 포함 |
| 승인 담당·상태 | BE·AI·데이터 담당, **PROPOSED**, 승인 링크 없음 |

| 비교 | A 두 단계(권장) | B 단일 구성+분석 | C 기존 BE 구성 |
| --- | --- | --- | --- |
| 책임 정책 | AI 멤버 선택, BE 검증/ID/저장 | AI가 멤버·분석, BE가 결과 수신 후 ID 매핑 필요 | **최신 AI 구성 책임 정책과 충돌** |
| FK | 구성 job은 Window FK 없이 새 저장소, 분석은 Window 저장 후 V4 FK 충족 | Window 없는 요청을 V4에 먼저 넣을 수 없음. 별도 stream/attempt job과 응답멤버→Window→result 매핑 필요 | 현행 V3/V4 활용 |
| HTTP·지연 | 구성1회+생성 Window별 분석1회. 모델 없는 구성 비용도 실측 필요 | batch1회 가능, batch 전체/부분 실패·ID 매핑 비용 | 구성왕복 없음·분석만; 책임변경 요건 불충족 |
| 중복 방지 | compose ID/hash+cursor CAS, V3 UNIQUE, V4 window UNIQUE | stream hash/부분 성공별 영속 result·중복 매핑 새 설계 | 현행 세션잠금/UNIQUE 활용 |
| 장애 복구 | 구성 replay 독립, 분석 기존 claim/timeout. commit 후 중단 복구 가능 | 모델 수행 후 BE 저장 실패 시 전체/부분 분석 재실행 위험, 결과 outbox/저장 필요 | 가장 작지만 정책 승인을 뒤집어야 선택 가능 |
| 변경 범위 | 신규 job+cursor, v2 DTO, size3검증·state 이력 | 분석·조회·알림·복구까지 대규모 attempt 모델 변경 | size변경만으로는 #81 충족 못함 |

### 6.1 구성 커서와 배치 계약

실제 JSON 타입은 [Schema/필드 사전](contracts/v2/README.md) 단일 기준이다. endpoint 제안 `POST /api/ai/window-compositions`, apiContractVersion=2.

- `composeRequestId`: BE UUID v4, 영속 job의 동일 요청 키. inputFingerprint는 fingerprint 필드만 제외한 요청 canonical JSON의 SHA256. afterSequence는 **마지막으로 구성에 반영 완료한 유효 방문 sequence**(최초0)이지 마지막 Window 끝/개수가 아니다.
- BE는 커서 이하 마지막 최대2개 유효 방문(context)과 커서 이후 신규 prefix를 sequence 오름차순으로 전달. 요청1~256개(문맥2+신규최대254, 최초 요청은 최대256)는 **제안 wire batch 상한**이며 수집 총량 제한이 아니다. 초과 backlog는 다음 배치로 진행한다. 256 선택은 BE·AI 자원 검토 승인 대상, 필요시 Schema와 함께 변경.
- 커서>0이면 저장한 최근 최대2개 tail과 정확히 일치해야 하며 AI는 요청 밖 누락을 알 수 없으므로 BE가 검증한다. cursor0이면 문맥 없음. 신규 최소1개 필수; 신규 없는 호출은 INVALID_REQUEST422. 숫자 공백1,3,4는 허용, 저장된 방문 자체를 누락한1,4는 허용하지 않음. 세션 revision+동결 입력 ID 목록으로 누락/철회를 검증한다.
- AI는 전달받은 ordered list의 인접3개를 stride1로 구성하고 끝 sequence>afterSequence인 것만 반환. Window에는 visitIds[3]/endVisitId, windowId/index는 없음. 1~2개 입력이면 windows=[], cursor는 마지막 입력번호로 전진(예:0→2), 다음 요청 tail2+신규3에서 W1 생성.
- `composedThroughSequence`는 요청의 마지막 **신규** sequence, 단순 after+건수 아님. 1,3,4,6이면 [1,3,4]/[3,4,6], cursor6. 부분 성공 응답 허용 안 함: 전부 검증·저장하거나 rollback·커서 유지. 실패한 window를 건너뛰고 커서를 전진시키지 않는다.
- AI는 모델 없이 순수 구성 가능하도록 권장. 메모리 registry 없어도 재시작 뒤 같은 요청으로 같은 멤버 계산 가능. ID 재사용 conflict의 영속 진실은 BE job이다. AI에는 best-effort registry, 영속 보장이라고 주장하지 않음. 구성 준비상태는 분석 모델 로드와 분리; 구성서비스 자체 불가503, 분석 모델 불가503은 별개.

### 6.2 트랜잭션·재시도·ID

1. 방문 저장 tx에서 lastAcceptedSequence 갱신+구성 필요 outbox marker commit. 세션당 한 구성 job을 활성화한다. tx에서 after·tail·신규 prefix·상한·revision을 읽어 ID/hash/input_snapshot 저장한 뒤 잠금을 해제한다.
2. job PENDING/RUNNING claim 후 **DB transaction 밖** AI HTTP. timeout/AI_NOT_READY/COMPOSE_IN_PROGRESS/5xx는 동결 ID/body로 재시도, 409 ID_CONFLICT·422는 재시도하지 않고 진단. 재시도 횟수/lease/timeout은 성능 측정 승인 전 설정필수(BLOCKED 배포조건), 무한 hot loop 금지. 현재 BE AnalysisRecovery가 이를 자동 수행한다고 가정하지 않음.
3. 응답의 IDs/hash/after/through, 같은 세션 visit 소속·유효/비철회, 중복/순서·정확히3개·stride1·누락 없는 전체구성을 검증. 잘못된 순서/멤버/누락은 AI_INVALID_RESPONSE, job 실패·cursor 그대로. AI 입력 역순/중복은422 INVALID_REQUEST. 커서/멤버 revision이 바뀌면 COMPOSE_CURSOR_CONFLICT/COMPOSE_INPUT_MISMATCH로 해당 응답 폐기 후 새 job snapshot.
4. 짧은 세션 쓰기잠금 tx에서 stored cursor==after CAS, V3 UNIQUE를 확인, end 오름차순 windowId v4·windowIndex1부터 발급. replay면 기존 ID/index 재사용. V3 FK에 원천 방문이 이미 존재해야 함. Window·window_visit·analysis_result PENDING/input snapshot·분석 outbox·cursor/tail·compose 완료를 **같은 tx** commit. rollback이면 어느 것도 적용하지 않음.
5. 네트워크 응답 유실/BE 저장 직후 재시작은 job receipt/UNIQUE로 같은 Window·분석 반환. 새로운 방문이 HTTP 중 저장돼도 수신 watermark는 앞서고 compose cursor는 고정 prefix까지만 전진, 다음 job이 처리. 종료 후에도 종료 전 저장된 backlog만 구성/분석 가능, 알림 금지.
6. 기존 `/api/ai/analyses`의 apiContractVersion=2 경로는 세 방문·ID/index·goalText·fingerprint·title/content/searchQuery/검색여부/visitedAt 입력. v2에는 행동·참여자/시나리오/정답 없음. pageResults는 순서1~3/visitId 정확한 1:1, DIRECT/JUSTIFIED_DETOUR/UNRELATED, finite cosine[-1,1], 원문 복제 없는 rationale, modelVersions·analyzedAt. 최종 state/확률은 v2 응답에 없음. 기존 v1은 기존대로 유지하고 없는 버전은v1, 지원하지 않는 버전은422.
7. 분석 중복은 BE 동일 analysisId/hash로 제어. 현재의 BE 자동 분석 재시도 없음 유지, stale은 FAILED 확정·늦은 응답 버림. AI registry cache miss/재시작 뒤 재추론될 수 있지만 BE는 RUNNING의 원래 ID/window/hash에 첫 유효 결과만 저장. 재분석이 필요하면 V4 UNIQUE(window_id)와 충돌하므로 별도 attempt 설계 승인 전 추가 result row 생성 금지.

## 7. P5 — BE 판단 이력·알림

| 결정 기록 | 내용 |
| --- | --- |
| 현재 구현 | AI result가 최종상태, Window당 분석1개, 행동 갱신 후 완료 Window 재판단 없음; 알림키 analysisId |
| 목표 정책 | 여섯 상태 규칙을 BE 판단, windowId+stateVersion, 행동 변경 재판단·최신성·알림 분리 |
| 필요한 결정 | suffix 범위/오류/이력 기준·재판단 범위·같은 Window 알림 리셋 |
| 권장안·근거 | 아래 우선순위, **실제 판단에 사용된 입력이 바뀔 때마다** append-only 이력, 포함하는 모든 기존 Window(최대3개) 재판단 |
| 코드 영향 | 판단 서비스·작업/outbox·state history, 조회 fresh/status, notification/task 키와 FK 변경 |
| 데이터·개인정보 영향 | 같은 상태 버전도 늘어 저장비용. snapshot만으로 재현, 원문 중복 최소화. 회수 시 이력 무효화/삭제 예외 |
| 승인 담당·상태 | BE·FE·AI·데이터 담당, **PROPOSED**, 승인 링크 없음 |

평가 순서(규칙 ID `suffix3-v2-proposed.1`):

1. AI 실패/불완전 page 결과·누락 입력·철회는 판단 보류/실패/INVALIDATED, finalState=null. 실패를 NORMAL이나 무관으로 만들지 않는다.
2. 최신(세 번째) 페이지 DIRECT/JUSTIFIED_DETOUR이면 NORMAL. 이전에 오래 머문 무관 페이지가 있어도 최신 관련 페이지 우선.
3. 최신부터 거꾸로 **이 Window 내부의 최대3개**에서 연속 UNRELATED suffix를 센다. DIRECT/우회에서 끊음. 인접 Window의 모든 과거 무관 수를 합치지 않는다.
4. suffix3이면 DRIFT. suffix1~2 중 하나라도>=300000이면 DRIFT. suffix2 모두<300000이면 TRANSITION. suffix1<300000이면 NORMAL.

일반 추출 실패는 유효 방문 목록에서 빠지고 무관 suffix 리셋 이벤트가 아니다. 그 때문에 알려진 전체 사용자 history와 유효방문 history가 다름을 Export exclusions에 기록한다. 개인정보 철회는 §4.1처럼 세션 분석을 격리하므로 실패 방문처럼 조용히 건너뛰지 않는다.

| 이력 대안 | 장점 | 비용/제약 |
| --- | --- | --- |
| 상태 전환만 저장 | 저장량 작음 | 같은 상태에서 어떤 행동입력을 읽었는지 재현 안 됨. 별도 행동 event log 필요 |
| **판단 입력 변경마다 저장** | 같은 Window의 판단 시점·규칙/행동 차이 재현, 중복 구분 | 3개 snapshot×버전 누적; 값 변동마다 무조건 실시간 HTTP/판단을 요구하는 것은 아님 |

`WindowState` 필수: windowId, stateVersion(1부터 safe int), analysisId, ruleVersion, judgedAt(실제 BE 판단 UTC), finalState, ordered behaviorSnapshot 3개(visitId,duration,switch,version), inputFingerprint. fingerprint는 고정 analysisId+ruleVersion+ordered 행동 snapshot의 canonical SHA256. 분석 row는 immutable 성공 결과를 가리키므로 analysisId가 의미결과를 고정한다. 동일 fingerprint는 기존 버전 반환; 높은 버전 같은 누적값도 behaviorVersion이 달라지면 새 입력이다. 같은 버전 다른 값은 PATCH에서 먼저 거절.

BE는 세션→Window(index순) 잠금에서 최신 행동을 일관되게 읽고 새 버전을 발급, UNIQUE(window,inputFingerprint)로 병렬 중복 방지. 행동 update tx에서 포함 Window의 dirty/outbox를 원자 기록한다. 처리 지연 중 변경을 최신값으로 합칠 수 있지만 **판단이 실제 실행되지 않은 중간 버전은 만들지 않는다.** AI 미완료면 대기 후 그 시점 최신값으로 첫 판단. 기존 Window 멤버·AI 예측은 재구성/재호출하지 않는다. size3/stride1에서 방문 하나는 최대3개 기존 Window에 속하므로 재판단 범위는 전 세션이 아니다.

조회는 최신 **구성된** windowIndex 기준. 최신 Window pending/failed면 현재 state=null/status 유지하고 과거 성공은 lastSuccessfulState로만 참고 반환. 행동 dirty가 있어도 currentDecision=PENDING/finalState=null, 이전 성공은 참고로 제공하여 stale DRIFT 알림을 차단한다. 이전 Window의 늦은 완료/재판단은 그 이력만 추가하고 현재 포인터/알림을 되돌리지 않는다. 종료 후 원래 claim이 살아 있는 분석은 결과/평가 이력 저장 가능, FAILED 확정 뒤 응답은 폐기.

### 7.1 알림 후보와 실제 표시

- 후보/작업 key는 `(windowId,stateVersion)`, AI analysisId는 근거 FK로 유지. **현재 V6 UNIQUE(analysis_id), V7 PK(analysis_id)는 이 구조를 수용하지 못한다.** 후속 migration 없이 가능하다고 표현하지 않는다.
- 생성·조회·표시 직전의 허가에서 최신 windowIndex+stateVersion·COMPLETED DRIFT·ACTIVE·AI 모드·비철회·기존 최소간격/연속 DRIFT를 검사. DB 키뿐 아니라 FE에서도 alertId 표시 영수증으로 중복 UI 억제. dirty/PENDING이면 후보 반환 금지.
- 같은 DRIFT 입력 갱신 v2→v3는 새로운 표시 사유 아님. 후보 미표시 상태에서 버전이 올라가면 이전 후보를 superseded하고 최신 후보1개만 노출. 실제 shown 이력은 재작성하지 않음.
- 기존 연속 DRIFT는 마지막 실제 표시 이후 **그보다 뒤 Window**의 COMPLETED NORMAL/TRANSITION이 있어야 해제된다. 권장은 이 보수적 기준 유지: 같은 Window의 새 NORMAL 버전만으로 재알림 허용하지 않음. 대안은 `(windowIndex,stateVersion)` 순으로 같은 Window 내 복귀도 허용(반복 알림 위험·설명 증가). #79의 '리셋 포함 검토'는 확정이 아니며 이번 권장안은 기존 보호 유지다.
- 기존 최소간격 설정값은 그대로 사용, 이번 임의 분 단위 변경 없음. 기준은 실제 shownAt의 최대값; 후보 createdAt·응답도착시각 아님. 실패/미완료/무효화는 정상복귀로 보지 않음. 고정주기 모드와 동시 새 알림은 기존 단일모드로 방지.
- FE는 종료 선택부터 표시 금지, 서버 ENDED에서도 후보 없음. 표시 직전 재조회 후 네트워크 race로 완전한 최신성 보장은 불가능하므로 조회/표시 snapshot 키를 기록한다. 서버 표시 승인 토큰/lease를 추가하는 대안은 후속 UX/BE 설계 대상이지 현재 API의 기능이 아니다.
- **이미 실제 표시된 늦은 shown ACK**는 새로운 표시 허가가 아니다. 현재 최신이 아니어도 기존처럼 생성/종료/허용오차와 실제 shownAt을 검증해 기록, 늦은 ACK를 이유로 새 UI 표시 금지. 선택이 shown보다 먼저 수신되면 두 기록 원자 처리, 최초선택 멱등/상충409 유지. 종료 후 신규 표시 금지와 종료 전 실제 표시의 늦은 기록을 혼동하지 않는다.

## 8. P6 — 라벨·Export·개인정보

| 결정 기록 | 내용 |
| --- | --- |
| 현재 구현 | 연구 loader는 기존5개 Window 후보 label/UNREVIEWED, 기존 합성 세션·LOSO 평가. 운영 v2 사람라벨/이력/동의 저장소 없음 |
| 목표 정책 | 20목표·10명·160 scripted/시나리오40씩·최소10방문/세션·>=1200 Window·자연20~40세션·평가자3·목표12/4/4 |
| 필요한 결정 | 정적 Window 기준시점, 세 종류 라벨의 문맥, 독립/합의·κ 분모, split/manifest·동의/삭제 |
| 검토 대안 | Export 최신 snapshot(늦은 행동으로 정답 이동) / 최초 실제 판단snapshot(운영 지연 반영) / 세 번째 방문5초 가상snapshot(실제 기록 없으면 합성) |
| 권장안·근거 | **최초 성공 BE stateVersion의 실제 행동 snapshot**을 정적 referenceStateVersion으로 고정; 지연 편향은 명시. 과거5초 이력 합성 금지 |
| 코드 영향 | 별도 label/assignment/consent/export 도구, v2 loader/split 검증. 제품 학습변경은 이번 제외 |
| 데이터·개인정보 영향 | 예측과 정답 분리, 최소 가명·접근통제·회수manifest. 보존기간은 아래 미확정 |
| 승인 담당·상태 | 데이터·평가자·FE/BE/AI 및 학교/기관 개인정보 책임자, **PROPOSED**. 보존/동의 절차 **BLOCKED**(승인 근거 없음) |

수집 숫자는 상위 요구 유지: 4시나리오 각40세션=160, 인당 서로 다른16목표/각시나리오4, 최소10 유효방문이면 구조상1280 Window. 실패/UNJUDGEABLE 제외 후1200 충족 여부를 따로 검수한다. 부족분은 재라벨로 채우지 않고 추가 수집 계획을 승인받는다. 자연20~40세션은 본 수집 수량과 분리. 프로젝트 원계획의 사용자평가12명과 수집참여자10명은 다른 모집단이며 임의로 하나로 바꾸지 않는다.

- **Page Visit 정답:** DIRECT/JUSTIFIED_DETOUR/UNRELATED/UNJUDGEABLE. 최초 목표+해당 페이지+그 시점까지의 선행 유효 탐색 문맥으로 독립 평가하고 미래 방문은 숨긴다. 체류만으로 관련/무관을 결정하지 않는다. 같은 visit의 AI 예측은 Window마다 다를 수 있어 `(analysisId,visitId)`로 별도 평가; 인간 정답을 그 예측에서 복사하지 않는다. Window 맥락별 사람 라벨 실험이 필요하면 별도 guide/version 단위로 분리, visit 전역 정답을 덮지 않는다.
- **Window 정답:** referenceStateVersion의 세 페이지와 그 행동 snapshot으로 NORMAL/TRANSITION/DRIFT/UNJUDGEABLE을 세 평가자가 직접 독립 판정한다. BE finalState·AI pageResults는 숨긴다. 사람 Page 합의라벨에서 규칙으로 계산한 값은 `derivedRuleState` 비교자료이며 독립 Window 정답을 대체하지 않는다.
- **Window State 정답:** 모든 실제 `(windowId,stateVersion)`에서 당시 snapshot을 보고 같은 네 enum으로 독립 판단. 정적 Window와 같은 snapshot이면 동일 라벨링 관측을 재사용할 수 있으나 κ/정확도 집계에서 양쪽 표본을 합쳐 중복 가중하지 않는다. 이력이 없거나 원문이 회수된 Window는 기준시점 불가로 제외/UNJUDGEABLE 사유를 기록한다.
- UNJUDGEABLE은 근거 부족·불완전 콘텐츠·판단 불가 사유와 함께 남긴다. 추출 실패/AI 실패는 처리상태이며 사람 라벨과 다르다. 부족표본을 NORMAL로 채우지 않는다.
- 3인 독립 투표는 수정 불가 원본에 evaluatorPseudonym/guideVersion/snapshotRef/submittedAt 기록. 조정 전 독립값으로 신뢰도 계산, 이후 2명 이상 일치한 합의 후보를 검토하고 완전불일치는 토론·합의근거 별도 기록. 최초 투표를 합의값으로 덮어쓰지 않는다. 세 명 모두 다른데 다수결이라고 주장하지 않는다.
- Fleiss' κ는 Page/정적Window/상태이력 **각각** 완전한3인 평가 항목을 단위로 계산. 네 범주(UNJUDGEABLE 포함)의 κ와 분포, 3명 모두 판단가능한 항목만 남긴 세 범주 κ·제외수/비율을 함께 보고. 항목별 평가자 수를 바꾸거나 단일 UNJUDGEABLE 표만 삭제 금지. `P_i=(Σ_j n_ij²−3)/6`, `p_j=Σ_i n_ij/(3N)`, `κ=(mean(P_i)−Σp_j²)/(1−Σp_j²)`. N=0 또는 분모0은 undefined/사유로 보고하고0이나1로 대체하지 않음. 합의 라벨의 κ 계산 금지.
- 목표 ID20개를 train12/validation4/test4로 먼저 freeze. 같은 목표의 모든 참여자/세션/겹치는 Window/상태버전·자연세션은 같은 split, 교집합0 검증. 네 작업영역을 각 split에 포함. 자연세션에 새 목표가 생기면 기존 test 학습에 편입하지 않고 별도 holdout/분할 변경 승인. 사람 여러 명이 split에 겹칠 수 있으므로 이 평가를 '새 참여자 일반화'로 과장하지 않음.
- 라벨 UI/배포 파일은 ai_predictions/result/finalState/rationale·시나리오 배정·자동 후보라벨을 숨긴다. ruleVersion/stateVersion은 snapshot 식별용으로 제공하되 finalState는 분리. Test는 모델·프롬프트·threshold·BE 규칙 튜닝에 사용하지 않는다. 합의/라벨 가이드 변경도 datasetVersion 및 guideVersion을 갱신한다.

**Export manifest 제안**([Manifest](contracts/v2/README.md)): datasetVersion, collectionSpecVersion, apiContractVersion, ruleVersion, labelGuideVersion, exportedAt, sourceCommit, referencePolicy=`FIRST_SUCCESSFUL_STATE`, splitByGoal(train12/validation4/test4), files(path/sha256/rowCount), counts/exclusions(실패·무효화·UNJUDGEABLE/라벨미완료·지연기준), consentPolicyVersion, deletionRevision을 기록한다. UTF-8 JSONL sessions/visits/windows/window_states/ai_predictions/human_labels/collection_failures를 분리, windows에 referenceStateVersion과 immutable snapshot hash. 사람이 보는 blind export에는 predictions와 시나리오가 없다. manifest→파일 checksum→row count→FK→split 교집합→유효 동의/회수 revision 검증 후 배포. 원본 filename/경로에 실명 금지, checksum은 익명화가 아니다. 승인 전 manifest consentPolicyVersion을 가짜 문자열로 채워 실데이터 Export하지 않는다.

참여자는 무작위 participantId 가명, 실명·연락처·동의 연결표는 별도 접근제한 관리소에 보관하고 모델/Git/일반 Export에 넣지 않는다. goal/query/body 자체도 식별 가능한 내용일 수 있어 가명 ID만으로 익명자료라고 부르지 않는다. 동의 목적·수집항목·제공범위·철회 경로·보존/백업/파생모델 처리·관리 담당자 및 기관/학교 규정 적용 여부를 확인해야 한다. **보존기간·삭제 완료 기한·동의 양식·연구심의 적용 판단은 BLOCKED**, 학교/기관 책임자 검토 근거가 없으므로 특정 일수/개월을 확정하지 않는다. 실데이터 본수집·외부 Export의 선결이며 합성 Schema/Fixture 검증은 가능하다. 철회는 세션/방문·라벨·예측·snapshot·캐시·로그·Export·백업/모델 영향 목록을 따라 §4.1 회수, 삭제 완료 전 분석/공유 격리. 철회 완료 감사에는 원문을 남기지 않는다.

## 9. API·DB 변경 영향과 호환

Schema는 [v2.schema.json](contracts/v2/v2.schema.json)의 명명된 `$defs`로 검증한다. `2.0-proposed.1` 문서 패키지 버전이며 wire collectionSpecVersion=`2.0`/apiContractVersion=2는 **승인 후 신규 세션에만 활성화할 후보값**이다. 미승인 규칙 ID는 suffix3-v2-proposed.1. 버전 선택은 session metadata로 고정하고 Page POST마다 body version을 중복 추가하지 않는다. 새 세션의 version negotiation 구현 전 기존 session API가 이를 지원한다고 가정하지 않는다.

| 기존 DB 근거 | 필요한 후속 변경(미적용) |
| --- | --- |
| [V1](../be/src/main/resources/db/migration/V1__create_work_session.sql) idempotency UNIQUE·ACTIVE/ENDED | collection_spec_version, last_accepted_sequence, composed_through_sequence/tail·revision, compose dirty/outbox. 한 세션 정책 혼용 금지 |
| [V2](../be/src/main/resources/db/migration/V2__create_page_visit.sql) PK visit, UNIQUE(session,sequence), FK session, TEXT nullable | extraction_status/legacy 표시, receipt/tombstone/payload 분리 검토. content 성공 필수는 v2 validation, 구 null 보존 |
| [V3](../be/src/main/resources/db/migration/V3__create_analysis_window.sql) UNIQUE(session,index), UNIQUE(session,size,end), start/end FK·window_visit PK(window,visit)/UNIQUE(window,position)/FK | 기존size5 보존·신규 명시3, compose job ID 연결/receipt. FK는 각 visit 존재만 보장하며 동일 세션·정확한3개/순서는 앱 검증 필요 |
| [V4](../be/src/main/resources/db/migration/V4__create_analysis_result.sql)/[V5](../be/src/main/resources/db/migration/V5__add_analysis_started_at.sql) window_id NOT NULL FK, UNIQUE(window), started_at·nullable 확률/JSON | 구성job은 별도 FK없는 작업 테이블(session FK만), 분석은 Window 저장 후. api_contract_version/page_results/hash 추가; 체류 재판단은 새 analysis row 금지 |
| 신규 window_state_history / decision outbox | PK(window,stateVersion), FK window/analysis, UNIQUE(window,inputFingerprint), ordered JSON behavior, judgedAt/ruleVersion. 상태 dirty 작업 claim/멱등 |
| [V6](../be/src/main/resources/db/migration/V6__create_notification.sql) UNIQUE(analysis_id), [V7](../be/src/main/resources/db/migration/V7__create_alert_candidate_task.sql) PK(analysis_id) | v2 state FK/키 신규, legacy 키를 그대로 두면 여러 state 후보 생성 불가능. 새 테이블 또는 legacy 조건부 unique로 이관 검토. analysis FK/과거 shown/response 보존 |
| [V8](../be/src/main/resources/db/migration/V8__add_notification_scheduled_at.sql) 회차 UNIQUE, [V9](../be/src/main/resources/db/migration/V9__create_notification_response.sql) alert 응답 UNIQUE, [V10](../be/src/main/resources/db/migration/V10__add_notification_history_index.sql) 이력 인덱스 | 기존 고정주기·첫 선택·조회 인덱스 유지, v2 알림 FK 전환시 검증 |
| 신규 collection_failure / privacy_retraction / dataset 저장소 | 실패 진단·멱등회수·tombstone·가명/동의/독립/합의·Export 목록. 재처리/삭제상태·권한 설계 필요 |

신규 migration은 구현 시 최신 main 다음 번호 선택. **V1~V10 수정·신규migration 적용 없음.** expand→구행 legacy 명시→v1 회귀→v2 신규세션 feature gate→관측 순. IDB format도 별도 확장; 진행 중 v1 POST1000ms/Window5/input_snapshot은 v2로 변환하지 않는다. rollback은 신규 v2 시작 중지·기존 v2 pending 보존/운영 복구이며 데이터 drop이나 v1로 재해석이 아니다. session end/기존 조회·알림 경로 제거 없음.

## 10. 후속 구현 작업 제안 (Issue 자동 생성 안 함)

| 제안 작업 | 범위·완료 증거 | 선행 |
| --- | --- | --- |
| 공통 승인·개인정보 절차 | P1~P6 선택/담당/근거, 삭제·동의·보존 확인, batch/lease/timeout 실측 | 이번 PR 검토 |
| BE 저장 확장·격리회수 | 신규 Flyway 설계, versions/watermarks/jobs/state/알림키·회수 FK·소유권, v1 호환/삭제 race 테스트 | 공통·개인정보 승인 |
| AI compose/v2 API | model-free compose3/stride1·restart deterministic; 3개 pageResults/검색어 모델 경로·오류 sanitization·캐시 회수 | P2/P4/P6 승인, Schema |
| BE orchestration·판단 | compose claim/CAS/outbox→분석→suffix rule/이력·dirty 범위·최신조회·알림gate, 종료후/역순/FAILED 보호 | 저장 확장+AI API |
| FE 수집/영속·회수 | P1 monotonic identity/cache, 유효화 순서, 5초/5분·ACK·새 checkpoint 형식/compaction·권한/END_PENDING·회수 | P1~P3 승인·BE 수용 API |
| 데이터/평가 도구 | blind labels/κ·reference snapshot·goal split·manifest·동의회수 검증, v2 loader | P6·개인정보 승인 |
| 통합 파일럿 | 실제 Chrome 타이머·시계/권한·quota·지연복구, BE/AI 모델·DB·삭제·알림 race, v1 회귀 | 위 구현 완료 |

## 11. 요구사항 추적과 검증 범위

| #81 요구 | 설계 근거 | 실행 가능한 자산/후속 증거 |
| --- | --- | --- |
| P1 이탈·복귀/reload/SPA/재시작 | §3, §2 코드 | scenarios revisit 경계/identity, 실제 Chrome 후속 |
| P2 5초·순서·동시/지연·전송 후 민감 | §4 A/B/C·§4.1 | schema 4999/5000, sequence gap/replay/conflict·retraction oracle; 실제 삭제 통합 후속 |
| P3 5분·중복/ACK/복구·장기저장 | §5 | patch boundary/stale/equal/conflict·threshold oracle, IDB/quota 후속 |
| P4 AI 구성·커서·FK·단계 | §6·§9 | compose1~5/gap/tail/replay/order oracle, analysis relation validation |
| P5 상태·입력버전·최신알림·종료 | §7 | 216개 rule 조합·same-window state/역순/종료/실패 model scenarios |
| P6 정적기준·라벨/κ·split/manifest/개인정보 | §8 | manifest schema·split relation, κ self-check. 실데이터/동의규정 검토 미실행 |
| 공통 타입/오류/진단·정상/오류 Fixture | §9, [필드 사전](contracts/v2/README.md) | Draft2020-12+FormatChecker 및 executable reference oracle |
| 책임/승인·후속 구현 분리 | §1·각 결정표·§10 | P1~P6 PROPOSED, 개인정보/배포 선결 BLOCKED, 승인링크 없음 |

검증 명령/실측 결과/미실행 범위는 [data-contract-validation.md](data-contract-validation.md)에 기록한다. oracle은 **제안 계약의 실행 모델**이며 제품서비스·브라우저·DB·모델 호출이 아니다. Schema로 표현할 수 없는 DB 조회·동시성·삭제 완료까지 자동 통과했다고 보고하지 않는다.
