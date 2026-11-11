# 수집 데이터 확인·검증 — Issue #99

실제 사용자 수집은 BLOCKED입니다. 검증은 승인된 관리 권한으로 수행하며 원문/검색어/Credential을 출력하지 않습니다. [저장 구조](data-flow-and-storage.md)와 [현재 실행 증거](real-collection-validation.md)를 함께 봅니다.

참여자는 확장 화면에서 **서버 수신 Visit**, 미완료 POST/PATCH, 종료 ACK, 미전송 알림 영수증과 **나의 진행**을 확인합니다. `ENDED`/종료 ACK만으로 완료가 아닙니다. `QUALITY_PASSED`는 종료·10개 이상 유효 Visit·ordered3/stride1 Window 전체·각 AI 성공·최신 상태 이력·decision dirty 없음·전송 보고·privacy CLEAR를 함께 검사한 결과입니다. 참가자간 조회는 차단됩니다.

운영자는 기존 CLI를 재사용합니다. 아래 `$COLLECTION_SERVER`는 운영자가 실제 확인한 HTTPS origin이고 이 문서는 임의 공용 주소를 만들지 않습니다. `$OPERATOR_CREDENTIAL_FILE`은 mode600 발급 파일입니다. 값을 명령행에 직접 붙이지 않습니다.

```sh
python3 tools/collection/manage.py --server "$COLLECTION_SERVER" \
  --credential-file "$OPERATOR_CREDENTIAL_FILE" progress
python3 tools/collection/manage.py --server "$COLLECTION_SERVER" \
  --credential-file "$OPERATOR_CREDENTIAL_FILE" plan
python3 tools/collection/manage.py --server "$COLLECTION_SERVER" \
  --credential-file "$OPERATOR_CREDENTIAL_FILE" audit
```

관리 API `/api/collection/admin/progress`와 본인 `/api/collection/progress`는 전체 planned160, 실제 actualSessions/endedSessions/completed, syntheticSessions/syntheticQualityPassed, inProgress/failed/recollectRequired/quarantined, 유효 Visit/Window, 추출 실패·AI 성공/실패와 참여자/목표/시나리오별 그룹을 반환합니다. 실제 completed는 최신 **PARTICIPANT** source의 PLAN별 품질 통과 수입니다. 합성은 따로 계산합니다. 집계의 validVisits/validWindows/analysisSuccess는 최종 포함 가능한 품질 통과 실제 세션 기준이고 진행 중·실패의 개별 수는 attempts[].quality에서 확인합니다.

원문 없는 읽기 전용 SQL은 [`tools/collection/verify.sql`](../../tools/collection/verify.sql)에 있습니다. 실제 V1~V16 테이블로 참여자별 세션, 유효 Visit/sequence·ID 중복, Window/member, 분석 성공/실패, 상태 이력, 실패 코드, 격리·Tombstone·배포 폐기를 확인합니다. DB read-only 사용자를 준비하고 클라이언트 설정 파일에 비밀번호를 보관합니다. SQL 검증은 서버 품질 계산을 대체하지 않습니다.

```sh
# DBA가 만든 읽기 전용 계정의 신규 owner-only client 설정 사용. 비밀번호를 -p 인수에 넣지 않음.
mysql --defaults-extra-file="$READ_ONLY_MYSQL_CONFIG" --batch \
  focus_collection < tools/collection/verify.sql
```

전용 Compose 내부의 관리자 검증 대안입니다. 운영 DB에서 임의 수정 SQL을 실행하지 않습니다.

```sh
docker compose -p "$COLLECTION_PROJECT" --env-file "$COLLECTION_ENV_FILE" \
  -f deploy/collection/compose.yml exec -T mysql sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql-root)"; export MYSQL_PWD; exec mysql -uroot --batch focus_collection' \
  < tools/collection/verify.sql
```

`verify.sql`의 중복 sequence·Window member 오류 질의는 정상 CLEAR 세션에서0행이어야 합니다. 최소10 Visit·8 Window는 정확히10개일 때의 예시이며 12개는10 Window입니다. sequence 공백은 허용하므로 `MAX(sequence)=COUNT(*)`를 일반 품질 규칙으로 강제하지 않습니다. ordered member/AI/state 누락은 progress 품질 reasons를 우선합니다. 전송 미완료는 FE Queue에서만 정확히 관측되며 서버는 END 이후 visitCount/lastSequence와 DB를 비교한 전달 보고만 확인합니다. 서버가 브라우저의 숨은 Queue를 직접 읽는다고 해석하지 않습니다.

문제별 대응:

- `VISITS_BELOW_10`: 추출 성공·활성 실측 조건을 확인합니다. duration을 수동 증가시키지 않습니다.
- `WINDOW_COUNT_MISMATCH`, `VISIT_WINDOW_REFERENCE_INVALID`: compose cursor/job/receipt와 ordered member를 조사합니다. Window를 수동 INSERT하지 않습니다.
- `ANALYSIS_OR_STATE_INCOMPLETE`: analysis/outbox의 FAILED/error_code와 decision_dirty를 확인합니다. 실패를 정상 결과로 바꾸지 않습니다. 실모델 timeout/자원 한도를 점검한 뒤 담당자가 재수집 검토를 기록합니다.
- 전송 미확인: 같은 계정으로 **재전송 / 복구**. Credential 만료·정책 digest 변경·폐기는 운영자 검토가 필요합니다. 새 계정으로 이전 Queue를 보내지 않습니다.
- QUARANTINED/철회: source가 실제/합성인지와 무관하게 수집 품질 실적에서 제외합니다. 보호된 철회 원장 및 외부 사본 대조를 완료하기 전 PURGED로 변경하지 않습니다.

정상 예시 **SYNTHETIC**: 실제 Chrome의 일반 HTML Adapter로 가상 공개 텍스트10개를 실측했습니다. SPA, Worker 중지, Chrome 전체 재실행 후 같은 계정 재인증을 포함합니다. POST10개가 실제 Spring/MySQL에 저장되었고 AI 구성으로 ordered Window8개가 생겼습니다. 실제 FastAPI를 사용했지만 FakeEmbedding/FakeContext이며 실제 모델 품질 증거가 아닙니다. 고의 합성 UNRELATED 출력으로 BE DRIFT·표시/선택 ACK도 검증했습니다. END ACK 및 Queue drain/전달 보고 뒤 `syntheticQualityPassed=1`, `completed=0`, `actualSessions=0`, Visit10/Window8이었습니다. 전체 철회 후 동일 attempt는 QUARANTINED이고 실제 completed는 계속0입니다.

검증 원본은 `fe/scripts/real-browser-test.mjs`, `CollectionRealHtmlHttpTest`, 기존 `CollectionLiveHttpTest`입니다. [실제 합성 화면](evidence/issue99-ten-visits.png)은 철회 전 상태이며 [철회 화면](evidence/issue99-withdrawal.png)과 구분합니다. 테스트용 ID는 실제 참가자 ID가 아닙니다. 단일 예시를160개 실제 세션으로 확대 계산하지 않습니다.

백업 복원 후에는 새로 복원한 격리 DB에 최신 [`retraction-ledger.sql`](../../tools/collection/retraction-ledger.sql) 원장을 적용하는 [`restore-quarantine.py`](../../tools/collection/restore-quarantine.py) 생성 SQL을 검토·실행합니다. 모든 collection_release는 폐기 상태로 남습니다. 최신 원장의 출처·철회 이후 사본·AI journal을 대조한 뒤 별도 승인이 있어야 재개할 수 있습니다.
