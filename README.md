# 2027년 3월 일본 골프·온천 여행 — 오전 도착 가능 공항 탐색

인천공항(ICN)에서 **직항**으로 일본 현지에 **12:00 이전 도착**이 가능한 공항을 추려,
3월 골프 가능 여부와 온천 접근성까지 합쳐 후보 도시를 판정한다.

## 페이지 주소

| 주소 | 성격 | 갱신 |
|---|---|---|
| **https://my1014mh-ctrl.github.io/japan-golf-onsen/** | 공개 (로그인 불필요) | 월요일 배치가 자동 push → 자동 반영 |
| https://claude.ai/code/artifact/d3d3d50b-0ad6-448e-bd8f-54e252b04b2b | 비공개 (Claude 로그인) | 수동 재발행 필요 |

휴대폰에서는 GitHub Pages 주소를 쓰면 로그인 없이 바로 열린다.

### 호스팅 설정 (최초 1회, 이미 완료)

```bash
gh auth login                        # 브라우저 인증
bash scripts/setup-github-pages.sh   # 저장소 생성 + push + Pages 활성화
```

`.env`의 `PUBLISH_TARGET=github` 때문에 `scripts/run-weekly.sh`가 끝날 때 자동으로
commit + push 하고, GitHub Pages가 1~2분 내 반영한다. `surge`로 바꾸면 surge.sh로 배포한다.

## 판정 로직

한국(KST)과 일본(JST)은 **시차가 없다**. 따라서:

```
현지 도착시각 = 인천 출발시각 + 운항시간(block time)
```

공식 API는 인천 출발시각만 제공하므로, 목적지별 운항시간(`data/airports.json` → `blockMinutes`)을
더해 도착시각을 계산한다. 반대로 커트오프를 맞추기 위한 **출발 마감시각 = 12:00 − 운항시간**도 함께 산출한다.

### 여행 일정 조건 (고정)

**인천 출발 목요일 → 귀국 일요일, 3박 4일.** 2027년 3월 후보 창 4개:

| 창 | 특징 |
|---|---|
| 3/4 → 3/7 | 최저가·한산. 호쿠리쿠·도호쿠 잔설 리스크 최대 |
| 3/11 → 3/14 | 일본 공휴일 없음 → 예약 경쟁 최저. 기본값 |
| 3/18 → 3/21 | 귀국일이 춘분의 날(3/21 일) + 3/22 대체휴일 → 3연휴 시작, 그린피 할증 |
| 3/25 → 3/28 | 귀국일이 IATA 하계시즌 첫날 → 스케줄 변경 주의. 벚꽃 시기 |

일정은 `data/trip.json`에서 변경하거나 `--depart-day=4 --return-day=7` (1=월 … 7=일)로 덮어쓴다.

### 일자별 활동 계획 (고정)

| 요일 | 활동 | 판정에 쓰이는 값 |
|---|---|---|
| 목 | 도착 + 골프 | 도착시각 → 티업 = 도착 + 2시간 |
| 금 | 골프 | 평일 → 2사무 할증 없는 플랜 사용 가능 |
| 토 | 쇼핑 + 온천 | 도시 쇼핑 등급, 온천 이동시간 |
| 일 | 온천 + 귀국 | 귀국편 출발 − 수속 2시간 − 공항이동 1시간 |

**라운딩은 목·금 최대 2회.** 도착이 늦어 목요일 티업이 14:30을 넘으면 1회로 떨어진다.
목요일 티업 판정: 12:00 이전 `여유` / 13:30 이전 `가능` / 14:30 이전 `타이트` / 이후 `불가`
(3월 일몰 18시 전후, 셀프 18홀 4시간 30분 기준)

### 골프장: 공항 50km + 2인 플레이

`data/golf-courses.json` — 공항 반경 50km 이내 + 공항↔도시 축선상(`corridor`)의 코스만 수록.

| `twosome` | 의미 |
|---|---|
| `all-days` | 전일 2사무 가능 (주말·공휴일 포함) |
| `weekday` | 평일 2사무 보증 — **목·금 플레이에 그대로 유효** |
| `available` | 2사무 보증/가능 플랜 존재, 날짜별 조건 확인 |
| `unknown` | 미확인 — 카드의 GDO 링크로 확인 |

일본은 3~4인 플레이가 기본이고 2사무는 1인당 500~2,200엔 할증이 붙는다.
**할증 없는 플랜은 평일 한정이 많고 토·일·공휴일은 2사무 대상에서 제외되는 코스가 많다** —
목·금 플레이가 이 문제를 구조적으로 피한다. `noSurcharge: true`는 할증 없음이 확인된 코스.

각 공항 카드에는 해당 都道府県의 GDO 2사무 검색 링크가 자동 생성된다.

### 귀국편이 일요일을 가른다

귀국편 일본 출발 시각 − 공항수속 2시간 − 공항이동 1시간 = **일요일 현지 활동 마감 시각**.
조조 티업(07:00) + 라운딩 5시간이 그 안에 들어가면 일요일 라운딩 1회가 추가된다.

