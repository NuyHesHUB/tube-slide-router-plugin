# Tube Slide Router — 3D ASCII 로고 렌더러

터미널에서 빌드·실행하는 3D ASCII 로고입니다. 플러그인 동작과는 무관한 브랜딩 자산입니다.

## 빌드 (WSL Ubuntu / Linux / macOS)

```bash
make
```

## 파일

| 파일 | 설명 |
|---|---|
| `tube_slide_red.c` | 빨간색(`#e61121`) 애니메이션 버전 |
| `tube_slide_combo.c` | 정적 콤보 — 3D 슬라이드 + 워드마크 나란히 배치 |
| `tsr-wordmark.txt` | 콤보 렌더러가 쓰는 워드마크 텍스트 |

## 사용

```bash
# 빨간 애니메이션 (q로 종료)
./tube-slide-red

# 정적 1프레임
./tube-slide-red --static --width 90 --height 38 --angle 0.5

# 콤보(3D 슬라이드 + 워드마크)
./tube-slide-combo --red --wordmark tsr-wordmark.txt
```

## 옵션 (tube-slide-red)

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--static` | off | 단일 프레임만 출력(애니메이션 없음) |
| `--angle FLOAT` | 0 | 회전 각도(정적 모드에서만) |
| `--speed FLOAT` | 0.8 | 애니메이션 속도 배율 |
| `--width INT` | auto | 렌더링 너비(열 수) |
| `--height INT` | auto | 렌더링 높이(행 수) |
| `--frames INT` | 무한 | 애니메이션 프레임 수 제한 |
| `--no-color` | off | 흑백 ASCII 출력 |
| `--no-info` | off | 하단 정보바 숨김 |

## 옵션 (tube-slide-combo)

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--wordmark FILE` | 없음 | 워드마크 텍스트 파일 경로 |
| `--red` | off | 빨간색(`#e61121`) 튜브 색상 사용 |
| `--slide-width INT` | 60 | 3D 슬라이드 렌더링 너비 |
| `--slide-height INT` | 34 | 3D 슬라이드 렌더링 높이 |
| `--gap INT` | 4 | 슬라이드와 워드마크 사이 간격 |
| `--angle FLOAT` | 0.5 | 회전 각도 |
| `--no-color` | off | 흑백 출력 |
