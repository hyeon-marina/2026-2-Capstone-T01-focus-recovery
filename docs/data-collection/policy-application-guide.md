# 확정 공통 정책 적용

[TEAM_POLICY.json](TEAM_POLICY.json)은 실제 설치하는 CONFIRMED 운영 설정이다. 정책 버전2·build focus-105-operational-v2·Plan revision1·목표20개·160배정·A54/B53/C53을 유지한다. 파일 전체 해시는 [TEAM_POLICY.sha256](TEAM_POLICY.sha256), Plan 해시는 JSON의 planChecksum이다.

기본 명령은 `python3 tools/individual-local/local.py setup --slot A`다. Windows는 `python`, B/C는 본인 슬롯을 쓴다. setup은 저장소 SHA 검증 후 Java 검증기로 정책·기간·계획·사이트를 검사해 오프라인 설치하고 본인 Credential을 발급한다. DB Release는 설치 트랜잭션이 정확한 정책 해시와 Build에 연결하며 관리자가 수동 입력하지 않는다. 동의는 설치하지 않는다.

teamDecisionRef·retentionRef·privacyEvidenceRef·startAuthorizationRef는 로컬 운영 정책의 필수 입력이 아니다. 별도 goalReviewRef/siteReviewRef 파일, confirmedByRecordOwner, 내부 기록 파일 SHA를 요구하지 않는다. 목표의 repository 출처 표시는 저장소 정책의 채택을 뜻한다. 기관 승인 증거가 아니다.

재실행은 설치된 정책 바이트와 개인 config의 SHA를 검증하여 유지한다. 새 공통 정책을 적용하는 경우만 다음 명령을 사용한다.

```sh
python3 tools/individual-local/local.py setup --slot A --policy docs/data-collection/TEAM_POLICY.json --policy-sha256 HASH_FROM_TEAM_POLICY_SHA256
python3 tools/individual-local/local.py build
```

정책 내용 변경은 새 policyVersion/buildId·기간·SHA와 Extension 재빌드·재동의를 요구한다. 실적이 있는 Plan/배정을 임의 변경하지 않는다. `policy-records.template.json` 및 `policy-prepare`는 과거 운영 방식의 선택적 호환 도구로만 보존하며 기본 설치에 사용하지 않는다. 추가 기관 승인 시스템이나 정책 발행 명령은 도입하지 않는다.

기관 판단 UNRESOLVED는 설치 가능한 확정 정책과 별개의 실제 개시 조건이다. `LocalCollectionPolicy.validate`는 설치를 허용하며 `CollectionSitePolicy.require`와 consent deployment 검사는 실제 개시를 차단한다. 화면·local-status는 INSTITUTION_BLOCKED로 이유를 표시한다. 승인·면제 결과를 임의 생성하지 않는다. 실제 판단이 확인되기 전에는 COLLECTION_AUTHORIZED를 선언하지 않는다.

날짜 미등록은 공통 정책 확정을 취소하지 않는다. 최종 평가 종료일과90일 후 삭제 예정일·원본/통합/Export/백업 책임·사본·실행 증거는 운영대장에 등록한다. 삭제 스케줄러가 자동 실행된다고 주장하지 않는다.

[실제 검증과 외부 미충족 조건](enable-real-collection-validation.md), [설치 명령](individual-local-setup.md)을 확인한다.
