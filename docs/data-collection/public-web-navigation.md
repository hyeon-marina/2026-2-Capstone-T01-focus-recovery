> 현재 실제 텍스트 수집·v6 재동의·설치·학습 변환은 [페이지 원본 수집 가이드](page-content-collection.md)를 따릅니다. 아래 버전별 메타데이터 설명은 당시 동작 기록입니다.

# 전체 공개 웹 탐색 메타데이터 수집

공통 정책 버전 **4**, Build ID **focus-106-public-web-v4**는 `siteScope=PUBLIC_HTTP_HTTPS`와 빈 `sites` 목록을 사용합니다. 특정 15개 사이트·경로 제한 없이 일반 HTTP/HTTPS 공개 웹사이트를 수집합니다. 기존 `institution=NOT_REQUIRED`, Plan revision 1, 목표 20개·160배정·A54/B53/C53, 동의·철회·전송·품질 계약은 유지합니다.

## 기존 A/B/C 환경 갱신

먼저 진행 중인 세션을 종료하고 END ACK를 확인합니다. 본인 슬롯과 기존 개인 디렉터리에서 기존 setup을 재실행합니다.

```sh
python3 tools/individual-local/local.py setup --slot A
python3 tools/individual-local/local.py build
```

Windows는 `python`, B/C는 본인 슬롯을 사용합니다. 기존에 `--directory`를 사용했다면 같은 디렉터리를 지정합니다. 정확한 공식 v2/v3 정책 SHA가 설치된 환경은 setup이 새 공통 정책과 SHA를 자동 적용합니다. 사용자 지정 정책은 덮어쓰지 않으며 [명시적 정책 적용](policy-application-guide.md)을 사용합니다. 계정·DB·배정·이전 실적을 보존하고, 새 정책에 대한 동의는 자동 생성하지 않습니다. Extension을 다시 로드하고 확대된 HTTP/HTTPS 권한을 확인한 후 Credential 파일을 불러와 버전 4에 직접 동의합니다. 추가 기관 판단이나 사이트별 승인 절차는 없습니다.

## 수집 및 제외

Python Docs에서 기술 블로그·뉴스·쇼핑·여행·취미·검색 결과 등 다른 도메인으로 이동했다 돌아와도 같은 활성 세션에 Visit을 기록합니다. 페이지 전환, SPA history/hash 전환, 뒤로 가기, 탭 전환과 활성 체류 측정을 지원합니다. 세션 비활성·미동의·철회 상태에서는 기록하지 않습니다. 유효 방문 기준 5초, 짧은 복귀 4초, Behavior PATCH 기준 5분은 기존과 같습니다.

Cookie/Token/비밀번호/폼 값, 원제목·본문·검색어·URL Query/Fragment 원문은 DB·지속 큐·Export에 저장하지 않습니다. URL은 순간적인 문서 일치·민감 여부 검증에 사용하고 Query/Fragment를 제거한 주소에 세션 범위 HMAC을 적용합니다. 저장 주소는 공개 origin과 `__focus_page__/<HMAC>`뿐입니다. 검색 결과의 호환용 경로 `/search` 또는 `/search.naver`, 검색어 표식 `[NOT_COLLECTED]`는 유지합니다. title에는 기존 23개 고정 Topic만, content에는 기존 METADATA_ONLY 표식만 남깁니다. HMAC 키는 로컬 신뢰 컨텍스트에 보관하고 전송·Export하지 않습니다.

민감 URL/호스트, 개인 통신·계정·금융/결제·의료 경로, IP 리터럴·localhost·내부 호스트·비표준 서비스 포트, 해석 불가능한 인코딩은 제외합니다. 비밀번호/결제/인증 입력·민감 문서 유형·편집 중인 입력 컨트롤 등 기존 DOM 필터를 유지합니다. 민감 문서로 전환하면 해당 Visit 측정을 끊고, 다른 허용 페이지에서 같은 세션을 이어갑니다. 일부 공개 페이지도 보수적으로 제외될 수 있습니다. 공개 도메인이 로컬 DNS에서 내부 IP로 재지정된 경우는 URL 구조만으로 식별할 수 없습니다.

Backend는 HMAC 경로·공개 origin·고정 Topic/본문/검색 표식을 다시 검증합니다. 기존 Visit/Behavior/Export 필드를 유지하며 DB 스키마와 기존 Flyway Migration은 변경하지 않습니다. 기존 Topic 기반 분석 경로도 유지하며 이번 실제 수집 검증은 RAW_ONLY/AI NOT_RUN으로 수행합니다.

## 실제 외부 사이트 검증 재현

```sh
JAVA_HOME=<JDK21> PATH=<JDK21>/bin:$PATH python3 tools/individual-local/run-external-site-e2e.py \
  --automated-test-only --output <새-테스트-디렉터리> --chrome <테스트-Chrome-실행파일>
```

새로운 독립 MySQL·HTTPS Spring·Chrome 프로필을 A/B/C에 각각 생성합니다. 테스트용 Credential과 명시적인 UI 테스트 동의만 사용합니다. Python Docs → Python Blog → Hacker News → Books to Scrape → Python Docs 복귀를 포함해 각 10 Visit, SPA·뒤로 가기·탭 전환·민감 페이지 제외·worker/browser 재시작·END ACK·RAW_COLLECTED를 확인하고 age Export/Import를 검증합니다. `summary.json`과 각 슬롯의 `external-chrome.log`에 결과가 남습니다. 테스트 데이터와 암호화 Export는 연구용 160세션 데이터에 포함하거나 병합하지 않습니다. 인증서 검증은 해당 테스트 인증서 SPKI pin을 사용하며 OS 인증서 설치 검증을 대신하지 않습니다.
