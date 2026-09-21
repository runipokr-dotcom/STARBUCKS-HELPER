# 실행형 프롬프트 저장소

현재 사용자 선택은 **ChatGPT만 사용**이다. 아래 기존 양사 구현 기록과 달리 화면에서는 Claude와 다른 모델 실행 버튼을 제거했다. 필요한 변수는 OPENAI_API_KEY와 RUN_PROMPT_ACCESS_TOKEN 두 개이며 ANTHROPIC_API_KEY 등록은 필요 없다.

## 사용 방법
1. 저장할 원문의 입력 위치에 `{{상품명}}`, `{{원하는 톤}}`처럼 변수를 표시한다. 같은 변수는 한 번만 입력한다. 기존 일반 프롬프트도 그대로 실행할 수 있다.
2. 카드의 **사용하기**를 누르고 변수를 채운다. 실행할 내용에서 이번 실행만을 위한 추가 수정도 가능하다. 변수 입력을 바꾸면 실행할 내용은 원문으로부터 다시 구성된다.
3. ChatGPT와 실행 암호를 입력하고 **실행하기**를 누른다.
4. 결과의 **결과 복사 / 다시 생성**을 사용한다. 재생성 및 모델 변경은 마지막 성공 결과와 동일한 입력을 사용한다. 입력을 수정해 실행하려면 위쪽 **실행하기**를 누른다.
5. 프롬프트 원문, 결과, 모델 출력에 포함된 HTML은 실행하지 않고 텍스트로 표시한다. 결과와 실행 암호는 Firestore나 브라우저 저장소에 저장하지 않으며 새로고침하면 사라진다.

이번 구현은 텍스트 실행 기능이다. 이미지 생성·파일 업로드·웹 탐색 도구는 추가하지 않았다. 입력 최대 30,000자, 요청 최대 100KB, 출력 상한 4,096토큰, 서버 호출 제한 55초다. 제한에 걸린 결과는 불완전 상태로 안내한다. 시간 초과/네트워크 오류 시 자동 재시도하지 않는다.

## Vercel 환경변수
Vercel 프로젝트 Settings → Environment Variables에 설정하고 해당 환경을 재배포한다. API 키를 HTML/JS, Git, Firestore, `NEXT_PUBLIC_`/`VITE_` 변수에 넣지 않는다.

| 변수 | 필요 여부 | 값/역할 |
|---|---|---|
| OPENAI_API_KEY | ChatGPT 실행에 필수 | OpenAI API 키, 서버 전용 |
| ANTHROPIC_API_KEY | Claude 실행에 필수 | Anthropic API 키, 서버 전용 |
| RUN_PROMPT_ACCESS_TOKEN | 실행에 필수 | 32자 이상의 충분히 무작위인 별도 실행 암호. 공급자 API 키와 다른 값 사용 |
| OPENAI_MODEL | 선택 | 기본 `gpt-6-astra`. 계정에서 사용 가능한 Responses API 모델 ID로 변경 가능 |
| ANTHROPIC_MODEL | 선택 | 기본 `claude-sonnet-5`. 계정에서 사용 가능한 Messages API 모델 ID로 변경 가능 |
| ANTHROPIC_WORKSPACE_ID | 키 유형에 따라 필요 | 여러 workspace용 Anthropic API 키의 workspace ID |
| RUN_PROMPT_ALLOWED_ORIGINS | 선택 | 추가 허용 페이지 origin을 쉼표로 구분. 경로/마지막 슬래시 제외 |

모델 기본값은 2026-09-22 공식 문서에 명시된 ID를 사용한다. 실제 계정의 모델 접근 권한/결제는 별도 확인이 필요하다. ChatGPT/Claude 웹 구독 자체가 서버 API 인증을 대신하지 않는다.

실행 암호는 사용자가 입력하는 별도 접근 자격증명이며, 공급자 API 키가 아니다. 브라우저 요청에는 이 실행 암호만 전달된다. CORS만으로 유료 API를 보호할 수 없어 서버에서 실행 암호를 필수 검사한다. 설정이 없거나 32자 미만이면 호출을 닫아둔다. 사용자별 계정 인증이나 분산 호출량 제한은 구현하지 않았으므로, 공급자 사용 한도와 Vercel Firewall에서 `/api/run-prompt` 호출량 제한을 운영 상황에 맞게 설정한다.

