# 참여자 실행 안내

정책 v6의 수집 항목, 기존 v5 환경의 갱신·재동의, 격리 세션 마감과 재수집 절차는 [실제 페이지 수집 가이드](page-content-collection.md)를 확인한다.

[15단계 설치·수집 명령](individual-local-setup.md)을 순서대로 수행한다. A/B/C는 자신의 PC와 Chrome 프로필만 사용한다. 공통 정책은 CONFIRMED, Plan revision1이며 본인 슬롯은54/53/53개다. `records.json` 또는 `policy-prepare`는 필요 없다.

1. 필수 프로그램 설치 후 공식 main을 받는다.
2. FE 의존성 설치·Backend bootJar 빌드 후 `python3 tools/individual-local/local.py setup --slot A`를 실행한다(B/C는 본인 슬롯). Windows는 `python`을 사용한다.
3. `python3 tools/individual-local/local.py build` 후 fe/dist-real을 Chrome에 로드하고 로컬 인증서를 신뢰한다.
4. 본인 participant.json으로 로그인하고 슬롯·정책·목표를 확인한 뒤 직접 동의한다.
5. 본인 동의·정책/Build 확인 후 준비 완료가 표시되면 목표·시나리오를 선택하고 세션을 시작한다.
6. 허용 공개 사이트에서 의미 있는 유효 Visit10개 이상(권장12~15개)을 수집한다.
7. 종료 후 Queue=0·END ACK·전송 확인·RAW_COLLECTED·AI NOT_RUN을 확인한다.
8. age Export와 최신 privacy를 통합 담당자에게 전달한다. 개인키·Credential은 전달하지 않는다.

기관 심의·승인이 필요하지 않다는 사용자의 직접 확인 결과를 NOT_REQUIRED로 반영했다. [운영 기록](institution-not-required.md)은 전달 경로와 미제공 항목을 구분하며 공식 승인서가 아니다. 기관 차단은 해제됐고 각 참여자가 직접 동의해야 한다. 실제 외부 파일럿 수행 여부는 [이번 실행 보고](institution-not-required-validation.md)에 구분한다.

공개 페이지의 실제 제목·본문과 허용된 Google·Naver 검색어를 저장한다. 공개 이메일과 국내 휴대전화 번호는 저장 전에 마스킹한다. 구독 제한 등으로 본문을 수집할 수 없으면 해당 방문을 제외하고 계속한다. 비밀번호·Cookie·Token·계정/로그인·메일함·메신저·개인 문서·금융·의료·비공개 콘텐츠·폼 입력값은 수집 대상에서 제외한다. 영상/음성/자막/댓글 원문도 제외한다. 실제 민감 페이지를 발견하면 즉시 중단한다. 전체 동의 철회 버튼은 신규 수집을 중단하고 기존 데이터를 격리한다. 외부 사본 회수·삭제 확인은 운영 기록으로 남긴다.
