# 사이트별 원본 수집 검토 (#105)

현재 운영 준비 절차는 [최종 Readiness](real-collection-final-readiness.md)를 따른다. 정책 내용과90일 보존을 채택하고 Plan revision1을 준비했다. 실제 기록이 없는 목표 승인/기관 판단은 DRAFT/UNRESOLVED로 남긴다. 실제 증거 입력 후 `local.py policy-prepare`가 Java 검증을 통과한 공통 파일/SHA를 생성한다. 아래 #105/#106의 기존 수치·제안/검증 내용은 당시 기록이며 최신 JSON은 접근 가능한15쌍으로 정리했다.

실제 수집 허용 사이트는 현재 **0개**다. TEAM_POLICY.json의 아래 20개 origin/pathPrefix 쌍은 DRAFT 후보이며 학교/팀/사이트 확인이나 개인 동의를 대신하지 않는다. 상한 30개를 늘리지 않았다. 2026-11-11 KST에 공식 페이지·정책을 웹으로 확인하고 별도 임시 Chrome에서 읽기 전용 smoke를 실행했다. `COMPATIBLE_SMOKE`는 해당 대표 페이지의 HTTPS/HTTP200/범위/HTML/제목 존재/메타데이터 DOM 검사만 통과했다는 뜻이다. 실제 Extension 수집·SPA 이동·10 Visit 성공·권리 허가를 뜻하지 않는다. 원본문장/계정/폼값은 보고서에 저장하지 않았다.

[실행 증거](evidence/issue105-site-smoke.json). 페이지에서 입력 포커스를 해제하고 읽는 상태를 점검했다. initialMetadataExcluded는 최초 상태, metadataExcluded는 읽기 상태다. 입력창을 사용하는 동안에는 Visit을 차단/격리한다. History API 존재만으로 SPA 전체 호환을 판정하지 않았다. 재시도 전의 403/404/리디렉션/보호 실패도 검증 보고에 남긴다.

공통 조건: 비로그인 공개 HTML만, 주제 분류/행동 메타데이터만 저장한다. 사이트 원제목은 로컬 분류 입력이며 원제목/본문/검색결과/미디어/댓글/입력값은 전송하지 않는다. 사이트별 최소 10 Visit은 모두 NOT_TESTED이고 실제 파일럿과 권리 검토 전에는 수집을 개시하지 않는다. 일반적인 auth/login/account/profile/settings/checkout/payment/medical/health/private/mail 경로, 인증정보/민감 Query, 폼 상호작용·인증 DOM은 제외한다. Wikipedia는 `Special:`, `User:`, `User_talk:`, `Talk:` 등 비학습 문서도 제외하며 건강/인물 개인정보 주제는 탐색하지 않는다.

## 정책에 포함한 후보

