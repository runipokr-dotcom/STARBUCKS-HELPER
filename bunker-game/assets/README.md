# Render Assets

v0.3는 실제 렌더 이미지를 이 폴더에 꽂는 방식입니다.

## Backgrounds
`assets/bg/`
- phase_01_site.webp
- phase_02_excavation.webp
- phase_03_foundation.webp
- phase_04_steel.webp
- phase_05_shell.webp
- phase_06_system.webp
- phase_07_complete.webp

권장: 1920×1080 원본 → 웹용 1440px WebP.

## Excavator sequence
`assets/anim/excavator_dig/`
- excavator_dig_0001.webp ... excavator_dig_0036.webp

## Crane sequence
`assets/anim/crane_lift/`
- crane_lift_0001.webp ... crane_lift_0040.webp

`assets/anim/crane_install/`
- crane_install_0001.webp ... crane_install_0042.webp

투명 배경 WebP 권장. 프레임 수/FPS/화면 위치는 `data/animations.json`에서 수정합니다.
실제 자산이 없으면 app.js가 fallback 애니메이션으로 동작합니다.
