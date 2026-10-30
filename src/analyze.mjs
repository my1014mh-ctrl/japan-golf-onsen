import { readFile } from 'node:fs/promises';
import { toMinutes, toHHMM, addMinutes, durationLabel, daysLabel } from './lib/time.mjs';

const DOW_NAMES = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 7: '일' };

export async function loadCourses() {
  const raw = await readFile(new URL('../data/golf-courses.json', import.meta.url), 'utf8');
  const data = JSON.parse(raw);
  // 예약사이트 ID(enrich.mjs 수집본) 병합 — 없으면 그대로 진행
  try {
    const bk = JSON.parse(await readFile(new URL('../data/booking.json', import.meta.url), 'utf8'));
    data.booking = bk;
    for (const c of data.courses) {
      c.booking = {
        gora: bk.gora?.[c.ja] ?? null,
        jalan: bk.jalan?.[c.ja] ?? null,
        fallback: bk.prefFallback?.[c.pref] ?? null,
      };
      c.bookable = Boolean(c.booking.gora || c.booking.jalan);
    }
  } catch {
    for (const c of data.courses) { c.booking = { gora: null, jalan: null, fallback: null }; c.bookable = false; }
  }
  return data;
}

export async function loadTrip() {
  const raw = await readFile(new URL('../data/trip.json', import.meta.url), 'utf8');
  return JSON.parse(raw).trip;
}

// days: '1234567' 문자열 또는 7칸 배열. 데이터가 없으면 null(미상) → 판정 보류
function operatesOn(days, dow) {
  if (!days) return null;
  return Array.isArray(days) ? Boolean(days[dow - 1]) : String(days).includes(String(dow));
}

export async function loadAirports() {
  const raw = await readFile(new URL('../data/airports.json', import.meta.url), 'utf8');
  return JSON.parse(raw).airports;
}

const RATING_WORDS = ['불가', '제한적', '양호', '최적'];

const TWOSOME_RANK = { 'all-days': 3, weekday: 2, available: 1, unknown: 0 };

function gdoTwosomeUrl(pref, stateMap) {
  const state = stateMap?.[pref];
  if (!state) return null;
  return `https://reserve.golfdigest.co.jp/s/category/2some/r/?state=${encodeURIComponent(state)}&prefecture=${encodeURIComponent(pref)}`;
}

/**
 * 공항 반경(기본 50km) + 공항↔도시 축선상의 코스만 추린다.
 * 플레이 요일이 평일(목·금)이면 'weekday' 2사무도 그대로 사용 가능하다.
 */
function matchCourses(iata, courseData, { radiusKm, hasWeekendRound, returnDowIsWeekend }) {
  const all = (courseData?.courses ?? []).filter((c) => c.iata === iata);
  const stateMap = courseData?.meta?.gdoStateByPrefecture;
  const decorate = (c) => ({
    ...c,
    twosomeRank: TWOSOME_RANK[c.twosome] ?? 0,
    // 목·금(평일)에 2인 플레이 가능한가
    twosomeWeekday: ['all-days', 'weekday', 'available'].includes(c.twosome),
    // 일요일(주말)에 2인 플레이 가능한가 — '평일 한정' 플랜은 쓸 수 없다
    twosomeWeekend: c.twosome === 'all-days' ? true : c.twosome === 'available' ? null : false,
    verifyUrl: gdoTwosomeUrl(c.pref, stateMap),
  });

  const inRadius = all.filter((c) => c.distanceKm <= radiusKm).map(decorate);
  for (const c of inRadius) c.twosomeUsable = c.twosomeWeekday;
  const prestigeRe = /(명문|토너먼트|최고|最古|굴지|성지|100대)/;
  const corridor = inRadius.filter((c) => c.corridor);
  const usable = inRadius.filter((c) => c.twosomeWeekday);
  const weekendUsable = inRadius.filter((c) => c.twosomeWeekend === true);
  const weekendMaybe = inRadius.filter((c) => c.twosomeWeekend === null);
  // 귀국일 라운딩에 쓸 수 있는 코스 — 귀국일이 평일이면 평일 플랜도 유효
  const returnDayUsable = returnDowIsWeekend ? weekendUsable : usable;
  for (const c of inRadius) c.twosomeReturnDay = returnDowIsWeekend ? c.twosomeWeekend : c.twosomeWeekday;

  for (const c of inRadius) c.prestige = prestigeRe.test(c.pedigree ?? '');
  const sortKey = (a, b) => b.twosomeRank - a.twosomeRank || a.distanceKm - b.distanceKm;
  return {
    radiusKm,
    inRadius: [...inRadius].sort(sortKey),
    outOfRadius: all.filter((c) => c.distanceKm > radiusKm).map(decorate),
    counts: {
      total: all.length,
      inRadius: inRadius.length,
      corridor: corridor.length,
      twosomeUsable: usable.length,
      twosomeWeekend: weekendUsable.length,
      twosomeWeekendMaybe: weekendMaybe.length,
      twosomeReturnDay: returnDayUsable.length,
      twosomeUnknown: inRadius.filter((c) => c.twosome === 'unknown').length,
      bookable: inRadius.filter((c) => c.bookable).length,
      gora: inRadius.filter((c) => c.booking?.gora).length,
      jalan: inRadius.filter((c) => c.booking?.jalan).length,
      prestige: inRadius.filter((c) => c.prestige).length,
      prestigeBookable: inRadius.filter((c) => c.prestige && c.bookable).length,
      prestigeReady: inRadius.filter((c) => c.prestige && c.bookable && c.twosomeUsable).length,
    },
    best: [...usable].sort(sortKey)[0] ?? null,
    bestWeekend: [...weekendUsable].sort(sortKey)[0] ?? null,
    weekendNote: hasWeekendRound
      ? (weekendUsable.length
        ? `주말 라운딩 2인 가능 ${weekendUsable.length}곳 (전일 2사무)`
        : weekendMaybe.length
          ? `주말 라운딩 2인은 ${weekendMaybe.length}곳에서 조건 확인 필요`
          : '주말 라운딩 2인 가능 코스 확인 안 됨 — 평일 한정 플랜만 있음')
      : null,
    verifyUrl: all.length ? gdoTwosomeUrl(all[0].pref, stateMap) : null,
  };
}

