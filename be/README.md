# Backend

Focus Recovery의 Backend 영역입니다.

Chrome Extension에서 전달한 작업 목표와 탐색 정보를 작업 세션 단위로 관리하고,
최근 탐색 구간을 Python AI Service에 전달하여 분석을 요청합니다.

또한 AI 분석 결과, 실제 표시된 알림, 사용자 선택 결과를 서로 연결하여 저장합니다.

## 주요 기능

Backend 영역은 다음 기능으로 구성됩니다.

### BE-001 세션 생성

사용자가 입력한 최초 작업 목표를 기반으로 새로운 작업 세션을 생성합니다.

세션은 이후 Page Visit, 탐색 구간, AI 분석 결과, 알림 및 사용자 선택을 연결하는 기준이 됩니다.

### BE-002 세션 종료

활성 작업 세션의 종료 시각을 기록하고,
종료 이후 새로운 탐색 기록과 분석 요청이 해당 세션에 연결되지 않도록 처리합니다.

### BE-003 방문 기록 저장

Chrome Extension에서 전달한 분석 대상 페이지를
Page Visit 단위로 작업 세션에 연결하여 저장합니다.

주요 정보는 다음과 같습니다.

- 정규화 URL
- 도메인
- 페이지 제목
- 제한된 페이지 본문
- 검색어
- 방문 순서
- 방문 시각
- 활성 체류시간
- 탭 전환 정보

### BE-004 AI 분석 요청 및 응답 처리

최근 5개의 유효 Page Visit으로 구성된 탐색 구간과
해당 세션의 최초 작업 목표를 Python AI Service에 전달합니다.

AI Service가 반환한 분석 결과를 검증한 뒤
정상적인 결과만 저장 처리로 전달합니다.

### BE-005 사용자 선택 결과 저장

목표 재제시 알림 이후 사용자가 선택한 결과를 저장합니다.

사용자 선택은 다음 두 가지입니다.

- `RETURN_TO_GOAL`
- `CONTINUE_BROWSING`

사용자 선택은 AI 분석 결과가 아니라 실제 표시된 알림의 `alertId`에 연결합니다.

### BE-006 탐색 행동 정보 갱신

Page Visit 생성 이후 측정된 탐색 행동 정보를 기존 방문 기록에 반영합니다.

주요 정보는 다음과 같습니다.

- 활성 체류시간
- 탭 전환 정보

행동 정보는 매초 전송하지 않고,
페이지 이탈, 탭 전환, 작업 종료 등 의미 있는 이벤트를 기준으로 갱신합니다.

### BE-007 AI 분석 결과 저장

AI Service가 반환한 최종 분석 결과를
해당 작업 세션과 탐색 구간에 연결하여 저장합니다.

주요 결과는 다음과 같습니다.

- `pNormal`
- `pTransition`
- `pDrift`
- `result`

최종 상태는 다음 세 가지 중 하나입니다.

- `NORMAL`
- `TRANSITION`
- `DRIFT`

### BE-008 알림 이벤트 저장

사용자에게 실제로 표시된 목표 재제시 알림을 저장합니다.

알림 유형은 다음과 같습니다.

- `AI`
- `FIXED_INTERVAL`

AI 분석 결과가 `DRIFT`이더라도
실제로 사용자에게 알림이 표시되지 않았다면 표시된 알림 횟수에 포함하지 않습니다.

### BE-009 탐색 구간 구성

같은 작업 세션의 최근 5개 유효 Page Visit으로
AI 분석 단위인 탐색 구간을 구성합니다.

```text
Window Size: 5
Stride: 1
```

새로운 유효 Page Visit이 추가될 때마다
최근 5개 방문으로 새로운 탐색 구간을 생성합니다.

```text
P1 P2 P3 P4 P5       → Window 1
   P2 P3 P4 P5 P6    → Window 2
      P3 P4 P5 P6 P7 → Window 3
```

## 처리 흐름

```text
작업 세션 생성
      ↓
Page Visit 저장
      ↓
탐색 행동 정보 갱신
      ↓
최근 5개 방문으로 탐색 구간 구성
      ↓
AI Service 분석 요청
      ↓
AI 분석 결과 저장
      ↓
DRIFT 판단
      ↓
목표 재제시
      ↓
실제 알림 이벤트 저장
      ↓
사용자 선택 결과 저장
```

## 주요 데이터 관계

Backend에서는 다음 데이터가 서로 연결됩니다.

```text
WorkSession
   ├── PageVisit
   │     └── AnalysisWindow
   │            └── AnalysisResult
   │
   └── Notification
           └── NotificationResponse
```

AI 기반 알림은 관련 `AnalysisResult`와 연결되며,
고정 주기 알림은 AI 분석 결과 없이 작업 세션에 직접 연결됩니다.

## AI Service 연동

Backend는 AI Service에 다음 정보를 전달합니다.

- `sessionId`
- `windowId`
- 최초 작업 목표
- 최근 5개의 Page Visit
- 페이지 제목 및 본문
- 검색어
- 방문 순서
- 활성 체류시간
- 탭 전환 정보

실제 API 경로, 요청·응답 구조, 오류 코드,
timeout 및 재시도 정책은 API 설계 단계에서 확정합니다.

## 처리 원칙

- AI 통신 실패를 정상 분석 결과로 처리하지 않습니다.
- 분석 실패 시 임의로 `NORMAL`, `TRANSITION`, `DRIFT`를 생성하지 않습니다.
- AI 분석 실패가 사용자의 작업 세션을 중단시키지 않도록 합니다.
- 종료된 세션에 늦게 도착한 분석 결과는 새로운 알림에 사용하지 않습니다.
- AI 분석 결과 저장과 실제 알림 표시 기록을 구분합니다.
- 사용자 선택은 `analysisId`가 아닌 `alertId`에 연결합니다.
- 동일한 방문 조합의 탐색 구간과 동일 분석 결과가 중복 생성되지 않도록 처리합니다.

## 개발 상태

현재 Backend 영역은 기능 설계가 완료된 초기 개발 환경 구성 단계입니다.

Spring Boot 프로젝트 구조, 의존성, 데이터베이스 구성,
실행 방법 및 테스트 방법은 Backend 개발 환경 구성이 완료된 이후 본 문서에 추가합니다.
현재 개인 수집 정책 v5는 실제 제목·최대5,000 Unicode 본문·허용된 검색어를 수집합니다. HMAC URL/기존 동의·격리·전송 계약과 함께 `pageContent`를 검증하며 이전 정책은 호환 경로로 유지합니다. [설치·재동의·데이터 계약](../docs/data-collection/page-content-collection.md), [실제 E2E·회귀 검증](../docs/data-collection/page-content-validation.md).
