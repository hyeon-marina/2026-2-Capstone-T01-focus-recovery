# 인증·동의 API — Issue #95

## #97 추가 경계

서버의 인증 검증·동의/철회 DTO는 그대로다. 별도의 [수집 관리 API](collection-operations-api.md)가 기본 비활성 관리 설정 + DB 역할 + 현재 인증을 모두 확인하여 신뢰된 등록·Credential 발급/폐기·배정·진행률을 제공한다. 역할은 non-web bootstrap으로만 최초 생성하고 기본 관리자/Token은 없다. 아래 “운영 issuer 미구현”은 #95 당시 상태이며 실제 등록 주체·위임·기관/동의/보존 및 운영 활성화는 여전히 BLOCKED다.


기존 `v2/v2.schema.json`의 수집·분석 Wire와 별도인 인증/동의 DTO 계약이다. P1~P6 PROPOSED, P2/P6 BLOCKED는 바뀌지 않는다. 운영 등록·토큰 발급 API와 승인 정책 Seed는 제공하지 않는다.

## 인증과 접근

모든 `/api/**` 제품 요청에 `Authorization: Bearer <opaque credential>`가 필요하다. 데이터 없는 `/api/health`만 제외한다. 서버는 SHA-256 해시, 참여자 FK, ACTIVE 주체, 만료와 폐기를 DB에서 확인한다. UUID, sessionId, 클라이언트 participantId, Cookie는 인증 수단이 아니다. HTTPS가 필요하며 정확한 단일 `test` 프로필의 loopback HTTP만 합성 검증 예외다. 토큰은 URL·로그·응답·분석 Payload에 넣지 않는다.

세션 리소스 경로의 `sessionId`는 MVC가 해석한 경로 변수로 DB 소유권을 확인한다. 존재하지 않는 세션과 타인/소유자 없는 세션은 동일한 404 `SESSION_NOT_FOUND`다. 잘못된 UUID는 인증 이후 400이다. Visit/Window/Analysis/Alert도 서버에서 해당 세션 소속을 재검사한다. 기존 v1에도 같은 인증·소유권 경계를 적용한다.

- 401: 인증 없음/위조/만료/폐기. `WWW-Authenticate: Bearer`.
- 403 `INVALID_REQUEST`: 현재 유효한 서버 동의로 이 세션을 사용할 수 없음.
- 기존 개인정보 격리: 409 `PRIVACY_RETRACTED`가 동의 검사보다 우선한다. 분석 상태 조회는 철회된 동의를 403으로 차단한다.
- 인증·동의 실패에서 v1이나 임시 사용자로 fallback하지 않는다.
- 일반 오류는 기존 `{code,message,fieldErrors}`를 유지한다. Visit 회수의 401은 기존 v2 envelope도 유지한다. 공통 Schema/Fixture는 수정하지 않았다.
- 민감한 정책/DB/Token 오류 원문을 반환하지 않고 `Cache-Control: no-store`를 적용한다.

## 새 Endpoint

| Method / 경로 | 요청 | 응답 |
| --- | --- | --- |
| GET `/api/auth/me` | 없음 | 200 `{participantId,expiresAt}` |
| POST `/api/auth/logout` | 사용하지 않는 본문 또는 없음 | 204, 사용한 credential 서버 폐기 |
| GET `/api/consent` | 없음 | 200 ConsentState |
| POST `/api/consent` | ConsentAccept | 200 현재 ConsentState |
| POST `/api/consent/withdrawals` | `{requestId: UUID v4}` | 202 WithdrawalReceipt, Replay도202 |
| GET `/api/consent/withdrawals/{id}` | 부모 withdrawalId | 200 본인 WithdrawalReceipt, 타인/없음404 |

Timestamp는 이 별도 DTO에서 ISO-8601 UTC Instant다. 기존 수집 Wire의 정확한 UTC 밀리초 형식은 그대로다. 동의·철회 요청은 추가/중복 JSON 필드를 거절한다. 클라이언트가 주체를 지정하는 필드는 없다.

## 동의 DTO

ConsentAccept:

```json
{"requestId":"95000000-0000-4000-8000-000000000095","policyId":"SYNTHETIC-EXAMPLE","policyVersion":"1","accepted":true}
```

이는 문서용 합성 예시이며 실제 동의 기록이나 승인 정책이 아니다.

ConsentState 필드:

- `participantId`: 인증된 가명 주체.
- `policy`: Policy 또는 null.
- `consentId`: 현재 유효한 본인 기록 또는 null.
- `consentValid`: 현재 정책·주체·철회 상태의 서버 판정.
- `collectionEnabled`: 유효한 동의 + 정확한 단일 test 프로필 + 기존 storage flag. 운영 활성화 승인이 아니다.
- `withdrawn`: 전체 철회 또는 주체 비활성 여부.

Policy는 `policyId,policyVersion,scope,purpose,collectionItems,useScope,retentionPolicyRef,approvalRef,status,effectiveAt`이다. 범위 `SESSION_COLLECTION`은 명시적으로 인증된 v1/v2 세션 수집 경계다. 테스트 내용은 닫힌 합성 카탈로그만 설명한다. `DRAFT/SYNTHETIC/APPROVED/RETIRED` 상태를 지원한다. 합성 정책은 정확한 test 프로필에서만 사용할 수 있다. APPROVED라도 승인·보존 정책 참조가 모두 없으면 유효하지 않다. 최신 적용 정책이 DRAFT/RETIRED이거나 적용 시작 시각이 같은 정책이 둘이면 이전 동의로 되돌아가지 않고 차단한다. 실제 승인 정책은 Seed하지 않는다.