/**
 * 도착일(목) 라운딩 성립 여부. 도착 후 수하물·렌터카·이동에 2시간을 둔다.
 * 3월 일몰은 18시 전후, 셀프 18홀은 약 4시간 30분.
 */
function evaluateArrivalRound(earliestArrival) {
  if (!earliestArrival) return { possible: false, quality: '불가', score: 0, teeOff: null };
  const teeOffMin = toMinutes(earliestArrival) + 120;
  const teeOff = toHHMM(teeOffMin);
  if (teeOffMin <= 12 * 60) return { possible: true, quality: '여유', score: 3, teeOff };
  if (teeOffMin <= 13 * 60 + 30) return { possible: true, quality: '가능', score: 2, teeOff };
  if (teeOffMin <= 14 * 60 + 30) return { possible: true, quality: '타이트', score: 1, teeOff, note: '일몰 전 종료 빠듯 — 하프 라운딩 대안' };
  return { possible: false, quality: '불가', score: 0, teeOff, note: '도착일 라운딩 불가 — 금요일 1회만' };
}

/**
 * 귀국일(일요일) 활용도 판정.
 * 일본 현지 출발 lastReturnDep 에서 공항 수속(airportLead)과 공항 이동(60분)을 빼면
 * 현지 활동을 끝내야 하는 시각이 나온다. 18홀은 약 5시간 필요.
 */
function evaluateReturn({ route, block, trip, returnDow }) {
  const lead = trip.airportLeadMinutes ?? 120;
  const toAirport = 60;
  const roundMin = (trip.roundHours ?? 5) * 60;
  const earliestTeeOff = 7 * 60; // 현지 07:00 조조 티업 가정

  let depJST = route.lastReturnDep;
  let derived = false;
  if (!depJST) {
    // 1일 1편 왕복 노선: 아웃바운드 도착 + 지상조업 60분 = 귀국편 출발
    const out = route.earliestDep ?? route.morningDepWindow?.[0];
    if (out) {
      depJST = addMinutes(out, block + 60);
      derived = true;
    }
  }
  if (!depJST) return null;

  // 귀국편이 귀국 요일에 운항하는지 — 주 몇 회 노선은 일요일 편이 없을 수 있다
  const operatesOnReturnDay = route.returnDays
    ? operatesOn(route.returnDays, returnDow)
    : null; // 정보 없음

  const depMin = toMinutes(depJST);
  const lastActivityMin = depMin - lead - toAirport;
  const canRound = lastActivityMin >= earliestTeeOff + roundMin;

  // 토·일은 쇼핑·온천 일정이므로 귀국일 가용시간(09:00 기준)으로 평가한다
  const leisureMin = Math.max(0, lastActivityMin - 9 * 60);
  const leisureHours = Math.round((leisureMin / 60) * 10) / 10;

  let rating;
  let label;
  if (leisureMin >= 6 * 60) { rating = 3; label = '온천 + 쇼핑 모두'; }
  else if (leisureMin >= 4 * 60) { rating = 2; label = '온천 또는 쇼핑'; }
  else if (leisureMin >= 2 * 60) { rating = 1; label = '아침 온천만'; }
  else { rating = 0; label = '이동만'; }

  return {
    depJST,
    derived,
    operatesOnReturnDay,
    returnDays: route.returnDays ?? null,
    pattern: route.returnPattern ?? 'unknown',
    lastActivity: toHHMM(lastActivityMin),
    canRound,
    leisureHours,
    rating,
    label,
    word: RATING_WORDS[rating],
  };
}