- **간선 노선**(후쿠오카·오사카·도쿄·나고야): 저녁 귀국편 → 일요일 온천·쇼핑 온전히 사용
- **1일 1왕복 노선**(미야자키·나가사키 등): 귀국편이 낮 출발 → 일요일 소실
  (귀국편 시각은 `아웃바운드 도착 + 지상조업 60분`으로 역산하며 페이지에 '역산' 표시)

일요일 가용시간(09:00 기준): 6시간+ `온천 + 쇼핑 모두` / 4시간+ `온천 또는 쇼핑` / 2시간+ `아침 온천만` / 그 이하 `이동만`

### 두 개의 도착 기준선

| 기준 | 의미 |
|---|---|
| **12:00 이전 도착** (`--cutoff`) | 당일 **오후 라운딩** 또는 온천 입실 가능 |
| **10:00 이전 도착** (`--early`) | 당일 **오전 라운딩** 가능 → 카드 배지·통계·필터·편별 마크로 별도 표기 |

점수 = 골프(×3) + 온천(×2) + 도착 여유시간 + 편수 유연성 + 10시 전 도착(+2) − 온천 2시간 초과 감점

| 등급 | 의미 |
|---|---|
| A | 최우선 후보 (골프·온천 모두 상위) |
| B | 유력 후보 |
| C | 조건부 (3월 날씨 리스크 또는 온천 전용) |
| X | 오전 도착 불가 |

## 실행

```bash
node src/build.mjs                  # 베이스라인(추정) 데이터로 생성
node src/build.mjs --source=api     # 공공데이터포털 실제 스케줄로 생성
node src/build.mjs --cutoff=10:30   # 커트오프 변경
bash scripts/run-weekly.sh          # 주간 배치 (갱신 + 지난주 대비 diff)
```

결과: `docs/index.html` (웹페이지), `out/analysis.json` (원자료)

## 실제 운항시각 연동 (권장)

1. [공공데이터포털 — 인천국제공항공사_여객기 정기운항편 일정 정보](https://www.data.go.kr/data/15095059/openapi.do) 활용 신청 (개발계정 즉시 승인, 일 1,000건)
2. `cp .env.example .env` 후 **Decoding 키**를 `DATA_GO_KR_KEY`에 입력
3. `node src/build.mjs --source=api`

엔드포인트: `https://apis.data.go.kr/B551177/PaxFltSched/getPaxFltSchedDepartures`
(도착편은 `getPaxFltSchedArrivals`. 경로 변경 시 `ICN_SCHED_OPERATIONS` 환경변수로 override)

키가 없으면 `data/routes-baseline.json`의 **추정 오전 출발 윈도우**로 가능성만 판정하며,
페이지 상단에 추정 데이터 배너가 표시된다.

## 매주 월요일 배치

```bash
mkdir -p logs
cp scripts/com.jgo.weekly.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.jgo.weekly.plist   # 매주 월 09:00 실행
launchctl start com.jgo.weekly                               # 즉시 1회 테스트
launchctl unload ~/Library/LaunchAgents/com.jgo.weekly.plist # 해제
```

배치는 `out/history/analysis-YYYY-MM-DD.json`으로 주차별 스냅샷을 남기고,
지난 주 대비 **신규 가능 / 불가 전환 / 도착시각 변경**을 `logs/weekly-*.log`에 기록한다.

## 2027년 3월 주의사항

- **IATA 하계시즌이 2027-03-28 시작**. 3월 하순 출발이면 동계/하계 스케줄이 갈린다.
- 홋카이도(CTS/HKD/AKJ)·아오모리는 3월 골프 코스 적설 휴장 → 온천 전용.
- 도착 12:00이면 수하물·렌터카·이동을 감안해 현실적 티업은 오후 1~2시.

## 구조

```
data/airports.json          공항 메타(운항시간, 3월 골프, 온천, 쇼핑, 날씨)
data/golf-courses.json      공항 50km 내 골프장 + 2인 플레이 가능 여부
data/trip.json              일정 조건(목→일, 일자별 활동, 후보 창)
data/routes-baseline.json   추정 오전 출발 윈도우 (API 미연동 시 사용)
src/sources/icnOpenApi.mjs  공공데이터포털 정기운항편 API
src/sources/baseline.mjs    베이스라인 로더
src/analyze.mjs             커트오프 필터 + 공항 평가/점수
src/render.mjs              웹페이지 생성 (필터·정렬 포함, 의존성 0)
src/build.mjs               엔트리
scripts/run-weekly.sh       주간 배치
scripts/diff.mjs            주간 변동 비교
```

## 다음 단계

- [ ] 실제 API 키 연동 → 편명 단위 시각 확정
- [ ] 2사무 `unknown` 코스 해소 — GDO/楽天GORA 2사무 목록 주간 스크래핑
- [ ] 코스별 3월 티업 가능 시간·그린피 실데이터
- [ ] 온천 숙소(료칸) 체크인 시간 + 공항 이동 교통편 연결
- [ ] 항공권 가격 추이 주간 추적
