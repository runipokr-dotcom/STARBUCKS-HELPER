# PIXEL BUNKER PROJECT

웹 퍼블리싱용 3D 건설 프로젝트 프로토타입 v0.2.

## 현재 구조
- `index.html` — 한 화면 1프레임 HUD / 3D viewport / 공정 콘솔
- `styles.css` — 1440×900 기준 고정형 대시보드 + 모바일 100dvh 대응
- `game.js` — 공정/자원/저장 로직 + Three.js 3D scene

## 배포
빌드 과정 없이 정적 호스팅에 바로 배포할 수 있습니다.

GitHub Pages:
`https://runipokr-dotcom.github.io/STARBUCKS-HELPER/bunker-game/`

Vercel / Netlify:
`bunker-game/` 폴더를 정적 사이트 루트로 배포하면 됩니다.

## 3D
- Three.js CDN
- PerspectiveCamera + OrbitControls
- 실시간 그림자 / Hemisphere + Directional light
- 굴착기 / 크레인 / 기초 / 철골 / 벙커 쉘 / 설비를 primitive 기반 low-poly 모델로 구성
- 공정 단계에 따라 3D 구조와 장비 visibility가 변경됨

## 게임 루프
부지 조사 → 부지 정리 → 굴착 → 지반 다짐 → 기초 타설 → 철골 세우기 → 벙커 쉘 → 설비 → 완공.

예산, 연료, 강재, 콘크리트 / 안전, 품질, 장비 / 보급, 정비 / 날씨와 시간 / localStorage 저장을 포함합니다.

## 퍼블리싱 원칙
- HELPER 내부 PIN과 무관한 공개 페이지
- QR 상품 카탈로그 및 HELPER 데이터와 분리
- 게임 로직과 3D scene을 분리 가능한 구조로 유지
- 추후 GLB/GLTF 실제 장비 모델로 교체 가능

## 다음 후보
- 실제 GLB 굴착기/크레인 모델
- PBR 텍스처 / 환경광 / 포스트프로세싱
- 단계 전환 카메라 연출
- 작업자 / 사고 / 날씨 이벤트
- 장비 업그레이드
- 효과음 / BGM