function verdictFor({ feasible, golf, onsen, shopping, rounds, twosome }) {
  if (!feasible) return { tier: 'X', label: '오전 도착 불가', reason: '12시 전 도착 가능한 직항편 없음' };
  if (golf === 0) return { tier: 'C', label: '온천 전용', reason: '3월 골프 코스 휴장 — 목·금 라운딩 불가' };
  if (rounds <= 1) return { tier: 'C', label: `라운딩 ${rounds}회`, reason: '도착이 늦거나 귀국편이 일러 라운딩 일수 부족' };
  if (rounds === 2) return { tier: 'C', label: '라운딩 2회', reason: '목·금·일 3회 중 1회 불가 (도착 또는 귀국편 시각)' };
  if (golf >= 2 && onsen >= 2 && shopping >= 2 && twosome > 0) {
    return { tier: 'A', label: '최우선 후보', reason: '목·금 2라운딩 + 2인 플레이 가능 + 토·일 쇼핑·온천 모두 충족' };
  }
  if (golf >= 2 && onsen >= 2 && shopping >= 1) return { tier: 'A', label: '최우선 후보', reason: '골프·온천 상위, 쇼핑 보통' };
  if (golf >= 2 && (onsen >= 2 || shopping >= 2)) return { tier: 'B', label: '유력 후보', reason: '골프 + 온천/쇼핑 한쪽 강점' };
  if (golf >= 2) return { tier: 'B', label: '골프 중심', reason: '토·일 쇼핑·온천 선택지 제한' };
  return { tier: 'C', label: '조건부', reason: '3월 날씨 또는 접근성 리스크' };
}

/**
 * 도착 커트오프(기본 12:00) 이전에 일본에 내릴 수 있는 공항을 판정한다.
 * @param {object} schedule loadBaseline() 또는 fetchIcnSchedules() 결과
 * @param {object} opts { cutoff: 'HH:MM', minGroundBuffer: number }
 */
