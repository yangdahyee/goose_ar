# goose_ar

모자 쓴 캐릭터를 내 방 바닥에 소환하고, 부르면 걸어오게 하는 웹 AR (안드로이드 Chrome, WebXR).
계획과 마일스톤은 [PLAN.md](PLAN.md)를 참고하세요.

## 개발

```bash
npm install
npm run dev        # http://localhost:5173
```

폰에서 테스트할 때는 USB로 연결하고 `adb reverse tcp:5173 tcp:5173` 후 폰 Chrome에서 `http://localhost:5173`을 엽니다.
(WebXR은 HTTPS 또는 localhost에서만 동작합니다.)

## 배포

`main`에 푸시하면 GitHub Pages로 배포됩니다. 처음 한 번 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꿔야 합니다.

## 에셋

- `assets/duck.blend`: 원본
- `public/models/duck.glb`: 앱이 쓰는 모델
- `tools/export_glb.py`: blend → glb 변환 (`pip install bpy` 필요)

```bash
python tools/export_glb.py assets/duck.blend public/models/duck.glb
```
