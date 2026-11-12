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

## 애니메이션 클립

| 클립 | 길이 | 설명 |
|---|---|---|
| `Idle` | 2.0초 (루프) | 숨쉬기 |
| `Walk` | 0.667초 (루프) | 뒤뚱뒤뚱 걷기. 발이 미끄러지지 않는 이동 속도는 모델 단위로 **2.1 units/초** (`2 × STRIDE ÷ (16프레임 ÷ 24fps)`). 앱에서 오리 크기를 곱해서 쓴다. |
| `Dance` | 10초 | 기존 춤 |

세 클립은 모두 같은 노드(`Dance_Hips`, `Dance_Neck`, `Dance_Arms`, `Foot_L`, `Foot_R`)를 제어한다. 클립을 바꿀 때 값이 남지 않도록 의도적으로 맞춰 둔 것이다.
뷰어에서 `?clip=Walk&t=0.2&cam=side`로 특정 포즈를 고정해서 볼 수 있다.