| HTTPS Origin | Path Prefix | 범주 | 읽기 전용 실제 Chrome | 공개성·위험/검토 근거 | 경로·제목·SPA/제외 |
| --- | --- | --- | --- | --- | --- |
| https://docs.github.com | `/en/pages` | 기술 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 공개 문서 CC-BY 계열의 별도 고지 확인; 콘텐츠 복제하지 않음 | 검색 자동 포커스/공개 설문 필드 보호 조건; title 존재=True |
| https://developer.mozilla.org | `/en-US/docs` | 기술 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. MDN CC-BY-SA 문서/코드 라이선스 구분 | 일반 문서; SPA History 재검증; title 존재=True |
| https://docs.python.org | `/3` | 기술 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. PSF 문서 라이선스 확인 | 정적 문서; title 존재=True |
| https://git-scm.com | `/docs` | 기술 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 문서/사이트 권리와 공식 출처 확인 | 문서 경로; title 존재=True |
| https://www.w3.org | `/WAI/` | 기술·교육 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. W3C 문서 라이선스 확인 필요 | 키보드/대체 텍스트; title 존재=True |
| https://science.nasa.gov | `/` | 과학 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. NASA 미디어·제3자 권리와 구분; 원문/미디어 저장 없음 | 동적 페이지/검색; title 존재=True |
| https://www.epa.gov | `/recycle` | 환경·일상 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 기관 공개 자료와 제3자 권리 구분 필요 | 분리배출 교육; title 존재=True |
| https://www.si.edu | `/spotlight` | 문화 | BLOCKED_SMOKE (403) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. CC0 표시 객체와 제한 자료 구분; 자동 처리 범위 재확인 | 403 우회 금지; title 존재=True |
| https://www.si.edu | `/openaccess` | 문화 | BLOCKED_SMOKE (403) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. CC0 표시 객체와 제한 자료 구분; 자동 처리 범위 재확인 | 403 우회 금지; title 존재=True |
| https://www.metmuseum.org | `/ko/art` | 문화 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. OA CC0와 제한 자료 구분; 약관 확인 | 실제 ko 리디렉션 경로 반영; title 존재=True |
| https://www.hangeul.go.kr | `/` | 교육·문화 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 공공누리 유형/개별 저작권 재확인 필요 | 예약/교육 신청 제외; title 존재=True |
| https://www.nl.go.kr | `/NL/contents/` | 교육 | BLOCKED_SMOKE (404) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 도서관 공개 안내/이용 조건 재확인 필요 | prefix의 대표 URL 404; 개별 안내 주소 확인 필요; title 존재=True |
| https://philharmonia.co.uk | `/resources/` | 문화·음악 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 교육 자료와 음악/영상 권리 구분; 이용 조건 추가 확인 | 악기 교육; 티켓/계정 제외; title 존재=True |
| https://www.usgs.gov | `/programs` | 지리·과학 | BLOCKED_SMOKE (403) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 기관 공개 자료와 제3자 권리 구분 필요 | 403 우회 금지; title 존재=True |
| https://www.noaa.gov | `/jetstream` | 기상·과학 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 기관 공개 자료와 제3자 권리 구분 필요 | weather.gov에서 실제 noaa.gov로 이동 확인; title 존재=True |
| https://notice.tistory.com | `/` | 블로그·일상 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. Tistory 운영정책/개별 글 권리 추가 확인 | 정확한 공개 블로그 1개; 전체 tistory 허용 아님; title 존재=True |
| https://www.maangchi.com | `/recipe` | 요리·일상 블로그 | BLOCKED_SMOKE (403) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. 개인 저작물; 자동 처리 허가 범위 추가 확인 | 본문/댓글/영상 제외; 403 우회 금지; title 존재=True |
| https://d2.naver.com | `/helloworld` | 공개 기술 블로그 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. NAVER 서비스/개별 글 권리 추가 확인 | Hello world 공개 글; title 존재=True |
| https://ko.wikipedia.org | `/wiki` | 교육·문화·일상 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. Wikimedia 이용약관·CC-BY-SA/제3자 조건 구분 | 공개 읽기만; 편집/사용자/토론 제외; title 존재=True |
| https://en.wikipedia.org | `/wiki` | 교육·과학·교통 | COMPATIBLE_SMOKE (200) | 공개 페이지 후보/로그인 불필요 예상, 개인정보 미노출 보증 아님. Wikimedia 이용약관·CC-BY-SA/제3자 조건 구분 | 공개 읽기만; 편집/사용자/토론 제외; title 존재=True |

모든 행의 수집 허용 판단은 **DRAFT / 실제 개시 BLOCKED**다. 조건부 Chrome 통과와 증거 참조의 사람이 확인할 항목을 섞어 PASS라고 하지 않는다. 블로그/일상은 Tistory 공지·D2·요리/공개 리뷰 후보까지 검토했다. 개인 취미/여행/제품 사용기 블로그를 추가하려면 정확한 개별 origin/작성자 prefix와 실제 공개 글/민감정보/약관/Chrome 테스트를 이 표에 기록하고 새 정책으로 적용한다. 와일드카드 `*.tistory.com`, Naver 전체 블로그, 모든 인터넷 허용은 없다.

## 별도 미확정 후보 — TEAM_POLICY sites에 미포함

