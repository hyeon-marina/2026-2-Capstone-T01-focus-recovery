# 실제 제목·본문·검색어 수집 — 정책 v5

현재 기준은 TEAM_POLICY.json의 `pageContent=true`, 버전5, RAW_ONLY다. 기관 판단 NOT_REQUIRED, Plan revision1, 20목표·160세션·A54/B53/C53은 그대로다. #105~#110 문서의 METADATA_ONLY/Topic 설명은 **과거 버전의 필드 의미**이며 새 수집의 의미가 아니다.

기존 v4 세션을 먼저 종료하고 Queue0·END ACK를 확인한다. 본인 PC에서 다음 명령을 실행한다. B/C는 자신의 슬롯을 사용한다.

```sh
git switch main
git pull --ff-only origin main
npm ci --prefix fe
cd be
./gradlew bootJar
cd ..
python3 tools/individual-local/local.py setup --slot A
python3 tools/individual-local/local.py build
python3 tools/individual-local/local.py status
```

setup은 알려진 공식 v2/v3/v4 정책의 **기존 파일 SHA를 검증한 뒤** 새 공식 정책을 설치한다. 커스텀 정책은 자동 덮어쓰지 않는다. DB·기존 실적·Participant ID·Credential·Plan을 보존하며 같은 policyId/version의 다른 bytes는 거절한다. 확장 프로그램을 새로고침한 다음 Credential로 로그인하고 **새 수집 항목을 읽고 직접 재동의**한다. 이전 동의는 새 정책에 유효하지 않다. 기록 파일·policy-prepare·관리자 승인은 필요 없다.

## 수집과 제외

- 제목: document.title, 비어 있으면 og:title. 공백·제어 문자를 정리하고 Unicode code point 500자까지 수집한다. 빈 제목/Loading은 성공으로 처리하지 않는다.
- 본문: 기존 DOM 추출기를 확장해 main/article/role=main/문서·블로그·기사 본문을 선택한다. 메뉴·광고·숨김·폼·편집가능 영역·입력값·댓글은 제외한다. 일관된 주요 영역을 식별할 수 없는 문서는 실패로 남긴다. Readability를 추가 의존성으로 도입하지 않고 기존 추출기를 유지하여 기존 제외 규칙을 보존했다.
- 전체 추출 영역을 개인정보 검사한 뒤 중복 행·공백을 정리하고 최대5,000 **Unicode code point**로 제한한다. FE는 Array.from/전개, Java는 codePointCount, Python은 len을 사용한다. UTF-16 unit이나 byte 제한으로 바꾸지 않는다.
- Google /search의 q, Naver /search.naver의 query를 실제 검색 결과에서만 디코딩·정규화한다. 최대500자·단일 파라미터이며 민감 검색어·중복 파라미터·누락은 정상 수집으로 처리하지 않는다. Google CAPTCHA 등 접근 제한을 우회하지 않는다.
- URL/도메인/인증·결제 DOM/유료 표식/활성 입력과 텍스트의 이메일·전화·주민번호·인증정보·의료/금융 민감 표식을 검사한다. 이 검사는 완전한 익명화기가 아니다. 참여자는 수집 권한이 있는 공개 비민감 주제만 탐색하고, 학습 전 사람이 개인정보와 이용 권한을 검수해야 한다. 원본 공개·재배포는 금지한다.
- 민감 텍스트는 메시지에 포함하지 않고 기존 세션 격리·회수 경로를 사용한다. 일반 제외 URL은 수집하지 않는다. 이미 전송한 세션도 기존 철회·tombstone·최신 privacy 검증을 따른다.

원본 URL은 검사 후 **세션 HMAC 식별자**로 바꾸며 Query/Fragment 원문은 DB·Export에 포함하지 않는다. 검색어는 별도 필드다. 서로 다른 검색어·Query/SPA route는 HMAC 입력에서 구분한다. 기존 metadataOnly 플래그는 식별 URL 계약을 유지하는 호환 필드이며, 새 pageContent 플래그/정책 SHA가 원문 수집 여부를 결정한다.

활성 체류5초, 복귀4초, 첫5분 행동 PATCH, 전송 큐·재시도·중복Visit 방지·END ACK를 유지한다. 1초 pulse는 체류 측정에 사용하고 DOM 추출은 동일 route에서 최소5초 간격으로 제한한다. 늦은 제목/본문은 다음 추출에서 반영하며 **같은 문서/페이지에서 제목 변경만으로 Visit을 추가하지 않는다**. 이미 확정·전송한 Visit의 원문은 멱등성을 위해 고정한다. 새 route/문서/실제 복귀는 기존 방문 경계 규칙을 따른다.

