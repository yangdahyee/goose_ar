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

## AR 사용 (M2)

안드로이드 Chrome에서 페이지를 열고 **AR 시작**을 누르면 카메라가 켜진다.
바닥을 천천히 비추면 흰 링이 뜨고, 탭하면 그 자리에 오리가 서서 나를 바라본다. **다시 놓기**로 위치를 바꾸고, **종료**로 일반 뷰어로 돌아간다.

오리를 놓으면 버튼이 더 나온다.
- **이리 와**: 오리가 내 쪽으로 몸을 돌리고 걸어와서 `STOP_DISTANCE_M`(0.5m) 앞에서 멈춘다. 오는 중에도 내가 움직이면 계속 따라온다.
- 안내 문구는 유리 상자 없이 글자와 상태 점으로만 잠깐 보인다(걷는 중 하늘색, 도착 민트, 춤 주황). 바닥을 찾는 동안에는 가운데에 안내 카드가 뜬다.
- **바닥을 탭**: 오리가 이미 놓여 있으면, 탭한 곳으로 걸어간다. 도착할 곳에는 주황색 링이 표시되고, 걷는 도중 다시 탭하면 목적지가 바뀐다. 벽이나 하늘을 탭하면 무시한다. (오리가 서 있는 바닥 높이의 평면과 터치 방향이 만나는 점으로 계산하므로 평평한 바닥에서 정확하다.)
- **춤 춰**: 춤을 한 번 추고 Idle로 돌아간다.
- 멈춰 있을 때와 춤출 때는 천천히 나를 바라본다.

- **촬영 모드**: 버튼과 안내 문구를 전부 숨긴다. 이 상태에서 폰의 화면 캡처나 화면 녹화로 오리와 함께 찍는다. 오른쪽 아래의 흐린 `UI` 버튼으로 복구한다.
- 오리 발밑에 부드러운 그림자가 생겨서 바닥에 서 있는 것처럼 보인다 (`src/duck/shadow.ts`).

걷기 튜닝은 `src/config.ts`: `WALK_SPEED_MULT`(걸음 빠르기, 속도도 같이 올라가서 발은 미끄러지지 않음), `STOP_DISTANCE_M`, `GO_STOP_DISTANCE_M`, `MAX_TAP_DISTANCE_M`, `TURN_RATE`.

- 필요 조건: ARCore 지원 폰 + Chrome (Google Play Services for AR 설치)
- 오리 크기는 `src/config.ts`의 `DUCK_HEIGHT_M`(기본 0.3m)
- AR 미지원 기기에서는 버튼이 비활성화되고 일반 3D 뷰어만 동작

## PC에서 UI 미리보기

AR은 폰에서만 되지만, 조작부 디자인은 PC에서 볼 수 있다.

- `http://localhost:5173/?ui=ar` : AR 화면의 조작부를 일반 뷰어 위에 띄워서 보여 준다.
- `?ui=ar&photo` : 촬영 모드 상태.
- `?ui=ar&scan` : 바닥을 찾는 중 상태. `?ui=ar&msg=도착했어요&tone=done` : 문구와 점 색(info, walk, done, dance) 확인.
- 크롬 개발자 도구에서 폰 크기(예: 390×780)로 보면 실제와 비슷하다.

## 배포

`main`에 푸시하면 GitHub Pages로 배포됩니다. 처음 한 번 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꿔야 합니다.

## 옛 화면이 보일 때 (캐시)

GitHub Pages는 브라우저가 `index.html`을 약 10분간 캐시하게 해서, 배포 직후에도 폰에 옛 화면이 보일 수 있다.

- 일반 뷰어 오른쪽 위에 현재 빌드 번호(`v97aa2f8` 같은 커밋 번호)가 보인다. 마지막 배포 커밋과 같은지 확인하면 된다.
- 열 때 서버의 `version.json`과 비교해서 더 새 버전이 있으면 `?v=<번호>` 주소로 한 번 자동 이동한다.
- 급하면 주소 뒤에 `?v=아무값`을 붙여서 연다.

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
