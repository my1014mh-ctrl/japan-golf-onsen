// 공항 · 시내 기준점 · 골프장 좌표를 받아 data/geo.json 으로 캐시한다.
//   공항/시내: Nominatim (OpenStreetMap)
//   골프장   : Overpass (leisure=golf_course, 공항 반경 50km) → 이름 매칭
// 런타임에는 외부 요청이 없다. 좌표는 빌드 시점에 구워 넣는다.
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'japan-golf-onsen-planner/0.1 (https://github.com/my1014mh-ctrl/japan-golf-onsen)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const GEO_PATH = new URL('../data/geo.json', import.meta.url);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

async function nominatim(query) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=jp`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const json = await res.json();
  if (!json.length) return null;
  return { lat: Number(json[0].lat), lon: Number(json[0].lon), label: json[0].display_name };
}

async function overpassGolf({ lat, lon }, radiusM = 50000) {
  const q = `[out:json][timeout:90];(way["leisure"="golf_course"](around:${radiusM},${lat},${lon});relation["leisure"="golf_course"](around:${radiusM},${lat},${lon}););out center tags;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: q }),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const json = await res.json();
  return (json.elements ?? [])
    .filter((e) => e.tags?.name)
    .map((e) => ({
      name: e.tags.name,
      lat: e.center?.lat ?? e.lat,
      lon: e.center?.lon ?? e.lon,
      holes: e.tags.holes ? Number(e.tags.holes) : null,
    }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon));
}

const norm = (s) => String(s)
  .replace(/[【】（）()\s・,，]/g, '')
  .replace(/ゴルフ場$/, '')
  .toLowerCase();

// 고유명사 머리말 추출: 「久山カントリー倶楽部」→「久山」
const core = (s) => {
  const n = norm(s);
  const cut = n.search(/(カントリー|カンツリー|ゴルフ|倶楽部|クラブ|cc|gc|gkc)/);
  return cut > 1 ? n.slice(0, cut) : n;
};

function matchCourse(curatedJa, osmList) {
  const cn = norm(curatedJa);
  const cc = core(curatedJa);
  let best = null;
  for (const o of osmList) {
    const on = norm(o.name);
    let score = 0;
    if (on === cn) score = 100;
    else if (on.includes(cn) || cn.includes(on)) score = 85 - Math.abs(on.length - cn.length);
    else if (cc.length >= 2 && (on.includes(cc) || core(o.name) === cc)) score = 60 - Math.abs(on.length - cn.length);
    if (score > 0 && (!best || score > best.score)) best = { ...o, score };
  }
  return best && best.score >= 45 ? best : null;
}

async function main() {
  const force = process.argv.includes('--force');
  const airports = JSON.parse(await readFile(new URL('../data/airports.json', import.meta.url), 'utf8')).airports;
  const courseData = JSON.parse(await readFile(new URL('../data/golf-courses.json', import.meta.url), 'utf8'));

  let geo = { meta: {}, airports: {}, cities: {}, courses: {}, unmatched: [] };
  if (!force) {
    try { geo = JSON.parse(await readFile(GEO_PATH, 'utf8')); } catch { /* 첫 실행 */ }
  }
  geo.airports ??= {}; geo.cities ??= {}; geo.courses ??= {}; geo.unmatched = [];

  const needCourses = new Set(courseData.courses.map((c) => c.iata));

  for (const ap of airports) {
    if (!geo.airports[ap.iata]) {
      const hit = await nominatim(ap.jaName);
      if (hit) { geo.airports[ap.iata] = { lat: hit.lat, lon: hit.lon, label: hit.label }; console.log(`[공항] ${ap.iata} ${ap.jaName} → ${hit.lat.toFixed(4)},${hit.lon.toFixed(4)}`); }
      else console.warn(`[공항] ${ap.iata} ${ap.jaName} 실패`);
      await wait(1100);
    }
    if (!geo.cities[ap.iata]) {
      const hit = await nominatim(`${ap.cityCenterJa} ${ap.jaName.slice(0, 2)}`) ?? await nominatim(ap.cityCenterJa);
      if (hit) { geo.cities[ap.iata] = { lat: hit.lat, lon: hit.lon, name: ap.cityCenterJa, label: hit.label }; console.log(`[시내] ${ap.iata} ${ap.cityCenterJa} → ${hit.lat.toFixed(4)},${hit.lon.toFixed(4)}`); }
      else console.warn(`[시내] ${ap.iata} ${ap.cityCenterJa} 실패`);
      await wait(1100);
    }
  }

  for (const iata of needCourses) {
    const apGeo = geo.airports[iata];
    if (!apGeo) { console.warn(`[코스] ${iata} 공항 좌표 없음 — 생략`); continue; }
    const mine = courseData.courses.filter((c) => c.iata === iata);
    if (mine.every((c) => geo.courses[c.ja])) continue;

    console.log(`[코스] ${iata} Overpass 조회...`);
    let osm;
    try { osm = await overpassGolf(apGeo); } catch (e) { console.warn(`  실패: ${e.message}`); continue; }
    console.log(`  OSM 골프장 ${osm.length}곳`);

    for (const c of mine) {
      if (geo.courses[c.ja]) continue;
      const hit = matchCourse(c.ja, osm);
      if (hit) {
        const km = haversineKm(apGeo, hit);
        geo.courses[c.ja] = { lat: hit.lat, lon: hit.lon, osmName: hit.name, straightKm: km, score: hit.score };
        const gap = Math.abs(km - c.distanceKm);
        console.log(`  ✓ ${c.ja} → ${hit.name} (직선 ${km}km, 기존 추정 ${c.distanceKm}km${gap > 15 ? ` ⚠ 차이 ${gap.toFixed(0)}km` : ''})`);
      } else {
        geo.unmatched.push({ iata, ja: c.ja, ko: c.ko });
        console.log(`  ✗ ${c.ja} 매칭 실패`);
      }
    }
    await wait(1500);
  }

  geo.meta = {
    updated: new Date().toISOString().slice(0, 10),
    sources: ['Nominatim (OpenStreetMap)', 'Overpass API (leisure=golf_course)'],
    note: '좌표는 빌드 시점에 굽는다. 페이지 런타임에는 외부 요청이 없다. straightKm은 공항-코스 직선거리이며 driveMin(운전시간)과 다르다.',
    counts: {
      airports: Object.keys(geo.airports).length,
      cities: Object.keys(geo.cities).length,
      courses: Object.keys(geo.courses).length,
      unmatched: geo.unmatched.length,
    },
  };
  await writeFile(GEO_PATH, JSON.stringify(geo, null, 2));
  console.log('');
  console.log('geo.json 저장:', JSON.stringify(geo.meta.counts));
  if (geo.unmatched.length) console.log('미매칭:', geo.unmatched.map((u) => u.ko).join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
