# STARBUCKS HELPER 협업 규칙

## WORKLOG HARD RULE
- [WORKLOG_READ_FIRST] STARBUCKS HELPER 저장소의 코드/설정/페이지를 수정하기 전에 반드시 `WORKLOG.md`의 최신 항목을 먼저 읽고 현재 버전, 최근 변경, 미해결 이슈, 다른 작업자의 진행 상태를 파악한다. 읽기 전에 수정 작업을 시작하지 않는다.
- [WORK_ORDER_FIRST] 작업 시작 전에 이번 요청의 목표 / 대상 파일 / 허용 변경 / 건드리지 않을 것 / 완료 조건 / 실제 테스트 기준을 확인한다.
- [PRESERVE_EXISTING] 기존 기능, 데이터 구조, 디자인을 유지하고 요청 범위 밖의 변경은 피한다. 다른 작업자가 만든 미완료 변경이나 관련 없는 변경을 덮어쓰지 않는다.
- [FINAL_RECHECK] 수정 후 최초 작업 요청과 `WORKLOG.md`에서 확인한 제약을 다시 대조하고 회귀검수한다. 검수 전에 완료 선언하지 않는다.
- [WORKLOG_WRITE_LAST] 기능 수정과 검수가 끝나면 완료 선언 전에 `WORKLOG.md` 최상단에 새 작업완료일지를 추가한다. 날짜, 작성자, 요청/목적, 이전→신규 버전, 수정 파일, 실제 변경 내용, 검증 결과, PC/모바일 영향, commit SHA, 배포 상태, 남은 문제를 기록한다.
- [WORKLOG_READBACK] `WORKLOG.md` 저장 후 다시 읽어 새 항목이 실제로 최상단에 반영됐는지 확인한다.

## 작업지시서 / WORKLOG 분리 HARD RULE
- [INSTRUCTION_ROLE] `COUPON_WORK_INSTRUCTIONS.md`와 `image-extractor.html`이 생성하는 프롬프트는 **실제 쿠폰 작업을 수행하기 위한 작업지시서**다. 추출/검수/크롭/서버 반영 방식 같은 실행 규칙을 관리한다.
- [WORKLOG_ROLE] `WORKLOG.md`는 **저장소 개발·수정 작업의 이력과 인계 기록**이다. 누가 무엇을 왜 바꿨는지, 버전, 수정 파일, 검증, commit SHA, 남은 문제만 기록한다.
- [NO_MIX] 생성된 쿠폰 작업지시서 전문, 원본 쿠폰 데이터 전체, 배치 실행용 상세 프롬프트를 `WORKLOG.md`에 복사하지 않는다. 반대로 개발 변경 이력과 commit 정보를 쿠폰 작업지시서 본문에 섞지 않는다.
- 배치 실행 결과를 WORKLOG에 남겨야 할 경우에는 산출물명/건수/성공·오류 여부 같은 **짧은 결과 요약만** 기록한다.

이 절차는 ChatGPT / Codex / Claude 등 작업 주체와 관계없이 동일하게 적용한다.