export function analyze(schedule, airports, opts = {}, courseData = null) {
  const trip = opts.trip ?? {};
  const variant = opts.variant ?? {
    id: 'A', label: '목~일', departDow: 4, returnDow: 7, nights: 3, golfDows: [4, 5, 7], leisureDows: [6],
  };
  const departDow = variant.departDow;
  const returnDow = variant.returnDow;
  const nights = variant.nights ?? 3;
  const returnDowIsWeekend = returnDow >= 6;

  // 지역 범위 제한 (예: 규슈 + 히로시마)
  const allowRegions = new Set(trip.includeRegions ?? []);
  const allowIata = new Set(trip.includeIata ?? []);
  const inScope = (ap) => (allowRegions.size === 0 && allowIata.size === 0)
    || allowRegions.has(ap.region) || allowIata.has(ap.iata);
  const cutoff = opts.cutoff ?? '12:00';
  const cutoffMin = toMinutes(cutoff);
  if (cutoffMin == null) throw new Error(`cutoff 형식 오류: ${cutoff}`);

  // 2차 기준선: 더 이른 도착(기본 10:00). 오전 라운딩/조기 체크인 판단용
  const early = opts.early ?? '10:00';
  const earlyMin = toMinutes(early);
  if (earlyMin == null) throw new Error(`early 형식 오류: ${early}`);

  const airportByIata = new Map(airports.map((a) => [a.iata, a]));
  const results = [];

  for (const route of schedule.routes) {
    const ap = airportByIata.get(route.iata);
    if (!ap) continue;
    if (route.noScheduledService) continue; // 정기 국제선 미취항
    if (!inScope(ap)) continue;
    const block = ap.blockMinutes;

    // 커트오프를 맞추려면 늦어도 이 시각에는 인천에서 떠야 한다
    const latestDep = toHHMM(cutoffMin - block);
    const latestDepForEarly = toHHMM(earlyMin - block);

    const flights = (route.flights ?? []).map((f) => {
      // 우선순위: 공식 시간표의 도착시각 > 편별 운항시간 > 노선 표준 운항시간
      const arrTime = f.arrTime ?? addMinutes(f.depTime, f.block ?? block);
      return {
        ...f,
        arrTime,
        arrMinutes: toMinutes(arrTime),
        blockUsed: f.block ?? block,
        daysText: daysLabel(f.days),
        beforeCutoff: toMinutes(arrTime) <= cutoffMin,
        beforeEarly: toMinutes(arrTime) <= earlyMin,
      };
    });
    // 출발 요일(목) 운항편만 후보로 남긴다. 운항일 정보가 없으면(null) 보류하고 포함시킨다.
    const onDepartDow = flights.filter((f) => operatesOn(f.days, departDow) !== false);
    const dowFiltered = flights.length > 0 && onDepartDow.length !== flights.length;
    const qualifying = onDepartDow.filter((f) => f.beforeCutoff).sort((a, b) => a.arrMinutes - b.arrMinutes);

    let feasible;
    let basis;
    let earliestArrival = null;
    let slack = null;

    if (flights.length > 0) {
      feasible = qualifying.length > 0;
      basis = 'flights';
      earliestArrival = onDepartDow.sort((a, b) => a.arrMinutes - b.arrMinutes)[0]?.arrTime ?? null;
    } else {
      const winStart = route.morningDepWindow?.[0] ?? route.earliestDep;
      const earliestArrMin = winStart ? toMinutes(winStart) + block : null;
      feasible = earliestArrMin != null && earliestArrMin <= cutoffMin;
      basis = 'window';
      earliestArrival = earliestArrMin != null ? toHHMM(earliestArrMin) : null;
    }
    if (earliestArrival) slack = cutoffMin - toMinutes(earliestArrival);
    const departDowOk = route.departDays ? operatesOn(route.departDays, departDow) : null;

    const earlyFlights = qualifying.filter((f) => f.beforeEarly);
    const beforeEarly = earliestArrival != null && toMinutes(earliestArrival) <= earlyMin;

    const ret = evaluateReturn({ route, block, trip: { ...trip, nights }, returnDow });
    const golfClosed = ap.golfMarch.rating === 0;

    // 골프는 목·금 2일만. 도착일 라운딩 성립 여부가 횟수를 가른다.
    const golfDows = variant.golfDows ?? [4, 5, 7];
    const hasWeekendRound = golfDows.some((d) => d >= 6);
    const arrivalRound = golfClosed || !feasible
      ? { possible: false, quality: '불가', score: 0, teeOff: null }
      : evaluateArrivalRound(earliestArrival);
    // 목(도착일) + 금(종일) + 일(귀국일, 귀국편 조건 충족 시)
    const returnDayRound = Boolean(ret?.canRound) && !golfClosed;
    const midGolfDays = golfDows.filter((d) => d !== departDow && d !== returnDow).length;
    const golfRounds = golfClosed
      ? 0
      : (arrivalRound.possible ? 1 : 0) + midGolfDays + (returnDayRound ? 1 : 0);

    const courses = matchCourses(route.iata, courseData, {
      radiusKm: trip.courseRadiusKm ?? 50,
      hasWeekendRound,
      returnDowIsWeekend,
    });

    const golf = ap.golfMarch.rating;
    const onsen = ap.onsen.rating;
    const nearestOnsen = [...(ap.onsen.areas ?? [])].sort((a, b) => a.transitMin - b.transitMin)[0] ?? null;

    // 점수: 골프(목적) 가중 3, 온천 가중 2, 도착 여유 + 편수 유연성
    const shoppingRating = ap.shopping?.rating ?? 0;
    const score = feasible
      ? golf * 2 + onsen * 2 + shoppingRating * 2
        + arrivalRound.score * 2
        + Math.min(3, courses.counts.twosomeUsable)
        + Math.min(2, courses.counts.prestigeBookable)
        + (returnDayRound ? 4 : 0)
        + (returnDayRound && courses.counts.twosomeReturnDay > 0 ? 3 : 0)
        + Math.min(2, Math.floor((route.dailyFlights ?? 1) / 4))
        - (nearestOnsen && nearestOnsen.transitMin > 120 ? 1 : 0)
        + (ret ? ret.rating : 0)
      : 0;

    results.push({
      iata: route.iata,
      city: ap.city,
      airportName: ap.name,
      region: ap.region,
      blockMinutes: block,
      blockLabel: durationLabel(block),
      carriers: route.carriers ?? [],
      dailyFlights: route.dailyFlights ?? null,
      confidence: route.confidence ?? 'unknown',
      sourceNote: route.sourceNote ?? null,
      earliestDep: route.earliestDep ?? null,
      morningDepWindow: route.morningDepWindow ?? null,
      latestDepForCutoff: latestDep,
      latestDepForEarly,
      beforeEarly,
      earlyFlights,
      earlyCount: basis === 'flights' ? earlyFlights.length : null,
      earliestArrival,
      slackMinutes: slack,
      feasible,
      basis,
      flights,
      qualifyingFlights: qualifying,
      qualifyingCount: basis === 'flights' ? qualifying.length : null,
      golf: { ...ap.golfMarch, word: RATING_WORDS[golf] },
      onsen: { ...ap.onsen, word: RATING_WORDS[onsen], nearest: nearestOnsen },
      weatherMarch: ap.weatherMarch,
      accessNote: ap.accessNote,
      weeklyFrequency: route.weeklyFrequency ?? 'daily',
      dowCheckNeeded: (route.weeklyFrequency ?? 'daily') === 'limited' || basis === 'window',
      dowFiltered,
      departDowName: DOW_NAMES[departDow],
      returnDowName: DOW_NAMES[returnDow],
      returnLeg: ret,
      arrivalRound,
      returnDayRound,
      returnDayTwosome: courses.counts.twosomeReturnDay,
      hasWeekendRound,
      returnDowIsWeekend,
      golfRounds,
      plannedRounds: golfClosed ? 0 : golfDows.length,
      maxRounds: golfRounds,
      courses,
      shopping: ap.shopping ?? { rating: 0, areas: '—', note: '' },
      departDowOk,
      itineraryOk: ret?.operatesOnReturnDay !== false && departDowOk !== false,
      verdict: ret?.operatesOnReturnDay === false
        ? { tier: 'X', label: `${DOW_NAMES[returnDow]}요일 귀국편 없음`, reason: `귀국편이 ${daysLabel(route.returnDays)}만 운항 — ${DOW_NAMES[departDow]}→${DOW_NAMES[returnDow]} 일정 불가` }
        : departDowOk === false
          ? { tier: 'X', label: `${DOW_NAMES[departDow]}요일 출발편 없음`, reason: `출발편이 ${daysLabel(route.departDays)}만 운항` }
          : verdictFor({ feasible, golf, onsen, shopping: shoppingRating, rounds: golfRounds, twosome: courses.counts.twosomeUsable }),
      score,
    });
  }

  results.sort((a, b) => b.score - a.score || (a.earliestArrival ?? '').localeCompare(b.earliestArrival ?? ''));

  for (const r of results) {
    if (r.itineraryOk === false) r.feasible = false;
  }
  const feasibleList = results.filter((r) => r.feasible);
  return {
    generatedAt: new Date().toISOString(),
    cutoff,
    early,
    trip,
    variant,
    source: schedule.source,
    sourceLabel: schedule.label,
    fetchedAt: schedule.fetchedAt,
    sourceMeta: schedule.meta ?? null,
    stats: {
      totalRoutes: results.length,
      feasible: feasibleList.length,
      beforeEarly: feasibleList.filter((r) => r.beforeEarly).length,
      beforeEarlyGolf: feasibleList.filter((r) => r.beforeEarly && r.golf.rating >= 2).length,
      golfPlayable: feasibleList.filter((r) => r.golf.rating >= 2).length,
      tierA: feasibleList.filter((r) => r.verdict.tier === 'A').length,
      twoRounds: feasibleList.filter((r) => r.golfRounds >= 2).length,
      twosomeReady: feasibleList.filter((r) => r.courses.counts.twosomeUsable > 0).length,
      bookableCourses: feasibleList.reduce((n, r) => n + r.courses.counts.bookable, 0),
      prestigeReady: feasibleList.reduce((n, r) => n + r.courses.counts.prestigeReady, 0),
      sundayFull: feasibleList.filter((r) => r.returnDayRound).length,
      threeRounds: feasibleList.filter((r) => r.golfRounds >= 3).length,
      weekendTwosome: feasibleList.filter((r) => r.returnDayRound && r.courses.counts.twosomeReturnDay > 0).length,
      itineraryBlocked: results.filter((r) => r.itineraryOk === false).length,
      maxRoundsBest: feasibleList.reduce((m, r) => Math.max(m, r.maxRounds ?? 0), 0),
      earliestArrival: feasibleList.reduce((min, r) => (!min || r.earliestArrival < min ? r.earliestArrival : min), null),
    },
    airports: results,
  };
}
