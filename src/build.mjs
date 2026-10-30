import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadAirports, loadTrip, loadCourses, analyze } from './analyze.mjs';
import { loadBaseline } from './sources/baseline.mjs';
import { fetchIcnSchedules, fetchIcnArrivals } from './sources/icnOpenApi.mjs';
import { renderHtml } from './render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

// .env 간단 로더 (의존성 없이)
async function loadEnv() {
  try {
    const raw = await readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env 없으면 무시 */ }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadEnv();

  const airports = await loadAirports();
  const trip = await loadTrip();
  const courseData = await loadCourses();
  const DOW = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 7: '일' };
  for (const v of trip.variants ?? []) {
    v.departDowName = DOW[v.departDow];
    v.returnDowName = DOW[v.returnDow];
  }

  const cutoff = args.cutoff ?? process.env.ARRIVAL_CUTOFF ?? trip.arrivalCutoff ?? '12:00';
  const early = args.early ?? process.env.EARLY_CUTOFF ?? trip.earlyArrival ?? '10:00';
  const want = args.source ?? 'auto';
  const key = process.env.DATA_GO_KR_KEY?.trim();

  let schedule;
  const warnings = [];
  if (want === 'api' || (want === 'auto' && key)) {
    try {
      schedule = await fetchIcnSchedules({ key, japanAirports: airports.map((a) => a.iata) });
      console.log(`[source] 공식 API 사용 — ${schedule.routes.length}개 노선 수신`);

      // 귀국편(일본 → 인천) 병합: 일요일 운항 + 일본 현지 출발 시각 확정
      try {
        const blockByIata = new Map(airports.map((a) => [a.iata, a.blockMinutes]));
        const { returns } = await fetchIcnArrivals({ key, blockByIata, returnDow: trip.returnDow });
        let merged = 0;
        for (const route of schedule.routes) {
          const r = returns[route.iata];
          if (!r) continue;
          route.lastReturnDep = r.lastReturnDep;
          route.returnPattern = r.returnPattern;
          route.returnFlights = r.onReturnDow;
          merged += 1;
        }
        console.log(`[source] 귀국편 병합 — ${merged}개 노선 (${trip.returnDowName}요일 운항 기준)`);
      } catch (err) {
        warnings.push(`귀국편 API 실패 → 베이스라인 역산 사용: ${err.message}`);
        console.warn(`[warn] ${warnings.at(-1)}`);
      }
    } catch (err) {
      warnings.push(`API 실패 → 베이스라인 사용: ${err.message}`);
      console.warn(`[warn] ${warnings.at(-1)}`);
      if (want === 'api' && args.strict) process.exitCode = 1;
    }
  }
  if (!schedule) {
    schedule = await loadBaseline();
    console.log(`[source] 베이스라인 사용 — ${schedule.routes.length}개 노선`);
  }

  // 일정 variant별로 각각 분석
  const variants = (trip.variants ?? [null]).map((variant) =>
    analyze(schedule, airports, { cutoff, early, trip, variant }, courseData));
  const analysis = {
    ...variants[0],
    variants,
    multiVariant: variants.length > 1,
  };
  analysis.warnings = warnings;

  const htmlPath = path.resolve(ROOT, args.out ?? 'docs/index.html');
  const jsonPath = path.resolve(ROOT, 'out/analysis.json');
  await mkdir(path.dirname(htmlPath), { recursive: true });
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(analysis, null, 2));
  await writeFile(htmlPath, renderHtml(analysis, { tripLabel: args.trip ?? '2027년 3월' }));

  console.log('');
  console.log(`범위: ${(trip.includeRegions ?? []).join('·') || '전체'}${(trip.includeIata ?? []).length ? ' + ' + trip.includeIata.join('·') : ''}`);
  for (const v of variants) {
    const st = v.stats;
    console.log('');
    console.log(`━━ ${v.variant.label} — ${v.variant.summary}`);
    console.log(`   후보 창: ${(v.variant.windows ?? []).map((w) => `${w.depart.slice(5)}→${w.return.slice(5)}`).join(', ')}`);
    console.log(`   ${cutoff} 이전 도착 ${st.feasible}/${st.totalRoutes} · 3라운딩 ${st.threeRounds} · 귀국일 2인가능 ${st.weekendTwosome}`);
    for (const a of v.airports.filter((x) => x.feasible).sort((x, y) => y.score - x.score)) {
      const t = a.courses.inRadius.filter((c) => c.twosomeReturnDay === true).map((c) => c.ko);
      console.log(`   ${a.iata} ${a.city.padEnd(7)} ${a.golfRounds}/3회 도착 ${a.earliestArrival} 귀국 ${a.returnLeg?.depJST ?? '—'} 귀국일2인 ${t.length ? t.join(',') : '없음'}  ${a.verdict.label}`);
    }
    const blocked = v.airports.filter((x) => !x.feasible);
    if (blocked.length) console.log(`   [불가] ${blocked.map((x) => `${x.iata} ${x.verdict.label}`).join(' / ')}`);
  }
  const { stats } = analysis;
  console.log('');
  console.log(`도착 커트오프 ${cutoff} 기준 (조기 기준선 ${early})`);
  console.log(`  검토 노선 ${stats.totalRoutes} · 최우선 후보 ${stats.tierA} · 가장 빠른 도착 ${stats.earliestArrival ?? '—'}`);
  console.log('');
  console.log(`[${early} 이전 도착 가능]`);
  for (const a of analysis.airports.filter((x) => x.beforeEarly)) {
    console.log(`  ${a.iata} ${a.city.padEnd(8)} 도착 ${a.earliestArrival}  (인천 ${a.latestDepForEarly} 이전 출발)  골프 ${a.golf.word}/온천 ${a.onsen.word}`);
  }
  console.log('');
  console.log('[최우선 후보]');
  for (const a of analysis.airports.filter((x) => x.verdict.tier === 'A')) {
    const r = a.returnLeg;
    console.log(`  ${a.beforeEarly ? '★' : ' '} ${a.iata} ${a.city.padEnd(8)} 도착 ${a.earliestArrival} → 목 티업 ${a.arrivalRound.teeOff ?? '—'}(${a.arrivalRound.quality})  라운딩 ${a.golfRounds}회  2사무 ${a.courses.counts.twosomeUsable}곳  일 여유 ${r ? r.leisureHours + 'h' : '—'}  온천 ${a.onsen.word}/쇼핑 ${['없음','제한','양호','최상'][a.shopping.rating]}`);
  }
  console.log('');
  console.log('[2인 플레이 가능 코스 — 공항 50km 내]');
  for (const a of [...analysis.airports].filter((x) => x.feasible && x.courses.counts.twosomeUsable > 0).sort((x, y) => y.score - x.score)) {
    console.log(`  ${a.iata} ${a.city}`);
    for (const c of a.courses.inRadius.filter((c) => c.twosomeUsable)) {
      console.log(`     ${c.ko.padEnd(18)} ${String(c.distanceKm).padStart(2)}km/${String(c.driveMin).padStart(3)}분  [${c.twosome}] ${c.pedigree}`);
    }
  }
  console.log('');
  console.log('[코스 2사무 미확인 — 예약사이트 확인 필요]');
  for (const a of [...analysis.airports].filter((x) => x.feasible && x.courses.counts.inRadius > 0 && x.courses.counts.twosomeUsable === 0).sort((x, y) => y.score - x.score).slice(0, 8)) {
    console.log(`  ${a.iata} ${a.city.padEnd(8)} 코스 ${a.courses.counts.inRadius}개 전부 미확인 → ${a.courses.verifyUrl ?? '—'}`);
  }
  console.log('');
  console.log(`HTML → ${htmlPath}`);
  console.log(`JSON → ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