## 배포
- 실제 수정 checkout: `/Users/kangsik/Documents/Codex/2026-09-22/referenced-chatgpt-conversation-this-is-an/work/helper`. 원래 작업자의 checkout을 덮어쓰지 않는 동일 저장소의 독립 worktree다.
- 기준 저장소: `runipokr-dotcom/STARBUCKS-HELPER`, 확인한 main `d1cfa6b`.
- 기존 Vercel 함수 `api/extract.js`와 동일한 ESM/Node 방식이며 추가 npm 런타임 의존성이 없다. Node.js 22 이상을 사용한다.
- `vercel.json`에는 기존 추출 API 설정을 유지하고 `api/run-prompt.js`의 `maxDuration: 60`만 추가했다.
- Vercel 호스트에서 페이지를 열면 같은 origin의 `/api/run-prompt`를 호출한다.
- GitHub Pages에서는 기존 프로젝트의 `https://starbucks-helper.vercel.app/api/run-prompt`를 호출한다. Pages 자체에서는 서버 코드를 실행하지 않는다.
- 기본 CORS 허용: `https://runipokr-dotcom.github.io`, `https://starbucks-helper.vercel.app`, Vercel이 제공하는 현재 배포/프로덕션 URL. 추가 커스텀 도메인은 위 환경변수에 명시한다.
- 로컬 검증용 origin도 필요하면 명시적으로 추가한다. `file://`로 열지 않는다.
- Pages에서 API에 접근할 때 Vercel Deployment Protection이 로그인 화면을 반환하거나 preflight를 막지 않도록 **운영 API 주소**의 접근 설정을 확인한다. 실행 암호는 계속 필수다.
- 파일 반영과 환경변수 설정 후 Vercel과 Pages를 각각 배포한다. `prompt.html`과 `prompt-runner.js`를 같이 배포한다.
- 배포 뒤 Pages URL에 캐시 무효화 쿼리를 붙여 열고, 두 모델 각각 짧은 프롬프트 실행 → 결과 → 복사 → 재생성 → 다른 모델 실행을 실제 계정으로 확인한다.
- 후속 요청으로 기능 커밋 `845927e`를 main에 push했다. Vercel `/api/run-prompt` 배포 및 실행 암호 미설정 시 503 응답을 확인했다. Pages는 GitHub 배포 진행 중이다. Vercel 로그인 전이어서 공급자 키 등록 상태 및 실제 유료 호출은 미검증이다.

## 데이터 및 회귀 검수
- `couponWork/helper-prompt-library-v1`, 문서 version 1과 items 배열 구조 유지. 마이그레이션 없음.
- 수정 기능은 기존 ID/생성일/즐겨찾기/알 수 없는 필드를 유지하며 원문 입력 필드만 변경한다. 같은 필드가 다른 기기에서 바뀌거나 항목이 삭제되면 저장을 막아 덮어쓰지 않는다.
- 즐겨찾기는 항목별 `favorite` 필드만 추가한다. 기존 항목의 미설정 값은 해제 상태로 처리한다.
- 기존 저장/검색/삭제/복사/전체보기/Firebase 트랜잭션 및 구독 구조 유지. 수정·즐겨찾기는 실제 기준 코드에 없어서 이번에 추가했다.
- API 단위 테스트는 실제 handler와 모의 공급자 응답으로 인증/CORS/메서드/크기/빈 입력/키 누락/두 공급자 요청 형식/출력 파싱/오류 비노출/시간 초과/잘린 답변을 검사한다.
- 브라우저 테스트는 독립 Chrome과 모의 Firestore/모의 API를 사용한다. 저장/수정/즐겨찾기/검색/삭제/새로고침, 기존 필드 보존, 동시 수정 충돌, 변수 반복 치환, 복사, 재실행/모델 변경, 실패 시 이전 결과 유지, 암호 미저장, 모바일 390px 너비를 검사한다.
- 운영 Firestore 데이터 변경 0건. 실제 기기간 동기화, 실제 모바일 Safari/카카오 인앱, 실제 API 키로 생성, 운영 Pages/Vercel은 이번 변경에 대해 아직 미검증이다.

검사 명령 (Node와 Playwright/Chrome이 설치된 환경):

```sh
node --test tests/run-prompt.test.mjs
node tests/prompt-browser.cjs
git diff --check
```

## 공식 API 근거
- [OpenAI Responses 텍스트 생성](https://developers.openai.com/api/docs/guides/text): `/v1/responses`, Bearer 인증, `input`, 메시지의 `output_text` 읽기.
- [Anthropic API](https://platform.claude.com/docs/en/api/overview): `/v1/messages`, Bearer 인증, `anthropic-version: 2023-06-01`.
- [Anthropic 모델 ID](https://platform.claude.com/docs/en/models/overview): `claude-sonnet-5`.
- [Vercel 함수 실행 시간](https://vercel.com/docs/functions/configuring-functions/duration).
