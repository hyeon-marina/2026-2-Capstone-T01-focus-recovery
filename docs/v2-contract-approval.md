# Issue #83 — 기술 재검토 및 팀 승인 요청

## #93 개인정보 회수 구현 — 합성 검증 / 운영 BLOCKED

P1~P6의 PROPOSED와 P2/P6 BLOCKED를 변경하지 않는다. 기본 거절 인증 및 삭제 실행 정책에는 운영 활성화 환경변수가 없다. test 소스의 소유권/삭제 정책만 합성 데이터를 허용한다. 승인된 전체 삭제 범위·담당자·FE/AI/로그/Export/학습/백업 증거가 없으므로 PURGED 전이를 제공하지 않는다.

상세 구현·삭제/격리 Inventory·명령·실패/미검증 범위는 [개인정보 회수 검증 보고](v2-privacy-retraction-validation.md)를 따른다. 아래 과거 작업의 미구현 설명은 당시 기록이다. **P1~P6 PROPOSED, P2/P6 BLOCKED 유지.**

## #91 FE 합성 전용 구현 — 승인 변경 없음

사용자의 #91 지시로 FE v2 수집/영속/재전송·종료 복구를 합성 전용 경로에 구현했다. 이는 승인자·일시·근거를 추가하거나 P1~P6를 APPROVED로 변경한 기록이 아니다. P2 조기 전송/P6 실사용자 처리의 BLOCKED 조건과 기존 BE/AI Gate는 유지한다.

실제 구현·명령·Mock/Chrome/HTTP 구분·미구현/미검증 범위는 [FE v2 검증 보고](fe-v2-collection-validation.md)를 따른다. **P1~P6 PROPOSED, P2/P6 BLOCKED 유지.** 아래 과거 작업의 미구현 설명은 각 작업 당시 기록이다.

