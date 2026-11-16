# Tube Slide Router 설치 & 명령어 가이드

Tube Slide Router(TSR)는 Claude Code에서 **매 요청의 난이도를 자동으로 판정해, 쉬운 일은 싼 모델로 어려운 일은 센 모델로** 알아서 돌려주는 플러그인입니다. 별도 API 키·프록시·외부 서버가 필요 없고, 판정에는 Claude Code에 내장된 기능(`$.model.classify`)만 씁니다.

이 문서는 **설치하는 법 → 처음 설정 → 명령어 → 상태 확인 → 세부 설정** 순서로 되어 있습니다. 설치만 빨리 하고 싶으면 아래 "1. 설치" 한 단락만 따라 하면 됩니다.

---

## 1. 설치

### 방법 A — 마켓플레이스에서 설치 (권장)

Claude Code **터미널 세션의 프롬프트**에 아래 한 줄을 입력합니다.

```text
/plugin install tube-slide-router --marketplace NuyHesHUB/tube-slide-router-plugin
```

그러면 순서대로 이렇게 물어봅니다.

1. **`Add marketplace?`** — 저장소(`github:NuyHesHUB/tube-slide-router-plugin`)를 마켓플레이스로 추가할지 묻습니다. `y`를 누릅니다.
2. **설치 범위(scope)** — 맨 위 **user**(내 계정 전체)에 커서가 있습니다. 그대로 Enter를 누르면 모든 세션에서 쓰입니다. (특정 프로젝트에서만 쓰려면 project 범위를 고르세요.)
3. **설정 화면** — `mode`, `statusLineEnabled` 등 몇 가지 옵션을 바로 정할 수 있습니다. 잘 모르겠으면 기본값 그대로 두고 넘어가도 됩니다(나중에 `/config`에서 언제든 바꿀 수 있습니다).
4. 끝나면 `Installed tube-slide-router. Plugin is now active.` 가 뜨고, **그 세션부터 바로 동작**합니다. user 범위로 깔았다면 이후 새로 여는 세션에도 자동으로 적용됩니다.

> **데스크톱 앱**에서는 `/plugin` 명령이 안 되므로: 프롬프트 옆 **+** 버튼 → **Plugins** → **Add marketplace**에 `NuyHesHUB/tube-slide-router-plugin` 입력 → **Add plugin**.

### 방법 B — 저장소를 직접 받아서 로드 (개발/오프라인)

이 저장소는 루트에 `.claude-plugin/plugin.json`이 있으므로, 받은 폴더 자체를 가리키면 됩니다.

```bash
git clone https://github.com/NuyHesHUB/tube-slide-router-plugin.git
claude --plugin-dir ./tube-slide-router-plugin
```

또는 폴더 안에서:

```bash
cd tube-slide-router-plugin
claude --plugin-dir .
```

### 설치가 잘 됐는지 확인

세션에서 `/tsr-router` 를 치면 상태·설정 패널이 뜹니다. 또, 매 턴 터미널 **상태줄**에 `TSR …` 로 시작하는 줄이 보이면 정상 동작 중입니다(상태줄 읽는 법은 아래 4번).

---

## 2. 처음 설정 (선택)

깔자마자 바로 써도 되지만, 처음에 한 번 취향을 정하고 싶다면:

- **`/tsr-router quicksetup`** — 시작 방식, `modelFloor`(모델 하한), 등급표 프로필을 **질문에 답하는 방식**으로 한 번에 정합니다. `/config`로는 담기 어려운 값까지 챙겨줍니다.
- **`/config` 메뉴** — Claude Code 기본 설정 메뉴에서 아래 5가지를 켜고 끌 수 있습니다. 값은 계정에 저장되어 다음 세션에도 유지됩니다.
  - `mode` (등급표 출처), `statusLineEnabled` (상태줄 표시), `calibrationEnabled` (자동 보정), `budgetEnabled` / `budgetDailyUsd` (예산 가드)

더 세밀한 값(등급별 모델 매핑 `routes`, 위험영역 `riskAreas`)은 설정 파일에서 바꿉니다 → 아래 5번.

---

## 3. 명령어

모든 명령은 Claude Code 세션 프롬프트에 입력합니다.