| 서비스 | 정확한 후보 origin/prefix | URL 기술 범위 | 실제 허용/남은 확인 |
| --- | --- | --- | --- |
| Google Search | `https://www.google.com` `/search` | q는 HMAC 입력 후 폐기, 검색어 표식만 저장. 결과/추천/계정 제외 | BLOCKED: 자동 접근/검색 정책 검토·필요 허가/실제 Chrome 파일럿. 국외/모바일 다른 origin은 별도 검토 |
| Naver Search | `https://search.naver.com` `/search.naver` | query 최소화, 검색어 표식, 웹 검색 기본 경로 | BLOCKED: 검색결과 수집 정책/이용약관·실제 파일럿 |
| YouTube | `https://www.youtube.com` `/watch` | 공개 v 식별자 11자만 검증 후 HMAC, 재생시각/추적값 제거. 방문/활성 체류/탭/주제만 | BLOCKED: 자동 접근 제한/필요한 실제 서면 허가 여부 확인. 영상/음성/자막/댓글/추천·playlist/shorts/embed/로그인 미지원 |
| Naver Blog | `https://blog.naver.com` `/PostView.naver` | 공개 blogId/logNo만 HMAC; 입력값 원문 저장 없음 | BLOCKED: 약관·작성자/제3자 권리·실제 Chrome. 현대 작성자/글 URL·모바일·iframe 본문 추출은 지원한다고 주장하지 않음 |
| Britannica | `https://www.britannica.com` `/science`, `/art`, `/topic` | 공개 비로그인 후보; 본문 저장 없음 | BLOCKED: 이번 환경 약관/권리 확인 실패. paywall/미확인 경로 활성화 금지 |
| DOE | `https://www.energy.gov` `/energysaver` | 후보 URL이 root로 리디렉션됨 | BLOCKED: scope를 root로 자동 확대하지 않음. 대체 공개 교육 경로 확인 필요 |
| 여행 블로그 | Nomadic Matt 등 개별 후보 | `/travel-blogs/` 검사에서는404 | BLOCKED: 실제 경로·권리 확인 전 sites에 넣지 않음 |

기능 Query: Google q, Naver query, YouTube v/t(시각은 동일 페이지로 합침), Naver Blog blogId/logNo, 일반 페이지 p/page 숫자. known utm/fbclid/gclid/si/feature는 제거한다. 나머지 Query/중복 기능키는 차단한다. 따라서 실제 서비스가 추가 파라미터를 붙이면 해당 Visit이 차단될 수 있다. 기능/추적키 추가는 사이트별 검토와 테스트로 수행하며 임의 전체 Query 허용은 하지 않는다. 일반 fragment 앵커는 버리고 hash SPA 라우트/키값 fragment는 차단한다. pushState/replaceState의 승인된 경로·기능 Query 이동은 새 HMAC으로 식별한다.

## 확인한 원본 자료

- [GitHub Pages 공식 문서](https://docs.github.com/en/pages), [MDN 저작권/라이선스](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license), [Python 문서 라이선스](https://docs.python.org/3/license.html), [Git 문서](https://git-scm.com/docs), [WAI](https://www.w3.org/WAI/).
- [NASA 미디어 지침](https://www.nasa.gov/nasa-brand-center/images-and-media/), [EPA 재활용](https://www.epa.gov/recycle), [Smithsonian Open Access FAQ](https://www.si.edu/openaccess/faq), [The Met 약관](https://www.metmuseum.org/policies/terms-and-conditions). OA 라이선스를 해당 사이트 전체나 사람 행동 데이터의 승인으로 확대하지 않는다.
- [국립한글박물관](https://www.hangeul.go.kr/), [Philharmonia 교육](https://philharmonia.co.uk/resources/), [USGS](https://www.usgs.gov/programs/earthquake-hazards), [NOAA JetStream](https://www.noaa.gov/jetstream).
- [Tistory 공지](https://notice.tistory.com/), [Maangchi 공개 레시피](https://www.maangchi.com/recipe/tongbaechu-kimchi), [D2](https://d2.naver.com/helloworld), [Wikimedia 이용약관](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use). 공개 페이지 확인은 자동 처리 허가 증거가 아니다.
- [YouTube 약관](https://www.youtube.com/static?template=terms)은 자동 접근과 개인 식별정보 수집을 제한한다. [Google 이용약관](https://policies.google.com/terms)과 [Search 자동 트래픽 정책](https://developers.google.com/search/docs/essentials/spam-policies)은 자동 접근 제한을 둔다. [Naver 이용약관](https://policy.naver.com/policy/service.html) 및 [검색결과 수집 정책](https://policy.naver.com/policy/search_policy.html)을 함께 확인해야 한다. 원문을 대량 복제하지 않고 본 프로젝트에 허용되는 범위를 실제로 확인한다.