유효 본문 최소50자(검색 결과1자)는 기존 v2 계약을 유지한다. 실패를 가짜 본문/정상 Visit으로 만들지 않는다. 후보의 상태는 EXTRACTION_FAILED, 운영 진단은 EXTRACTION_NO_CONTENT/DOM_ERROR/RENDER_TIMEOUT/ACCESS_DENIED로 구분한다. 민감 페이지는 POLICY/기존 SENSITIVE_CONTENT 격리로 처리한다. 실패 진단에는 제목·URL·본문·검색어를 넣지 않는다. 실패 후 복구되면 새 유효 후보를 측정한다.

## Export/Import 이후 학습 검수 데이터

[merge-guide.md](merge-guide.md)의 export/verify/privacy/merge 절차를 그대로 사용한다. 각 source의 최신 privacy는 최대15분 이내이며, 철회 상태·source/participant·Manifest·SHA·중복Import 레지스트리를 유지한다. 이전 METADATA_ONLY Export도 읽을 수 있지만 이를 학습용 텍스트로 자동 해석하지 않는다.

통합된 `.age` 파일로부터 다음 명령으로 **암호화된 검수 JSONL**을 만든다. 실제 값은 본인 비공개 전달 경로에서 받은 SHA/키/경로를 넣는다. A/B/C privacy를 모두 전달한다.

```sh
python3 tools/individual-local/dataset.py training-review merged.tar.age \
  --sha256 "$MERGED_SHA256" --identity merge.agekey --recipient "$AGE_RECIPIENT" \
  --privacy A-privacy.json "$A_PRIVACY_SHA256" \
  --privacy B-privacy.json "$B_PRIVACY_SHA256" \
  --privacy C-privacy.json "$C_PRIVACY_SHA256" \
  --output review.tar.age
python3 tools/individual-local/dataset.py verify review.tar.age --identity merge.agekey
```

평문 파일은 생성하지 않는다. 복호화·JSONL 생성·age 암호화는 메모리에서 수행하며 크기는 기존256MiB 한도를 따른다. 원문 로그를 켜지 않는다. `review.tar.age`는 review.jsonl·manifest.json·checksums.sha256을 포함한다.

`focus-training-review/1`은 session당1행이다. sourceInstanceId/participantId/sessionId/goalId/goalText/scenarioType, 전체 goal/session, 순서대로 정렬한 원본 visits, 관련 attempts/sessionFailures를 보존한다. visit에는 원래 title/content/searchQuery/extractionStatus/sequence/visitedAt/행동 필드와 원본ID/통합ID가 모두 남는다. 중복·누락·실패 본문은 거절한다. 세션 전체가 과거의 정확한 METADATA_ONLY 표식이면 기존 Import에 보존하고 학습 검수에서 제외하며 manifest.legacyMetadataSessionsExcluded로 수를 기록한다. 혼합/잘못된 표식은 거절한다. 원래 실패 진단은 sessionFailures 및 manifest의 extractionFailures로 별도 검수한다.

windows는 현재 v2의 실제 방문 순서로3개/stride1을 구성하며 sparse sequence를 허용한다. 이는 모델을 호출하거나 DB Window를 생성하는 작업이 아니다. label=null, labels=null, labelStatus=UNLABELLED, privacyReview=REQUIRED다. 계획된 scenarioType을 정답으로 복사하지 않는다. goalId SHA 기반 train/validation/test(8:1:1 bucket)로 나눠 같은 목표의 반복 세션이 다른 split에 들어가지 않게 한다. 부분 데이터에서는 어떤 split이 비어 있을 수 있다. 기존 legacy5개 라벨 학습 loader/AI 알고리즘은 변경하지 않는다. 새 loader/validator는 ai/training/raw_review.py다. 실제 모델 학습·사람의 개인정보 검수·정답 라벨링은 별도 단계다.

검수 산출물 생성 시에도 최신 privacy를 다시 검사한다. 철회/격리/동의 불일치/tombstone 세션은 제외한다. 생성 이후 철회가 발생하면 기존 Export/백업/파생 데이터 회수 절차에 이 산출물도 포함하고 새 privacy로 재생성한다.