| 명령 | 설명 |
| --- | --- |
| `/tsr-router` | 상태와 설정을 보여주는 패널 열기 |
| `/tsr-router status` | 상태를 텍스트로 보기 |
| `/tsr-router off` / `on` | 이번 세션 라우팅 끄기 / 켜기 |
| `/tsr-router hungry` / `normal` | 이번 세션을 `상` 등급으로 고정 / 해제 |
| `/tsr-router pin <모델> <effort>` | 이번 세션만 즉석으로 모델·effort 고정 (설정 파일은 안 건드림, `off`보다 우선) |
| `/tsr-router unpin` | 고정 해제, 원래(auto/manual) 라우팅으로 복귀 |
| `/tsr-router quicksetup` | 질문에 답하며 처음 설정하기 (시작방식·modelFloor·등급표) |
| `/tsr-router setup` | 등급표·예산 설정 패널 열기 |
| `/tsr-router export` | 팀 공유용 보정 통계를 프로젝트 파일로 내보내기 |
| `/tsr-router compare <프롬프트>` | 같은 작업을 고정 모델과 TSR 라우팅으로 둘 다 실행해 비교 (**실제 과금 발생** — 아래 6번) |
| `/tsr-docs` | 주요 지침 문서가 가리키는 경로가 실제로 있는지 검사 |

**예시**
```text
/tsr-router pin sonnet high      # 이번 세션은 무조건 Sonnet/high로
/tsr-router unpin                # 다시 자동 라우팅으로
/tsr-router off                  # 잠깐 라우팅 끄기(세션 기본 모델 그대로)
```

---

## 4. 상태줄 읽는 법

매 턴 터미널 상태줄에 이렇게 뜹니다.

```
TSR AUTO · 활성 | Tier: 하 | Routed: haiku/medium | 적용: claude-haiku-5-5
```

- **`TSR {모드} · 활성`** — 지금 동작 모드와 활성 표시. 우선순위 `pin` > `off` > `hungry` > `auto`/`manual` 순으로 높은 쪽이 표시됩니다.
- **`Tier: {등급}`** — 이번 요청이 분류된 난이도(극소/하/중/상/최상). 같은 턴 안에서 승급되면 `Tier: 하→중`처럼 보입니다. `pin`·`off`처럼 분류를 안 하는 경로에서는 안 뜹니다.
- **`Routed: {모델}/{effort}`** — TSR이 실제로 그 턴에 요청한 모델·effort. (예전 라벨 `Selected`에서 바뀜 — 사용자가 고른 게 아니라 TSR이 자동으로 고른 값이라서.)
- **`적용: {모델}`** — 실제로 응답한 모델(`result.usage.model`로 확인된 값). **모델 이름만** 보여줍니다 — effort는 Claude Code 응답(`usage`)에 필드 자체가 없어 독립 확인이 불가능하므로, 거짓으로 "확인됨"을 암시하지 않기 위해 상태줄에는 표시하지 않습니다. (응답을 아직 못 받은 턴에는 `적용:` 부분이 안 붙습니다.)

상태줄이 거슬리면 `/config`의 `statusLineEnabled`를 끄거나 설정 파일에 `"statusLine": { "enabled": false }`로 끌 수 있습니다(라우팅 자체는 그대로 동작).

> **참고**: 터미널 하단 기본 상태바의 모델 이름이나, 모델에게 "너 무슨 모델이야?"라고 물은 답은 TSR 개입을 반영하지 않을 수 있습니다. TSR은 세션 기본 모델 설정은 건드리지 않고 **그 턴의 API 호출만 바꿔치기**하기 때문입니다. 실제 처리 모델은 위 `적용:` 값이나 `.claude/tsr-telemetry.jsonl`의 `actualModel`로 확인하세요.

---

## 5. 설정

우선순위는 **기본값 < `/config` < 프로필 파일 < 프로젝트 파일** 순이며, 더 구체적인 범위가 항상 이깁니다.

- **가장 쉬운 길**: `/config` 메뉴 (위 2번의 5가지 항목). 파일을 안 만들어도 됩니다.
- **세밀한 값**: 아래 설정 파일. `routes`(등급별 모델/effort), `riskAreas`는 중첩 구조라 `/config`로는 못 바꾸고 파일에서만 바꿉니다.
  - 프로필(계정) 설정: `$CLAUDE_CONFIG_DIR/tube-slide-router.json` (기본값 `~/.claude/…`)
  - 프로젝트 설정: `<프로젝트>/.claude/tube-slide-router.json` (프로필보다 우선)