**P1~P6 전부 PROPOSED. 승인된 세부 정책은 0건이다. P2 조기 전송과 P6 실데이터 처리는 BLOCKED다.** 이 문서는 구현 권장안을 검토 가능한 형태로 정리한다. 제품 구현·삭제 완료·팀 승인을 선언하지 않는다. [#81 결정안](v2-contract-decisions.md)의 변경하지 않은 상세 설계는 유지하며, 아래 수정 근거가 있는 항목만 보완했다.

## #89 비배포 연동 기록 — 승인 변경 없음

사용자의 #89 지시에 따라 Backend HTTP/Dispatcher·최종 상태·이력/dirty 재판단·최신 조회/알림과 V12를 합성 테스트로 구현했다. [구현·검증 보고](be-ai-v2-integration-validation.md)에 실제 실행과 Mock/모델 미실행을 구분한다. 이는 아래 승인자의 근거를 추가하거나 P1~P6를 APPROVED로 변경한 것이 아니다.

정확히 test 프로필+storage flag와 별도 dispatch flag(각 기본false)를 유지한다. 합성 HTTP130초/Lease180초/여유15초·Worker2/큐0·구성3claims/backoff는 운영 승인값이 아니다. v1은 기존 설정/데이터/응답을 유지하며 v2 실패 fallback은 없다. 개인정보는 격리·노출/지연 Commit 차단까지이며 공개 회수 인증/소유권·실제 삭제·AI cache/Export/학습/백업 전파·PURGED는 미구현이다. P2/P6 BLOCKED 해제 조건은 미충족 그대로다.

## #85 비배포 구현 기록 — 승인 변경 없음

사용자의 #85 지시에 따라 합성 데이터용 Backend 저장 기반/V11을 구현했다. [실제 구현·테스트·미구현 경계](be-v2-storage-foundation-validation.md)를 참조한다. 이는 §2의 승인자·근거를 추가한 것이 아니며 PROPOSED/BLOCKED를 변경하지 않는다.

P2/P4/P5의 기술 권장안을 저장 경계로 검증했다. flag 기본false, 활성 프로필이 정확히 test인 경우만 true를 수용한다. 운영에서 해당 기능을 활성화하는 옵션은 제공하지 않는다. 개인정보는 내부 격리/tombstone/대상 inventory 및 실패만 저장하고, 소유권 API·END_PENDING 예외·실제 삭제/외부 회수·PURGED는 미구현이다. §5/§7의 해제 조건은 그대로 미충족이다. 구성/분석 HTTP·dispatcher·최종 판단/조회·상태 버전 알림과 B~H의 나머지 통합은 후속 작업이다.

## 1. 기준과 승인 근거 조사

- 확인일: 2026-11-10 KST. 시작 HEAD `6e15dd3fa1789e96c42bc4f33250c4221d6d2616`, detached HEAD, tracked 수정·미추적 파일 모두 0건. 기존 변경사항 없음.
- origin(fetch/push): `https://github.com/hyeon-marina/2026-2-Capstone-T01-focus-recovery.git`. upstream(fetch/push): `https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery.git`.
- 두 remote fetch 후 공식 최신 main `a1a5d9701d45e0f7ce07b14ead27d67a53eec08c` 확인. 동일 로컬/원격 브랜치 없음 확인 후 `docs/83/v2-contract-approval` 생성. 기존 다른 worktree/브랜치 보존, 공식 main 직접 commit/push 없음.
- [#79](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/79)·[#81](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/81)은 CLOSED/completed, 댓글 각 0. [#83](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/issues/83)은 OPEN, 댓글 0. 실제 본문과 댓글을 GitHub API로 읽었다.
- [PR #80](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/80)은 `6e15dd3`에 문서 6개, [PR #82](https://github.com/SKHU-AI-Projects-Archive/2026-2-Capstone-T01-focus-recovery/pull/82)는 `a1a5d97`에 문서·계약 자료 13개를 병합했다. 두 PR discussion/review 조회 결과 0건이고 본문은 세부 정책 미승인을 명시한다. 병합 및 Issue 종료를 정책 승인으로 간주하지 않는다.
- 최근 변경 목록에는 #77/PR #78(Context warm-up·학습 캐시), #72/PR #73(임베딩 캐시), #69/PR #71 및 PR #75(BE–AI 연동), #59/PR #61과 #74/PR #76(실제 권한 검증·안내 수정)이 있다. main log와 제품 코드를 대조했다. 기존 5개 분석 API 연동은 존재하며, v2 API는 없다. 과거 Google/Windows/DOM 검증의 BLOCKED를 해결한 것으로 보고하지 않는다.
- 저장소 내 AGENTS.md 없음. `/Users/hyeon/.codex/AGENTS.md`는 빈 파일. PR 템플릿은 `.github/pull_request_template.md` 확인. 원계획의 develop 통합 설명보다 이번 공식 main 대상 PR 지시를 따른다.

| 상태 | 변경 조건 |
| --- | --- |
| APPROVED | 명명된 승인 주체, 승인 일시(시간대 포함), 정책/패키지 버전 및 범위를 확인할 수 있는 Issue/PR/회의 기록 URL이 모두 존재 |
| PROPOSED | 기술 검토한 권장안이나 위 근거 없음 |
| BLOCKED | 기술 구현·보안·개인정보·기관 절차 등 필수 조건 미충족. 문서 승인만으로 해제 불가 |

5초·4초·5분·size3/stride1·수집 목표는 사용자 및 Issue가 요구한 설계 제약으로 보존한다. 과거 문서의 '상위 정책 APPROVED' 표현은 별도 승인 증거를 제시하지 못하므로 이번에 바로잡았다. 변경하지 말라는 요구와 팀 승인 사실을 구분한다.

## 2. P1~P6 결정·승인 대장

승인 담당은 필요한 **역할**이며 실제 개인의 승인이나 위임을 추정한 것이 아니다. 모든 행의 승인자·승인 일시·승인 근거 URL은 **없음**이다. 논의 URL은 §1이며 승인 URL이 아니다.

| 결정 대상 | 기존 권장안 / 검토 대안 | 최종 권장안과 근거 | 코드·DB 영향 | 데이터·개인정보 영향 / 위험·선결 | 승인 영역 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| P1 대상·재방문·캐시 | 탭+대상+콘텐츠 세대 / URL만·identity만 | 관측 leftAt/returnedAt, 같은 측정 세대 <4000만 병합. URL과 콘텐츠 중 하나만 바뀌어도 새 대상 증거 검사. 캐시는 별도 보호 재검증 | collector/navigate/observe, content-change, index, active-time, checkpoint 새 형식. 서버 raw identity 추가 없음 | 같은 URL 동적 문서 병합 방지. 앱 비활성·reload·시계·재시작 경계의 실제 Chrome 검증 필요 | FE·데이터·개인정보 | PROPOSED |
| P2 sequence | 유효화 순 / 시작 순 대기·두 순서 별도 | >=5000+콘텐츠/보호 성공의 영속 commit 순. visitedAt은 시작 시각. 열린 후보 차단 제거와 불변 Window 양립 | assignSequences/readyVisits/IDB validator, BE 수신 watermark, session version 협상 | 추출 지연으로 chronology와 다름. 단일 writer, 원자 commit, sparse sequence·v1 분리 검증 필요 | FE·BE·AI·데이터 | PROPOSED |
| P2 전송 후 회수 | 격리→무효화→삭제 / 이후 제외·POST 정정·단일 DELETE | tombstone을 replay보다 먼저 검사, 전체 세션 분석 격리, 증거 있는 전파 회수. 현재 FK와 async 구조에는 신규 저장·차단 경로 필요 | session/visit/window/analysis/alert 및 신규 회수 job·권한·payload 분리. V1~V10 변경 없음 | POST 유실·분석 중·저장 후·Export·학습·백업 회수 미구현. 인증/소유권·P6 절차·실삭제 검증 필요 | BE·FE·AI·개인정보/기관 | BLOCKED（권장 설계는 PROPOSED） |
| P3 누적 갱신·정리 | PATCH 유지 / 신규 endpoint·주기 HTTP | 기존 PATCH+durable crossing, old<300000<=new. 측정·적용·판단 시각 분리. 체류만으로 Window 생성 금지 | active-time/behavior-delivery/IDB·종료 drain, BE dirty outbox. body 유지 | ACK 유실·quota에서 미확인 원문/영수증 보존. 단조시계만으로 휴면 증명 불가 | FE·BE·데이터 | PROPOSED |
| P4 구성·분석 | AI compose→BE 저장→AI 분석 / 단일 batch·BE 구성 | AI가 실제 ordered stream에서 size3/stride1 멤버 선택. BE는 검증/ID/원자 저장. 불변 prefix·별도 privacy revision으로 append와 철회 구분 | compose job/receipt/cursor/outbox, AnalysisWindowService/Request/Executor/Recovery, AI endpoint/DTO, V3/V4 확장 | 새 방문 append는 진행중 job 취소 사유 아님. 철회/커서 변경 응답 폐기. batch256·lease·timeout 실측 승인 필요 | BE·AI·데이터 | PROPOSED |
| P5 상태·알림 | 입력 변경마다 이력 / 상태 전환만·같은 Window 복귀로 재알림 | 최신부터 suffix3 규칙, fingerprint 중복 방지, 모든 포함 Window 재판단. 같은 상태 새 입력도 저장. 기존 뒤 Window 복귀·최소간격 보호 유지 | window_state_history/dirty job, QueryService, V6 UNIQUE(analysis_id)·V7 PK 변경 필요 | 최대3 Window fanout, 오래된 입력이 새 버전을 발급하면 안 됨. 후보/실제 shown 분리, 종료 즉시 표시 중지 | BE·FE·AI·데이터 | PROPOSED |
| P6 라벨·분할 | 최초 성공 snapshot / Export 최신·가상의5초 snapshot | FIRST_SUCCESSFUL_STATE의 실제 behavior snapshot 고정. 독립3인·합의 분리, 목표12/4/4, 예측과 정답 분리 | 별도 label/export 도구·v2 loader. legacy 5개 loader/LOSO 유지 | 분석 지연 선택편향 보고, AI 실패/철회는 제외사유. κ는 독립표만. 실제 정책 버전 없는 manifest로 Export 금지 | 데이터·평가자·AI·BE | PROPOSED |
| P6 보존·동의·기관 적용 | 외부근거 후 결정 / 임의 기간·형식 동의 | 원본·파생·Export·학습·백업별 책임/기간/철회 근거를 실제로 승인받음 | consent/export lineage·접근통제·삭제 감사 신규 | 학교/기관 절차와 담당자 미확인. 개인식별 연결표 별도. 본수집·공유·학습 차단 | 연구책임자/지도교수·기관 개인정보 담당·심의 담당 | BLOCKED |

## 3. 현행 코드와 충돌을 재확인한 근거

기준은 §1 main이다. [기존 상세 코드표](v2-contract-decisions.md#2-코드의-현재-동작과-회귀-위험)는 동일 제품 코드에 적용된다. 다음은 이번에 직접 다시 읽은 핵심 동작과 추가 영향이다.

| 근거 파일·심볼 | 현재 코드·테스트 | 이번 구현 계약의 영향 |
| --- | --- | --- |
| [collector](../fe/src/background/collector.ts) `validate/assignSequences/navigate/observe`, [sequence.test](../fe/tests/sequence.test.ts) | valid>=1000, finalized prefix; reload 유지, SPA identity **AND** 본문변경. 열린 후보 뒤 sequence 보류 | 5000 상수만 바꾸면 부족. 같은 URL의 새 본문, URL만 바뀐 로딩 구간을 독립 판정해야 함 |
| [index](../fe/src/background/index.ts) `dispatch/persist/reconcileDocuments`, [active-time](../fe/src/background/active-time.ts) | Date.now, 직렬 작업 도착 시각 보존, IDB 완료 후 전송; 문서 재확인·관측 gap 미가산 | 비동기 권한/추출 완료 시각을 returnedAt으로 사용 금지. content 메시지 stale generation 폐기, 새 측정 세대 |
| [durable-state](../fe/src/background/durable-state.ts) `validate/save`, [durable-state.test](../fe/tests/durable-state.test.ts) | format1, strict readwrite+revision CAS, 배열·연속 prefix 검증. ACK 유실·stale worker 회귀 존재 | nextSequence+불변 POST+후보 전이 단일 commit. request success 아닌 transaction complete 기준. 새 checkpoint/영수증 이관 검증 |
| [visit-delivery](../fe/src/background/visit-delivery.ts), [behavior-delivery](../fe/src/background/behavior-delivery.ts), [session-end](../fe/src/background/session-end.ts) | sending 영속→HTTP→ACK 영속, 앞 POST ACK 뒤 다음; drain 후 {} 종료. SESSION_ENDED는 ACK 아님 | 조기 POST 중 개인정보 관측 시 회수 작업 우선. 회수 예외 없이 일반 END drain이 원문 재전송하면 안 됨 |
| [WorkSessionService](../be/src/main/java/com/focusrecovery/domain/session/service/WorkSessionService.java) `create/end`, [PageVisitService](../be/src/main/java/com/focusrecovery/domain/visit/service/PageVisitService.java) `saveOrReplay/updateBehavior/applyFinalBehaviors` | 시작 멱등키는 목표만 비교. 방문은 replay가 ENDED보다 우선, PATCH session 공유→visit 쓰기잠금, 종료는 session 쓰기잠금 | 시작 키 재사용 시 목표 **및 collectionSpecVersion** 일치 필요. tombstone은 replay 앞. finalBehaviors도 dirty 처리, 판단과 잠금 순서 통일 |
| [AnalysisWindowService](../be/src/main/java/com/focusrecovery/domain/window/service/AnalysisWindowService.java), [AnalysisRequestService](../be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisRequestService.java), [WindowTest](../be/src/test/java/com/focusrecovery/domain/window/AnalysisWindowTest.java) | BE size5, 첫 Window 이전 작은 신규번호 허용. >=10000/end 분석, PATCH는 끝 방문의 미요청 Window만 확인 | v2 저장 watermark 별도, AI에 preformed triples를 보내지 않음. 행동 변경은 포함 Window 전체 dirty, 신규 Window 금지 |
| [AiAnalysisClient](../be/src/main/java/com/focusrecovery/domain/analysis/client/AiAnalysisClient.java), [DTO](../be/src/main/java/com/focusrecovery/domain/analysis/client/AiAnalysisRequest.java), [AnalysisResult](../be/src/main/java/com/focusrecovery/domain/analysis/entity/AnalysisResult.java) | HTTP/1.1·ID/확률/시각 검증, Window당 분석1행 | v2 3개 pageResults/검색어/fingerprint 전용 검증. 기존 확률 validator 재사용 불가 |
| [Executor](../be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisExecutor.java), [Recovery](../be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisRecovery.java), [Query](../be/src/main/java/com/focusrecovery/domain/analysis/service/AnalysisQueryService.java) | AFTER_COMMIT claim, HTTP 밖 tx, RUNNING만 완료, timeout FAILED·자동 재호출 없음. 조회는 분석행 중심 | 저장 후 실행 전 장애는 durable outbox로 보완; 기존 Recovery만으로 자동 재개 안 됨. 구성 job과 분석 job 복구 분리, 최신 구성 Window가 기준 |
| [AlertService](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertService.java), [TaskProcessor](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertTaskProcessor.java), [Display](../be/src/main/java/com/focusrecovery/domain/alert/service/AlertDisplayService.java) | analysisId 키, 최신 DRIFT·뒤 Window 복귀·shown 간격, 늦은 실제 표시 ACK 시간검사 | stateVersion 키로 확장. 현재 후보 허가와 과거 실제 표시 사실 저장을 구분. 회수 후 원문 연결 로그 복원 금지 |
| [ai/main](../ai/main.py) `validate_request/run_analysis/AnalysisRegistry`, [pipeline](../ai/pipeline.py), [context](../ai/models/context.py) | 5개 정렬·확률 결과, PageVisit은 title/content만. 진행중 registry 메모리, 예외 str/traceback 응답 | v2 요청 별도 분기, searchQuery를 모델까지 전달, 페이지 라벨3개. 분석 실패를 NORMAL로 채우지 않음. 오류/로그 원문 제거와 캐시 회수 필요 |
| [embedding](../ai/models/embedding.py), [classifier](../ai/models/classifier.py), [dataset](../ai/training/dataset.py), [train](../ai/training/train.py), [compare](../ai/training/compare.py) | cosine 텍스트 해시 LRU, classifier predict_proba, 5개 **연속 숫자** loader, LOSO, prompt 기반 Context JSONL 캐시 | v2는 sparse 순서·목표 split. 기존 loader는 그대로 쓰면 공백 방문 거절. 임베딩/Context는 visit 역색인 없어 표적 회수 보장 불가. 캐시 전체 격리 대안 필요 |

Flyway V1~V10 원문을 확인했다. V3는 start/end와 window_visit→visit FK, V4는 window NOT NULL/UNIQUE, V6/V7/V9는 analysis→알림→작업/응답 FK다. 실제 SQL에는 cascade delete가 없다. UUID만으로 세션 소속·정확한3개를 DB가 검증하지도 않는다. 따라서 **단일 visit DELETE, Window 없이 analysis INSERT, analysisId 하나에 복수 상태 알림**을 현행 제약에서 수행할 수 없다. 상세 확장안은 [결정안 §9](v2-contract-decisions.md#9-apidb-변경-영향과-호환)이며 migration은 만들거나 실행하지 않았다.

## 4. P1~P3 보완 계약과 구현 전 경계

P1은 같은 탭·대상에서 최초 비활성 관측 leftAt과 최초 재활성 관측 returnedAt을 사용한다. 추출 지연은 관측시각을 바꾸지 않는다. 같은 측정 세대 3999ms 유지, 4000ms 신규. A→B→A는 A의 이탈 레코드로 판단하며 B를 A와 합치지 않는다. 다른 탭의 같은 URL은 별도 방문, 새로고침은 새 document 검증 후 경계 적용. query/검색어/SPA route 또는 같은 URL의 주요 콘텐츠가 바뀌면 새 대상이다. URL만 바뀌고 본문이 이전 것이면 전송 대기한다. 원래 `identity AND contentChanged` 구현을 목표 계약으로 유지한다는 수집규격 문구를 수정했다.

캐시 재사용 전에 권한→원본 URL 보호→민감 DOM→대상/콘텐츠 세대 검증을 통과해야 한다. 같은 normalizedUrl의 query 문서를 합치지 않는다. raw URL/fragment·identity 해시는 wire·Export에 추가하지 않는다. SW/Chrome 재시작은 monotonic 세대와 탭 수명을 새로 만들고 미관측 구간0, 과거 POST/ACK는 보존. 4초 증명 불가 후보는 recoveryRequired, 재관측은 새 방문 권고. 벽시계 전후 이동은 UTC 감사시각에만 영향을 주며 체류/복귀 판정은 바꾸지 않는다.

단조시계만으로 OS 휴면·이벤트 공백의 활성 상태를 증명할 수 없다. **5초/5분 정확시각 전송 보장도 하지 않는다.** Chrome SW는 중단될 수 있고 alarms는 최소 주기·지연 제약이 있다([Chrome lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle/), [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)). 활성 문서의 제한된 관측 checkpoint/foreground 이벤트와 durable 임계 marker를 조합하고, 휴면·Worker 소실 구간은 소급 가산하지 않는 방식을 FE가 실측해야 한다. 수치 heartbeat/오차한도는 아직 승인하지 않았다. [High Resolution Time](https://www.w3.org/TR/hr-time/)의 단조시계와 실제 OS 휴면 동작도 구분한다. 소수 ms는 누적 잔여를 보존하고 wire 정수 ms는 floor하여 4999.x를 5000으로 올림하지 않는 것을 권고한다.

P2는 후보 시작 순서와 분석 확정 순서가 다름을 명시한다. A가 먼저 시작해도 콘텐츠가 늦으면 B1/A2가 가능하다. 동시 이벤트는 background 직렬 처리의 **IDB commit 순**이다. 실패 commit은 번호/POST를 공개하지 않으며 retry 때 다시 원자 commit한다. [IndexedDB transaction](https://www.w3.org/TR/IndexedDB/) complete 전에 HTTP를 보내지 않는다. pending 원본·sequence 상한·receipt를 보존하고 ACK 유실은 같은 visitId/sequence/불변 본문으로 재전송한다. BE replay와 개인정보 tombstone 검사를 우회해 새 번호를 주지 않는다. sparse sequence는 허용하지만 저장된 유효 방문을 Window에서 생략하는 것은 금지한다.

P3은 기존 세 필드 PATCH를 유지한다. 버전이 증가하는 것은 committed 행동 snapshot이 바뀔 때뿐이다. old<300000<=new는 최초 crossing이고 동일/낮은 버전은 재적용하지 않는다. 높은 버전·같은 누적값은 현행 BE가 applied=true이므로 state fingerprint에 버전이 포함됨을 유지한다. 늦은 timer301234는 실제301234를 전송한다. 측정 관측시각≠서버 updatedAt≠judgedAt이며 API에 측정 timestamp가 없으므로 정확한 crossing 시각을 서버에서 복원할 수 없다.

장기 세션 정리는 ACK+finalized+재복귀 대상 아님+pending PATCH/회수 없음 조건과 최소 영수증이 필요하다. 현재 format1의 배열길이/연속검증을 둔 채 본문 row만 삭제하면 종료 drain·복구가 깨진다. 새 형식 이관 완료 전 원본 삭제 금지. quota 실패는 backpressure/안전중지·명시 복구, 성공 ACK 합성 금지. v1 미완료 세션은 v1로 종료하고 새 v2 세션만 새 규격을 협상한다.

구현 전 P1/P2/P3 경계: 3999/4000, 4999/5000, 299999/300000, 지연 추출·중복 메시지·서로 다른 탭·URL만/본문만 변경·reload 실패·권한 철회/재허용·시계 전후 이동·OS 휴면·SW/Chrome 재시작·IDB abort/ACK commit 실패·quota·END_PENDING을 실제 FE/BE 통합에서 확인해야 한다. 이번 합성 검증은 이를 대체하지 않는다.

## 5. P2 개인정보 회수의 단계별 차단

회수 API/권한/삭제 구현은 **없다**. 아래는 신규 구현 계약 후보이며 기능 완료 보고가 아니다. 회수 작업은 일반 POST ACK를 기다리지 않는 독립 영속 제어 작업이다.

| 발견 시점 | 필수 처리·멱등/경합 | 완료라고 부를 수 없는 상태 |
| --- | --- | --- |
| POST 저장 후 | 세션 잠금에서 tombstone+격리+삭제 job, 본문 및 원본 receipt 복제 회수 | FE 큐 삭제만 완료 |
| POST 응답 유실 / 회수가 먼저 도착 | 서버 저장 여부와 무관하게 회수. 미존재 ID도 세션 귀속 tombstone. 이후 POST는 **원본 replay보다 앞**에서 PRIVACY_RETRACTED409 | 기존 replay200으로 원문 다시 응답 |
| AI 진행 중 | 네트워크 취소는 best effort. claim/complete·AI registry/cache 저장 직전 privacy revision 재확인, 늦은 응답 폐기·캐시 재유입 방지 | HTTP 취소만 하고 원격 추론/메모리 잔존 |
| AI 결과 저장 후 | immutable 결과도 무효화 대상. input/feature/context/rationale/response·로그/캐시 파생 삭제 | visit 원문만 삭제 |
| Window·상태 이력 존재 | 포함 Window 무효화, 세션 구성·판단 격리, currentDecision INVALIDATED/null, lastSuccessfulState도 반환 중지 | 철회 방문 제거 후 남은 방문을 이어 붙여 과거 흐름 생성 |
| 알림 후보·실제 표시 존재 | 후보/작업 중지·조회/새 표시 차단, 실제 shown 사실은 조작하지 않고 연결 기록의 삭제 범위 추적 | 후보 취소를 '표시 안 됨'으로 기록, 이미 본 화면을 회수했다고 주장 |
| Export 배포 후 | manifest별 수신자/사본 lineage, 접근 철회와 삭제 확인. 백업 복원 tombstone 재적용·폐기 검증 | 서버 파일 비공개만으로 모든 사본 삭제 완료 |
| 학습 편입 후 | 학습·artifact 배포 중지, 영향 모델/체크포인트/캐시 추적. 제외 후 재학습·기존 artifact 폐기/대체 및 확인 담당 승인 | 데이터 row 삭제를 모델 영향 제거로 표시 |

권장 회수 endpoint는 기존 `POST /api/sessions/{sessionId}/visit-retractions`를 유지한다. retractionId+payload 동결, 최초202 QUARANTINED, replay200은 **현재 처리 상태**(격리 또는 완료) 반환, 상충409. 최초 격리202와 replay200을 삭제 성공 여부와 혼동하지 않는다. ENDED에서도 권한 있는 소유자 회수 가능. UUID만 아는 호출자에게 권한을 주지 않으며 미존재ID도 요청자의 세션 귀속을 검증한다. 동의 철회는 참여자→모든 세션/visit/진단/라벨을 서버에서 열거하는 별도 관리 작업이 필요하고, visit API 하나로 전체 철회 완료라고 할 수 없다.

`RetractionAck.status=PURGED`는 등록된 원본·파생·로컬/AI 캐시·로그·Export 사본·백업·학습 artifact 영향에 대해 승인된 삭제/폐기·대체 증거가 모두 확인된 **집계 상태**만 뜻한다. 일부 미확인/실패/외부 수신자 미응답이면 QUARANTINED 유지. 최소 tombstone 보존 범위/기간도 P6 승인 대상이며 원문을 넣지 않는다. 내부 항목별 job/담당/증거/재시도 저장소가 필요하다. Schema의 PURGED 문자열이 삭제를 증명하지 않는다.

세션 privacy quarantine은 ACTIVE/ENDED와 별도 제어 속성으로 저장한다. currentDecision이 있으면 INVALIDATED/errorCode=PRIVACY_RETRACTED, lastSuccessfulState=null, alert=null. Window 없으면 currentDecision=null이어도 격리로 모든 분석/공유를 막는다. 세션 생명주기 종료와 개인정보 회수 완료는 별개다. 종료 선택 시 신규 수집/알림은 즉시 중단하되, 민감 원본의 정상 전송 drain을 멈추고 회수/tombstone 확인·원문 안전 삭제·최소 영수증으로 대체하는 **새 개인정보 예외 경로**가 필요하다. 이 경로 없이는 END_PENDING이 회수를 기다리며 차단돼야 하고 원문을 자동 재전송해서는 안 된다.

삭제 전략은 payload 분리+최소 FK skeleton/tombstone을 우선 검토한다. 대안인 종속 물리삭제는 task→response/notification→state/analysis→window_visit/window→visit 순서와 외부 snapshot 참조까지 안전성을 증명해야 한다. 어떤 방식을 택하든 V3/V4/V6/V7/V9를 무시할 수 없고 append-only보다 삭제 의무 처리가 우선한다. 이번에 migration을 선택·적용하지 않았다.

**BLOCKED 해제 조건:** 소유권/서비스 인증 승인, 동의·보존/기관 확인, 전체 삭제 inventory 및 운영 담당 승인, POST/replay/END/AI/알림/Export/학습 경합의 실제 통합 삭제 증거, 실패/백업 복원 훈련, 팀 활성화 승인 URL. 일부만 충족해도 조기 POST 운영 활성화 금지다.

## 6. P4/P5 비동기 일관성 보완

BE는 tail 최대2+신규 prefix를 단순 ordered visitId/sequence로 전달하며 **미리 triples를 만들지 않는다**. AI가 실제 인접3개/stride1 멤버를 선택한다. BE는 신뢰 경계에서 결과의 전체 멤버/순서/끝/커서/소속을 검증한다. 1~2개는 windows=[] 성공·커서 전진, 3개부터 생성. 번호1,3,4는 [1,3,4]이고 after+건수 계산 금지다.

기존 문서의 단일 session revision은 append와 철회를 혼동할 위험이 있다. 수신 watermark, 구성 cursor, **privacy/멤버 유효성 revision**을 분리한다. job의 immutable prefix가 [1,3,4]인 동안 방문6이 추가돼도 [1,3,4] commit 후 다음 job이6을 처리한다. PATCH 행동 증가도 구성 입력을 바꾸지 않는다. 반면 tombstone/세션 격리·prefix 멤버 변경 또는 cursor CAS 불일치는 기존 응답을 폐기한다. schema wire에 revision을 넣을 필요는 없고 BE job snapshot·commit 검증에 저장한다.

tx1: 수신 방문+watermark+구성 dirty → tx2: 한 세션 job claim·ID/hash/after/tail/prefix 고정 → HTTP(tx 밖) → tx3: privacy/tombstone 확인 후 receipt replay, cursor CAS·소속·전체구성 검증, Window ID/index+멤버+PENDING 분석+outbox+cursor+receipt 원자 commit. commit 전 crash는 전부 rollback, commit 후 응답유실은 receipt로 같은 ID/index/analysisId 반환. 새 ID를 중복 생성하지 않는다. 구성의 재시도/lease는 신규 job이고, 기존 AnalysisRecovery는 timeout을 FAILED로 만드는 구조라 자동 재분석 기능으로 인용할 수 없다. 저장 직후 실행 등록 전에 중단돼도 outbox가 누락을 복구해야 한다.

P5 규칙은 [수집규격 §7](data-collection-spec.md#7-window최종-상태상태-이력)의 여섯 조건을 유지한다. 먼저 실패/누락/철회 차단, 최신 페이지 DIRECT/우회면 NORMAL, 나머지 최신부터 무관 suffix 최대3: 3개 DRIFT, 1~2개 중 >=300000 DRIFT, 2개 모두 미만 TRANSITION, 1개 미만 NORMAL. Window 앞쪽의 긴 무관 체류가 최신 관련 페이지를 덮지 않는다.

`WindowState`의 성공 snapshot은 유효 방문3개이므로 각 duration>=5000이어야 한다. 기존 Schema가0을 허용하는 오류를 고쳤다. ordered 멤버·analysisId·ruleVersion·fingerprint 검증 후 `(windowId,inputFingerprint)` UNIQUE, `(windowId,stateVersion)` PK. 동일 입력은 기존 버전, 입력이 바뀌면 같은 상태도 새 버전이다. 높은 behaviorVersion·같은 누적값 역시 새 입력이라는 기존 권장안을 유지한다.

행동 PATCH/finalBehaviors tx는 포함한 모든 기존 Window(최대3)를 dirty로 기록한다. 판단 시 session→Window index순 잠금 아래 최신3개 행동을 읽고 commit하거나, 낙관 처리라면 commit 직전 버전 벡터 CAS 실패 시 버린다. **오래된 snapshot worker가 뒤늦게 더 큰 stateVersion을 발급하면 안 된다.** 네트워크 AI 결과는 고정 의미 결과만 저장하고 최신 행동으로 최초 판단, 판단하지 않았던 중간 이력을 합성하지 않는다. 체류로 새 Window/AI 요청 생성 금지다.

최신 구성 windowIndex의 dirty/PENDING/FAILED는 current state=null, 과거 성공은 비철회 시 lastSuccessfulState 참고만. 과거 Window의 늦은 완료가 current/알림을 되돌리지 않는다. 후보 키는 windowId+stateVersion, analysisId는 근거 FK. 생성·조회·표시 직전 최신/DRIFT/ACTIVE/비철회 확인, FE 종료 선택부터 표시 차단. 같은 DRIFT 갱신은 미표시 후보를 supersede하며 실제 shown은 재작성하지 않는다. 같은 Window의 NORMAL 버전으로 연속 DRIFT를 재설정하는 대안은 반복 알림 위험으로 권장하지 않는다. 뒤 Window의 완료 NORMAL/TRANSITION과 기존 shown 최소간격을 모두 요구한다. 늦은 **실제** shown ACK 저장과 새 표시 허가는 별개이며 삭제된 연결 원문을 ACK 처리로 복원해서는 안 된다.

v1 없는 버전은 legacy, v2는 신규 session `collectionSpecVersion=2.0`, AI `apiContractVersion=2`. 시작 Idempotency-Key는 goal+규격 버전 모두 비교해야 한다. session의 규격과 AI DTO/Window size/model output을 함께 고정한다. 5개 확률 응답을 v2 3개 pageResults로 수용하거나 v2 실패를 v1 fallback으로 처리하지 않는다.

## 7. P6 라벨·보존·동의 승인 요청

목표는 20작업·10참여자·시나리오160세션·세션당 유효10방문 이상·유효 Window1200 이상·별도 자연20~40세션·평가자3명·목표 split12/4/4로 유지한다. 160×8=1280은 구조상 상한의 출발점이며 실패/철회/UNJUDGEABLE 제외 후 실수량을 확인한다. 참여자의 모든 자료가 같은 split일 필요는 없으나 **같은 목표**의 모든 자료는 같은 split이며 새 참여자 일반화 평가로 과장하지 않는다.

Page 정답은 당시까지의 선행 문맥+목표+페이지로 판단하고 미래 방문을 숨긴다. Window 정답은 최초 성공 BE 판단의 실제 snapshot으로 고정, state 정답은 각 실제 버전 snapshot이다. 실패로 최초 성공이 없으면 reference를 합성하지 않고 제외/판단불가 사유를 기록한다. 지연된 최초 성공은 분석 지연에 의한 선택편향과 `delayedReference`로 보고한다. AI가 동일 visit에 Window별 다른 예측을 하면 `(analysisId,visitId)`로 보존하고 전역 사람 정답을 덮지 않는다.

UNJUDGEABLE 포함 네 범주로 3인 독립표를 보존하고 합의는 별도 저장한다. κ는 조정 전 완전한3표 항목에만 계산, 세 명 모두 판단 가능한 표본의 세 범주 κ/제외수도 보고한다. 합의표나 AI 예측으로 κ를 만들지 않는다. Window와 동일 state snapshot을 중복 가중하지 않는다. `Manifest` 형식 검증 외 실제 JSONL checksum/rowCount/FK/goal split/삭제 revision 및 동의 유효성 검증이 필요하다. blind 파일에는 예측·rationale·시나리오·자동 후보라벨을 넣지 않는다.

| 미확정 대상 | 필요한 외부 근거·결정 | 승인/확인 주체 | 적용 파일·차단 범위 |
| --- | --- | --- | --- |
| 보존기간·종료 후 처리 | 연구 목적·기간, 학교/기관 공식 보존·파기 규정, 저장소/백업 주기·외부 사본 inventory. 실제 문서명·버전·URL/일자를 확보 | 연구책임자/지도교수+기관 개인정보 담당 | 수집규격·P2 회수·manifest/운영 절차. 임의 일수 확정 금지 |
| 참여·평가·제공 동의 | 수집 항목/목적·가명 연결표·열람/철회 창구·Export 수신범위·학습/파생 처리 및 승인된 설명문/양식 | 연구책임자+개인정보 담당, 참여자의 실제 동의 별도 | consentPolicyVersion/접근권한/철회 도구. 형식 문자열로 동의 완료 주장 금지 |
| 기관/연구심의 적용 여부 | 연구계획과 모집/수집 방식을 제출해 학교/기관 담당의 적용·비적용 판단 근거 확보. 미확인 상태에서 면제/승인 주장 금지 | 학교/기관 연구심의 담당. 팀 단독으로 대신하지 않음 | 실사용자 파일럿·본수집·외부 Export·학습 BLOCKED |
| 원본·파생·Export·학습/백업 삭제 | 각 저장소 기간/관리자/철회 전파·증명 방식·실패시 격리·모델 영향 처리 승인 | BE/AI/데이터 운영 담당+기관 개인정보 담당 | 최소 tombstone 포함 보존대장, 수신자/모델 lineage. PURGED 집계 전 미완료 유지 |

여기에는 법 적용이나 기관 승인 여부에 관한 확정 판단이 없다. 해당 기관의 실제 자료와 담당 확인이 미확보다. 합성 Fixture/오프라인 프로토타입 검토는 진행할 수 있다.

## 8. 후속 구현 Issue 초안과 의존성

아래 식별자는 **문서 내 작업 묶음**이며 GitHub Issue 번호가 아니다. 자동 생성하지 않았다. 세부 팀 승인 후 합성 데이터 구현을 진행할 수 있지만, BLOCKED는 실제 활성화의 별도 gate다.

| 묶음·영역 | 독립 범위 / 완료 증거 | 선행 | 승인 후 갱신할 자료 |
| --- | --- | --- | --- |
| A 공통·기관 승인 | §2 선택/대안·실명 승인자/시간/근거·P6 공식자료, timeout/batch 운영값 | 이 PR 검토 | 결정안·승인대장·규격·Schema/Fixture의 승인된 항목만 |
| B BE 버전·저장 기반 | session negotiation+키 충돌, watermark/job/receipt/outbox/state/alert 확장 migration **설계·구현**, legacy 회귀 | P2/P4/P5 기술 승인 | BE 명세·API/DB 계약·migration 검증 |
| C AI v2 API | 모델 독립 compose3/stride1, v2 페이지 label·검색어 경로·입력/출력/오류 검증, 캐시 격리 인터페이스 | P2/P4 기술 승인·Schema | AI 명세·교차언어 fingerprint·API 사례 |
| D BE 구성·판단·알림 | cursor/privacy CAS·원자 저장/복구, suffix/이력·전체포함 dirty·최신조회·state 알림키 | B+C, P5 승인 | BE/공통 계약·지연/종료/역순 통합 증거 |
| E 개인정보 전파 회수 | 소유권/API/tombstone 우선·END 예외·DB/AI 캐시/Export/모델/백업 inventory·삭제 증거 | P2/P6 기술·기관 절차 승인, B+C의 회수 hook | 회수/보존대장·운영 훈련. 준비 전 조기 전송 BLOCKED |
| F FE 측정·영속 | P1 대상·monotonic/관측·5초/5분·새IDB/compaction·ACK/retry/END_PENDING·회수 제어 작업 | P1~P3 승인·B API, E 회수 수용(운영 gate) | FE 명세·실제 Chrome/권한/quota/재시작 증거 |
| G 데이터/평가 도구 | blind 3인/합의·κ·reference snapshot·goal split·manifest/lineage·v2 loader | P6 기술 승인, B/D snapshot. 실데이터는 A+E | 수집규격·라벨 가이드·Export 검증 |
| H 통합 파일럿·활성화 | FE/BE/AI v1/v2 격리·실제삭제/알림/복구·성능·플랫폼 경계검증 및 팀 활성화 결정 | A~G 완료·BLOCKED 해제 | 검증보고서·활성화 승인 URL |

미승인 상태에서 가능한 것은 계약 리뷰·합성 정적 검증·비배포 프로토타입 검토·외부 근거 수집이다. 이번 Issue에서 B~H 제품 구현·migration·실수집·학습을 수행하지 않는다. B/C/G의 합성 도구 작업을 E 운영 삭제 완료와 불필요하게 순환 의존시키지 않으며 실제 운영 활성화에서 합류시킨다.

승인은 정책별로 기록한다: `정책/세부항목`, `선택한 대안`, `패키지 버전/commit`, `승인자와 권한 영역`, `승인 일시+시간대`, `근거 URL`, `조건/후속 작업`, `상태`. 이 빈 형식을 승인 기록으로 간주하지 않는다. 일부 승인 시 해당 행과 영향 파일만 바꾸고 P2/P6 BLOCKED는 충족 증거가 있을 때 별도로 해제한다.

## 9. 수정 이유와 검증 한계

문서의 승인 오인·SPA 조건·tombstone/replay 우선순위·END 회수 예외·구성 revision 범위·판단 stale commit·PURGED 완료 의미를 바로잡았다. wire endpoint/body는 유지하고 Schema에서 성공 snapshot>=5000과 명시 가능한 중복 ID 제약만 강화했다. 정책은 여전히 PROPOSED다. 상세 실행 명령·사례 수·결과는 [검증 보고서](data-contract-validation.md), API 필드 단일 기준은 [계약 패키지](contracts/v2/README.md)다.

정적 계약 모델의 PASS와 실제 Chrome/DB/FK/HTTP/모델/개인정보 삭제 검증은 구분한다. 이번에는 전자를 실행하며 후자의 제품 테스트·실수집·학습은 실행하지 않는다. 변경하지 않은 프로젝트 원계획과 기존 제품 테스트 기대값도 보존한다.
