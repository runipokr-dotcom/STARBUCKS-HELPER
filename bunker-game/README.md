# PIXEL BUNKER PROJECT

정적 웹 퍼블리싱을 전제로 만든 1차 프로토타입입니다.

## 파일
- `index.html` — 게임 UI
- `styles.css` — 반응형 레이아웃
- `game.js` — 게임 상태, 공정, 캔버스 렌더링

## 실행
빌드 과정이 없습니다. 폴더를 정적 웹서버 루트에 올리면 됩니다.

GitHub Pages:
`https://runipokr-dotcom.github.io/STARBUCKS-HELPER/bunker-game/`

Vercel / Netlify:
이 폴더를 프로젝트 루트로 지정하면 그대로 배포 가능합니다.

## 설계 원칙
- 외부 프레임워크 없음
- 모바일 우선
- localStorage 자동 저장
- Canvas 그래픽
- 게임 로직과 UI를 분리해서 추후 Phaser/PixiJS/서버 저장으로 확장 가능

## 다음 확장 후보
- 작업자/장비 카드 덱
- 랜덤 사고/날씨 이벤트
- 장비 업그레이드
- 지하층 확장
- 복수 현장 맵
- 점수/랭킹
- 효과음/BGM
- 계정/클라우드 세이브