**설정 파일 예시**
```json
{
  "version": 1,
  "mode": "manual",
  "routes": {
    "극소": { "model": "haiku", "effort": "medium" },
    "하": { "model": "haiku", "effort": "medium" },
    "중": { "model": "sonnet", "effort": "high" },
    "상": { "model": "sonnet", "effort": "high" },
    "최상": { "model": "opus", "effort": "high" }
  },
  "budget": { "enabled": false, "dailyUsd": 20, "warnPct": 70, "savePct": 90 },
  "calibration": { "enabled": false },
  "statusLine": { "enabled": true }
}
```

- `mode: "auto"` — 기본 등급표를 그대로 사용. `manual`에서만 `routes`를 바꿀 수 있습니다.
- **기본 등급표**(위 예시와 동일): 극소·하 = Haiku/medium, 중·상 = Sonnet/high, 최상 = Opus/high.
- **`modelFloor`**(모델 하한, 기본 `haiku`): 라우터가 내려갈 수 있는 가장 낮은 모델. 기본값이라 저난이도는 실제로 Haiku까지 내려갑니다. 품질을 더 보수적으로 보려면 `"modelFloor": "sonnet"`으로 올리면 Haiku로 안 내려갑니다.
- **예산 가드(`budget`)**: 켜면 하루 API 환산 비용이 임계치(기본 경고 70%, 절약 90%, 상한 $20)를 넘을 때 등급 천장을 제한합니다.
- **자동 보정(`calibration`)**: 기본 꺼짐. 실제 팀 기록이 충분히 쌓인 뒤에만 켜세요.

---

## 6. 비교 모드 (`/tsr-router compare`)

같은 작업을 (1) 고정 모델(기본 `claude-sonnet-5-5`/`high`)과 (2) TSR 라우팅으로 **둘 다 실행**해 비용·소요시간을 비교합니다.

> ⚠️ **주의**: 두 번 실행하므로 **실제 API 비용이 최대 2배** 들고, 현재 구현은 **실행 전 확인 절차 없이 바로 실행**됩니다.

- **git 저장소에서만** 동작합니다. 커밋 안 된 변경이 있으면 먼저 커밋/stash하라며 거부합니다(두 실행 모두 `HEAD` 기준 별도 worktree에서 돌기 때문).
- 두 경우를 **순차 실행**한 뒤, 각 모델/effort/비용/소요시간과 **작업공간(worktree) 경로**를 보여줍니다.
- **결과물이 맞게 동작하는지는 자동 판정하지 않습니다**(정답을 아는 채점 스크립트가 없는 임의 작업이라, 지어낸 품질 수치를 보여주지 않는다는 원칙). 두 worktree를 직접 열어 비교하세요.
- **worktree는 자동으로 지우지 않습니다** — 다 보고 나면 `git worktree remove <경로>`로 직접 정리하세요.
- 한 실행이 10분(실행 타임아웃 상한)을 넘기면 그 쪽은 실패로 처리됩니다.

---

## 7. 알아두면 좋은 동작

- **keep-warm**: 직전 턴이 더 강한 등급(예: 상)으로 처리됐다면, 바로 다음 턴이 `극소`로 분류돼도 그 강한 등급을 유지합니다. 모델을 내렸다 금방 올리면 캐시가 매번 새로 만들어지는 비용이 드는데, 극소 턴은 어느 모델로 처리하든 체감 차이가 거의 없어 직전 등급에 얹혀가는 쪽이 더 쌉니다. (버그가 아니라 의도된 설계. 끄려면 설정에서 `keepWarmForMicro: false`.)
- **턴 중 승급**: 테스트처럼 보이는 명령이 수정 사이에 두 번 연속 실패하면 한 등급 올립니다. 작업 중에는 다시 낮추지 않습니다.
- **텔레메트리/비용 집계는 프로젝트별**로 분리됩니다. 저장되는 건 해시된 멤버 ID와 등급별 턴·승급 수뿐이며, 프롬프트나 파일 경로는 저장하지 않습니다.