동의는 `(주체,정책ID,정책버전)`당 첫 기록을 보존한다. 같은 requestId는 동일 요청으로 처리하고 다른 requestId의 동일 정책 동의는 기존 consentId를 유지하면서 이벤트를 남긴다. 정책이 바뀌면 재동의가 필요하며 기존 세션의 consentId를 자동 교체하지 않는다. 전체 철회 후 이전 동의를 재활성화하지 않는다. 새로운 참여 절차는 별도 승인 대상이다.

## 전체 철회 DTO

WithdrawalReceipt:

- `requestId`: POST의 요청 ID echo. 동시 다른 요청 ID도 각각 echo한다.
- `withdrawalId`: 주체별 단일 부모 작업 ID. 같은 주체의 여러 동시 요청은 같은 부모를 공유한다.
- `status`: 항상 `QUARANTINED`.
- `sessions`: `{sessionId,status,attempts,errorCode}[]`. 상태 `PENDING/INVENTORIED/BLOCKED`.
- `targets`: `{retractionId,targetType,targetId,processingStatus,evidenceCode,errorCode,attempts,verifiedAt}[]`. #93 대상별 상태이며 VERIFIED도 좁은 기술 작업의 증거다.
- `unmet`: 보존 승인·FE 사본·Export/학습/로그/백업·AI 전 Worker/모델 영향 등의 미충족 항목.

주체 잠금으로 동의·생성·중복 철회를 직렬화한다. 모든 소유 세션을 순서대로 잠가 ACTIVE/ENDED/방문0개도 즉시 격리한다. 부모/세션 대상/철회 이벤트와 수집 차단은 한 트랜잭션이다. 세션별 후속 Inventory는 별도 재시작 가능한 트랜잭션이며 Visit별 결정적 UUID v4의 #93 작업에 연결한다. v1 세션도 격리하되 기존 #93 v2 삭제 파이프라인으로 처리했다고 꾸미지 않고 `V1_PAYLOAD_REVIEW_REQUIRED`로 BLOCKED한다.

부모 재시작 복구는 PENDING 검색, 실패는 고정 코드와 attempts 기록, 재처리 후에도 격리 유지다. DB Inventory는 외부 HTTP를 잠금 중 호출하지 않는다. #93 Claim/Lease/Retry, Tombstone/Revision, AI Journal, 외부 증거 BLOCKED, PURGED 금지를 재사용한다. MySQL에서는 회수 대상 조회를 잠금 기반 최신 읽기로 처리하여 철회 시작 전 Snapshot이 직전 표시 ACK/새 분석을 덮어쓰지 못하게 한다.

## 내부 AI 인증

BE v2 HTTP는 별도의 서비스 Credential을 Bearer로 전달한다. BE `focus-recovery.v2.dispatch.service-token`과 AI `AI_V2_SERVICE_TOKEN`은 기본 비어 있으며 동일한 신뢰 경계에서 관리해야 한다. 사용자 Credential은 AI로 전달하지 않는다. AI는 v2 구성·분석 전에 상수시간 비교하고, 미설정/오류는401이다. 기존 합성 Gate도 계속 필요하다. 실제 내부 회수 Route는 제품 main에 설치하지 않으며 테스트 fixture에서만 별도 Journal/Secret으로 설치한다.

운영 issuer/enrollment·Credential 전달/회전·TLS/프록시·서비스 Secret 배포·기관 절차는 아직 준비되지 않았다. 환경변수만으로 승인 정책·동의·제품 삭제 실행 권한을 만들 수 없다.


## #99 승인된 배포 경로

기존 합성 exact-test 경로는 유지합니다. `real-collection` 단일 프로필에서는 storage flag에 더해 read-only 승인 파일의 digest/build/기간·계약/기관/보존/모델/개인정보/시작 근거, 독립 `collection_release` 미폐기 DB승인, 현재 APPROVED 동의 정책 일치를 요구합니다. consent.collectionEnabled는 이 경로도 검증합니다. `GET /api/collection/site-policy`는 인증된 클라이언트에 digest/buildId/policyId/policyVersion/status/expiresAt/sites를 반환하며 FE는 빌드와 일치시킵니다. 실제 수집 신규 세션은 확정 배정에서만 시작하며 생성 요청의 X-Collection-Build를 session_collection_scope에 고정합니다. 실수집 프로필의 v1/일반 생성으로 우회하지 않습니다. 현재 실제 승인 기록은 없어 BLOCKED입니다.

제품 AI 수집 엔트리 `collection_main:app`에는 서비스 인증된 영속 Journal 회수 경로가 있습니다. 단일 private Worker·동일 배포 정책·원래 모델의 offline 로딩을 요구합니다. 기존 v1 main과 합성 fixture는 유지합니다. QUARANTINED가 전체 삭제 완료는 아닙니다. [#99 저장 구조](../data-collection/data-flow-and-storage.md)와 [운영 가이드](../data-collection/operator-guide.md)를 따릅니다.
