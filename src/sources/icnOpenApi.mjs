// 인천국제공항공사_여객기 정기운항편 일정 정보 (공공데이터포털)
//   신청: https://www.data.go.kr/data/15095059/openapi.do
//   엔드포인트: https://apis.data.go.kr/B551177/PaxFltSched/getPaxFltSchedDepartures
// 이 API는 '인천 출발 시각(st)'만 제공하므로, 목적지 도착시각은
// data/airports.json 의 blockMinutes 를 더해서 계산한다(한일 시차 0).

const BASE = 'https://apis.data.go.kr/B551177/PaxFltSched';
// 확인된 경로: .../PaxFltSched/getPaxFltSchedDepartures (출발), getPaxFltSchedArrivals (도착)
const OPERATIONS = (process.env.ICN_SCHED_OPERATIONS ?? 'getPaxFltSchedDepartures').split(',');
const ARRIVAL_OPERATIONS = (process.env.ICN_SCHED_ARR_OPERATIONS ?? 'getPaxFltSchedArrivals').split(',');

// 공공데이터포털 공통 오류코드
const PORTAL_ERRORS = {
  '1': '애플리케이션 오류',
  '4': 'HTTP 오류',
  '12': '해당 오픈API 서비스가 없거나 폐기됨 (경로 확인)',
  '20': '서비스 접근 거부',
  '22': '일일 호출 한도 초과',
  '30': '등록되지 않은 서비스키 (data.go.kr 신청/승인 확인, Decoding 키 사용)',
  '31': '활용기간 만료',
  '32': '등록되지 않은 IP',
  '33': '서명되지 않은 호출',
};
const FATAL_CODES = new Set(['20', '22', '30', '31', '32', '33']);

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
  }
  return null;
};

const DAY_KEYS = [
  ['monday', 'mon', 'Monday'],
  ['tuesday', 'tue', 'Tuesday'],
  ['wednesday', 'wed', 'Wednesday'],
  ['thursday', 'thu', 'Thursday'],
  ['friday', 'fri', 'Friday'],
  ['saturday', 'sat', 'Saturday'],
  ['sunday', 'sun', 'Sunday'],
];

function normalizeDays(item) {
  const flags = DAY_KEYS.map((keys) => {
    const v = pick(item, keys);
    return v != null && /^(y|1|o|true)$/i.test(v);
  });
  return flags.some(Boolean) ? flags : null; // 전부 비었으면 미상 처리
}

function normalizeTime(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 3) return null;
  const padded = digits.slice(0, 4).padStart(4, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

async function callOnce(op, { key, pageNo, numOfRows, airport }) {
  const url = new URL(`${BASE}/${op}`);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(numOfRows));
  url.searchParams.set('type', 'json');
  url.searchParams.set('lang', 'K');
  if (airport) url.searchParams.set('airport', airport);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`JSON 파싱 실패(XML 응답 가능): ${text.slice(0, 200)}`);
  }

  // 포털 게이트웨이 수준 오류 (키·한도·경로)
  const gate = json?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gate) {
    const code = String(gate.returnReasonCode ?? '');
    const err = new Error(`[${code}] ${PORTAL_ERRORS[code] ?? gate.returnAuthMsg ?? gate.errMsg ?? '알 수 없는 오류'}`);
    err.fatal = FATAL_CODES.has(code);
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);

  const body = json?.response?.body ?? json?.body ?? json;
  const header = json?.response?.header ?? json?.header;
  if (header?.resultCode && !/^0+$/.test(String(header.resultCode))) {
    throw new Error(`API 오류 ${header.resultCode}: ${header.resultMsg ?? ''}`);
  }
  const rawItems = body?.items?.item ?? body?.items ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems].filter(Boolean);
  return { items, totalCount: Number(body?.totalCount ?? items.length) };
}

