# Focus Recovery

실제 제목·본문·허용된 검색어 수집은 [버전 6 설치·재동의·암호화 전달·학습 검수 가이드](docs/data-collection/page-content-collection.md)를 확인합니다. 일반 공개 HTTP/HTTPS 탐색과 기존 Plan을 유지합니다.

사용자가 웹 탐색을 시작할 때 설정한 최초 작업 목표와 실제 탐색 흐름을 분석하여,
목표에서 점진적으로 벗어나는 상황을 탐지하고 필요한 시점에 최초 목표를 다시 제시하는 시스템입니다.

## System

전체 시스템은 다음 세 영역으로 구성됩니다.

- `fe/`: React 기반 Chrome Extension
- `be/`: Spring Boot 기반 Backend
- `ai/`: Python 기반 AI Service

기본 처리 흐름은 다음과 같습니다.

```text
Chrome Extension
       ↓
Spring Boot Backend
       ↓
Python AI Service
```

AI는 최근 5개의 유효 Page Visit을 기준으로 탐색 상태를 분석하고,
다음 세 상태 중 하나로 분류합니다.

- `NORMAL`
- `TRANSITION`
- `DRIFT`

`DRIFT`로 판단되면 웹사이트를 차단하지 않고 최초 작업 목표를 다시 보여주며,
사용자가 원래 목표로 돌아갈지 현재 탐색을 계속할지 직접 선택할 수 있도록 합니다.

## Repository Structure

```text
.
├── ai/
├── be/
├── fe/
├── docs/
│   ├── project-plan.md
│   ├── ai-spec.md
│   ├── be-spec.md
│   └── fe-spec.md
├── .github/
├── .gitignore
├── .editorconfig
└── README.md
```

## Documents

| 문서 | 설명 |
| --- | --- |
| `docs/project-plan.md` | 프로젝트 계획서 |
| `docs/ai-spec.md` | AI 기능명세서 |
| `docs/be-spec.md` | Backend 기능명세서 |
| `docs/fe-spec.md` | Frontend 기능명세서 |
| [기존 문서 권한 적용 검증](docs/active-page-permission-fix-validation.md) | Issue #67 수정 및 실제 Chrome·BE·DB 검증 결과 |
| [권한 미허용 안내 검증](docs/permission-denial-feedback-fix-validation.md) | Issue #74 수정 및 Popup 재진입·네이티브 취소·재허용 검증 |

## v2 수집 환경 준비

- [A/B/C 팀원 PC 현장 검증 — 설치·데이터 보존·10 Visit·Export·결과표](docs/data-collection/team-field-validation.md)

실제 수집은 팀원별 독립 로컬 환경에서 현재 정책과 빌드를 확인하고 본인이 직접 동의한 뒤 시작합니다. 설치·격리 마감·재수집 절차와 검증 범위는 아래 안내를 따릅니다.

- [참여자 안내서](docs/data-collection/participant-guide.md)
- [관리자 실행·장애 대응](docs/data-collection/operator-guide.md)
- [승인 Readiness](docs/data-collection/readiness-checklist.md)
- [실행·검증 보고](docs/data-collection/collection-stability-validation.md)
