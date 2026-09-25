# PIXEL BUNKER PROJECT

웹 퍼블리싱용 건설 프로젝트 프로토타입 v0.3.

## 현재 구조
- `index.html` — 1프레임 HUD / 렌더 viewport / 공정 콘솔
- `styles.css` — 1440×900 기준 고정형 대시보드 + 모바일 100dvh 대응
- `app.js` — phase 로더, 자원/진행 로직, 렌더 시퀀스 플레이어
- `data/phases.json` — 단계별 배경/작업/연결 애니메이션
- `data/animations.json` — 프레임 경로/FPS/좌표/크기
- `assets/` — 실제 렌더 이미지/프레임 자산

## 배포
빌드 과정 없이 정적 호스팅에 바로 배포합니다.

GitHub Pages:
`https://runipokr-dotcom.github.io/STARBUCKS-HELPER/bunker-game/`

Vercel / Netlify:
`bunker-game/` 폴더를 정적 사이트 루트로 배포하면 됩니다.

## 렌더 자산
실제 자산이 있으면 phase 배경과 장비 프레임 시퀀스를 그대로 재생합니다.
자산이 아직 없으면 fallback 그래픽으로 게임 진행이 가능합니다.

자세한 파일명 규칙은 `assets/README.md` 참고.

## 게임 루프
부지 조사 → 굴착 → 기초 타설 → 철골 세우기 → 벙커 쉘 → 설비 → 완공.

## 퍼블리싱 원칙
- HELPER 내부 PIN과 무관한 공개 페이지
- QR 상품 카탈로그 및 HELPER 데이터와 분리
- 실제 WebP/PNG 렌더 자산을 코드 수정 없이 교체 가능
- 추후 영상/WebGL/GLB 방식으로 다시 확장 가능