// 지원 공항 코드 집합을 받아 인천 출발 일본행 정기편만 추려 반환
export async function fetchIcnSchedules({ key, japanAirports, maxPages = 25, numOfRows = 500 }) {
  if (!key) throw new Error('DATA_GO_KR_KEY 가 설정되지 않았습니다.');
  const allowed = new Set(japanAirports);
  let lastError;

  for (const op of OPERATIONS) {
    try {
      const collected = [];
      let total = Infinity;
      for (let pageNo = 1; pageNo <= maxPages && collected.length < total; pageNo += 1) {
        const { items, totalCount } = await callOnce(op, { key, pageNo, numOfRows });
        total = totalCount;
        collected.push(...items);
        if (items.length === 0) break;
      }

      const byAirport = new Map();
      for (const item of collected) {
        const code = pick(item, ['airportCode', 'airportcode', 'iata', 'arrAirportCode']);
        if (!code || !allowed.has(code)) continue;
        const dep = normalizeTime(pick(item, ['st', 'stTime', 'scheduleTime', 'depTime', 'time']));
        if (!dep) continue;
        const entry = {
          airline: pick(item, ['airline', 'airlineKorean', 'airlineName']) ?? '미상',
          flightNo: pick(item, ['flightId', 'flightNo', 'flightNumber', 'masterFlightId']) ?? null,
          depTime: dep,
          days: normalizeDays(item),
          validFrom: pick(item, ['firstdate', 'firstDate', 'startDate']),
          validTo: pick(item, ['lastdate', 'lastDate', 'endDate']),
          season: pick(item, ['season', 'seasonCode']),
          codeshare: pick(item, ['codeShare', 'codeshare']),
        };
        if (!byAirport.has(code)) byAirport.set(code, []);
        byAirport.get(code).push(entry);
      }

      if (byAirport.size === 0) throw new Error('일본행 정기편을 찾지 못했습니다(응답 필드 구조 확인 필요).');

      const routes = [...byAirport.entries()].map(([iata, flights]) => {
        const deduped = [...new Map(flights.map((f) => [`${f.flightNo}|${f.depTime}`, f])).values()]
          .sort((a, b) => a.depTime.localeCompare(b.depTime));
        return {
          iata,
          carriers: [...new Set(deduped.map((f) => f.airline))],
          dailyFlights: deduped.length,
          earliestDep: deduped[0]?.depTime ?? null,
          morningDepWindow: null,
          confidence: 'official',
          flights: deduped,
        };
      });

      return {
        source: 'api',
        label: `공공데이터포털 정기운항편 API (${op})`,
        fetchedAt: new Date().toISOString(),
        meta: { operation: op, rawCount: collected.length },
        routes,
      };
    } catch (err) {
      if (err.fatal) throw err;          // 키/한도 문제면 다른 경로를 시도해도 의미 없음
      lastError ??= err;                 // 첫 오류가 가장 정확한 단서
    }
  }
  throw lastError ?? new Error('API 호출 실패');
}


/**
 * 귀국편(일본 → 인천) 조회. 이 API의 st 는 '인천 도착 시각'이므로
 * 일본 현지 출발 시각 = 인천 도착 − 운항시간 으로 역산한다.
 * @param {Map<string,number>} blockByIata 공항별 운항시간
 */
export async function fetchIcnArrivals({ key, blockByIata, returnDow = 7, maxPages = 25, numOfRows = 500 }) {
  if (!key) throw new Error('DATA_GO_KR_KEY 가 설정되지 않았습니다.');
  let lastError;

  for (const op of ARRIVAL_OPERATIONS) {
    try {
      const collected = [];
      let total = Infinity;
      for (let pageNo = 1; pageNo <= maxPages && collected.length < total; pageNo += 1) {
        const { items, totalCount } = await callOnce(op, { key, pageNo, numOfRows });
        total = totalCount;
        collected.push(...items);
        if (items.length === 0) break;
      }

      const byAirport = new Map();
      for (const item of collected) {
        const code = pick(item, ['airportCode', 'airportcode', 'iata', 'depAirportCode']);
        if (!code || !blockByIata.has(code)) continue;
        const arrICN = normalizeTime(pick(item, ['st', 'stTime', 'scheduleTime', 'arrTime', 'time']));
        if (!arrICN) continue;
        const days = normalizeDays(item);
        const block = blockByIata.get(code);
        const [h, m] = arrICN.split(':').map(Number);
        const depJSTmin = ((h * 60 + m - block) % 1440 + 1440) % 1440;
        const entry = {
          airline: pick(item, ['airline', 'airlineKorean', 'airlineName']) ?? '미상',
          flightNo: pick(item, ['flightId', 'flightNo', 'flightNumber', 'masterFlightId']) ?? null,
          depJST: `${String(Math.floor(depJSTmin / 60)).padStart(2, '0')}:${String(depJSTmin % 60).padStart(2, '0')}`,
          arrICN,
          days,
          operatesReturnDow: days ? Boolean(days[returnDow - 1]) : null,
        };
        if (!byAirport.has(code)) byAirport.set(code, []);
        byAirport.get(code).push(entry);
      }

      if (byAirport.size === 0) throw new Error('일본발 정기편을 찾지 못했습니다(응답 필드 구조 확인 필요).');

      const returns = {};
      for (const [iata, list] of byAirport) {
        const deduped = [...new Map(list.map((f) => [`${f.flightNo}|${f.arrICN}`, f])).values()]
          .sort((a, b) => a.depJST.localeCompare(b.depJST));
        const onDow = deduped.filter((f) => f.operatesReturnDow !== false);
        returns[iata] = {
          flights: deduped,
          onReturnDow: onDow,
          lastReturnDep: onDow.at(-1)?.depJST ?? null,
          returnPattern: onDow.length >= 3 ? 'all-day' : 'single-rotation',
        };
      }
      return { source: 'api', operation: op, returns };
    } catch (err) {
      if (err.fatal) throw err;
      lastError ??= err;
    }
  }
  throw lastError ?? new Error('귀국편 API 호출 실패');
}
