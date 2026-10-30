// 골프장 좌표(OSM) + 예약사이트 코스 ID(楽天GORA / じゃらんゴルフ)를 빌드 시점에 수집한다.
//   사용: node scripts/enrich.mjs [--geo] [--booking] [--verify] [--force]
// 런타임 외부 요청은 없다. 결과는 data/geo.json, data/booking.json 에 캐시된다.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Node fetch 가 Overpass/일부 사이트에서 ETIMEDOUT 되므로 curl 로 받는다
async function get(url, { charset = 'utf-8', post = null, timeout = 60 } = {}) {
  const args = ['-sL', '-m', String(timeout), '-A', UA, '--compressed'];
  if (post) args.push('--data-urlencode', post);
  args.push(url);
  const { stdout } = await exec('curl', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  return new TextDecoder(charset).decode(stdout);
}

const PREF = {
  '福岡県': { gora: 'fukuoka', jalan: 'kyushu/fukuoka' },
  '大分県': { gora: 'oita', jalan: 'kyushu/oita' },
  '熊本県': { gora: 'kumamoto', jalan: 'kyushu/kumamoto' },
  '宮崎県': { gora: 'miyazaki', jalan: 'kyushu/miyazaki' },
  '鹿児島県': { gora: 'kagoshima', jalan: 'kyushu/kagoshima' },
  '長崎県': { gora: 'nagasaki', jalan: 'kyushu/nagasaki' },
  '佐賀県': { gora: 'saga', jalan: 'kyushu/saga' },
  '沖縄県': { gora: 'okinawa', jalan: 'okinawa/okinawa' },
  '愛媛県': { gora: 'ehime', jalan: 'shikoku/ehime' },
  '広島県': { gora: 'hiroshima', jalan: 'chugoku/hiroshima' },
  '大阪府': { gora: 'osaka', jalan: 'kinki/osaka' },
  '愛知県': { gora: 'aichi', jalan: 'chubu/aichi' },
  '静岡県': { gora: 'shizuoka', jalan: 'chubu/shizuoka' },
  '千葉県': { gora: 'chiba', jalan: 'kanto/chiba' },
  '神奈川県': { gora: 'kanagawa', jalan: 'kanto/kanagawa' },
};

// ── 이름 정규화 / 매칭 ──
const Z2H = (s) => s.replace(/[Ａ-Ｚａ-ｚ０-９]/g,
  (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const norm = (s) => Z2H(String(s))
  .replace(/[【】（）()\[\]\s　・,，。]/g, '')
  .replace(/(アコーディア|PGM|pgm)/g, '')
  .toLowerCase();
const core = (s) => {
  const n = norm(s);
  const cut = n.search(/(カントリー|カンツリー|ゴルフ|倶楽部|クラブ|コース|cc|gc)/);
  return cut > 1 ? n.slice(0, cut) : n;
};
/**
 * 보수적 매칭. 예약 링크가 다른 코스로 붙으면 치명적이므로
 * '앞에서부터 일치(anchored)'만 인정한다.
 *   東広島CC ⊅ 広島CC, 成田東CC ⊅ 成田GC  → 모두 거부
 *   総武CC北コース ⊃ 総武CC (같은 클럽의 세부 코스)  → 인정
 */
function bestMatch(targetJa, candidates) {
  const tn = norm(targetJa);
  let best = null;
  for (const c of candidates) {
    const cn = norm(c.name);
    let score = 0;
    if (cn === tn) score = 100;
    else if (cn.startsWith(tn) || tn.startsWith(cn)) score = 85 - Math.abs(cn.length - tn.length);
    if (score >= 60 && (!best || score > best.score)) best = { ...c, score };
  }
  return best;
}

// ── 楽天GORA: 都道府県 코스가이드(EUC-JP) → c_id ──
async function goraCourses(slug) {
  const html = await get(`https://gora.golf.rakuten.co.jp/doc/special/easylink/${slug}.html`, { charset: 'euc-jp' });
  const out = [];
  const re = /c_id\/(\d{4,7})\/?"[^>]*>\s*([^<]{2,60}?)\s*<\/a>/g;
  let m;
  while ((m = re.exec(html))) out.push({ id: m[1], name: m[2] });
  return [...new Map(out.map((x) => [x.id, x])).values()];
}

// ── じゃらんゴルフ: 지역 랭킹 페이지 → gc id (블록 단위로 끊어 오매칭 방지) ──
async function jalanCourses(path) {
  const html = await get(`https://golf-jalan.net/course/${path}/`);
  const blocks = html.split('data-golfcd="').slice(1);
  const out = [];
  for (const b of blocks) {
    const id = b.match(/^(gc\d{4,6})"/)?.[1];
    if (!id) continue;
    const head = b.slice(0, 1200);
    const name = head.match(/ranking-course_name[^>]*>\s*([^<]{2,60}?)\s*</)?.[1];
    if (name) out.push({ id, name });
  }
  return [...new Map(out.map((x) => [x.id, x])).values()];
}

// ── OSM Overpass: 공항 반경 50km 골프장 ──
async function overpassGolf({ lat, lon }, radiusM = 50000) {
  const q = `[out:json][timeout:90];(way["leisure"="golf_course"](around:${radiusM},${lat},${lon});relation["leisure"="golf_course"](around:${radiusM},${lat},${lon}););out center tags;`;
  const body = await get('https://overpass-api.de/api/interpreter', { post: `data=${q}`, timeout: 120 });
  const json = JSON.parse(body);
  return (json.elements ?? [])
    .filter((e) => e.tags?.name)
    .map((e) => ({ name: e.tags.name, lat: e.center?.lat ?? e.lat, lon: e.center?.lon ?? e.lon }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon));
}

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

async function main() {
  const argv = process.argv.slice(2);
  const want = (f) => argv.includes(f);
  // 작업 플래그가 하나도 없으면 전체 수집, 있으면 지정된 것만
  const explicit = ['--geo', '--booking', '--verify'].some(want);
  const doGeo = want('--geo') || !explicit;
  const doBooking = want('--booking') || !explicit;
  const force = want('--force');

  const courseData = JSON.parse(await readFile(new URL('../data/golf-courses.json', import.meta.url), 'utf8'));
  const courses = courseData.courses;
  const geoPath = new URL('../data/geo.json', import.meta.url);
  const bkPath = new URL('../data/booking.json', import.meta.url);

  let geo = { airports: {}, cities: {}, courses: {}, unmatched: [] };
  try { geo = { ...geo, ...JSON.parse(await readFile(geoPath, 'utf8')) }; } catch {}
  let bk = { gora: {}, jalan: {}, missing: [] };
  try { bk = { ...bk, ...JSON.parse(await readFile(bkPath, 'utf8')) }; } catch {}
  bk.missing = [];

  // ── 좌표 ──
  if (doGeo) {
    const iatas = [...new Set(courses.map((c) => c.iata))];
    for (const iata of iatas) {
      const ap = geo.airports[iata];
      if (!ap) { console.warn(`[geo] ${iata} 공항 좌표 없음 — 생략`); continue; }
      const mine = courses.filter((c) => c.iata === iata);
      if (!force && mine.every((c) => geo.courses[c.ja])) continue;
      process.stdout.write(`[geo] ${iata} Overpass... `);
      let osm;
      try { osm = await overpassGolf(ap); } catch (e) { console.log(`실패 ${e.message}`); continue; }
      console.log(`OSM ${osm.length}곳`);
      for (const c of mine) {
        if (!force && geo.courses[c.ja]) continue;
        const hit = bestMatch(c.ja, osm);
        if (hit) {
          const km = haversineKm(ap, hit);
          geo.courses[c.ja] = { lat: hit.lat, lon: hit.lon, osmName: hit.name, straightKm: km };
          console.log(`   ✓ ${c.ko} → ${hit.name} (직선 ${km}km / 추정 ${c.distanceKm}km)`);
        } else {
          geo.unmatched.push({ iata, ko: c.ko, ja: c.ja });
          console.log(`   ✗ ${c.ko} 좌표 미매칭`);
        }
      }
      await wait(1500);
    }
    geo.unmatched = [...new Map(geo.unmatched.map((u) => [u.ja, u])).values()];
    geo.meta = {
      updated: new Date().toISOString().slice(0, 10),
      sources: ['Nominatim (공항·시내)', 'Overpass API leisure=golf_course (골프장)'],
      counts: { airports: Object.keys(geo.airports).length, cities: Object.keys(geo.cities).length, courses: Object.keys(geo.courses).length, unmatched: geo.unmatched.length },
    };
    await writeFile(geoPath, JSON.stringify(geo, null, 2));
    console.log('geo.json →', JSON.stringify(geo.meta.counts));
  }

  // ── 예약사이트 ID ──
  if (doBooking) {
    const prefs = [...new Set(courses.map((c) => c.pref))].filter((p) => PREF[p]);
    for (const pref of prefs) {
      const mine = courses.filter((c) => c.pref === pref);
      const needG = mine.some((c) => force || !bk.gora[c.ja]);
      const needJ = mine.some((c) => force || !bk.jalan[c.ja]);
      let gList = [];
      let jList = [];
      if (needG) {
        try { gList = await goraCourses(PREF[pref].gora); console.log(`[GORA] ${pref} ${gList.length}곳`); }
        catch (e) { console.warn(`[GORA] ${pref} 실패 ${e.message}`); }
        await wait(800);
      }
      if (needJ) {
        try { jList = await jalanCourses(PREF[pref].jalan); console.log(`[자란] ${pref} ${jList.length}곳`); }
        catch (e) { console.warn(`[자란] ${pref} 실패 ${e.message}`); }
        await wait(800);
      }
      for (const c of mine) {
        if (needG && (force || !bk.gora[c.ja])) {
          const h = bestMatch(c.ja, gList);
          if (h) { bk.gora[c.ja] = { id: h.id, name: h.name, url: `https://booking.gora.golf.rakuten.co.jp/guide/disp/c_id/${h.id}/`, calendar: `https://search.gora.golf.rakuten.co.jp/cal/disp/c_id/${h.id}/` }; console.log(`   GORA ✓ ${c.ko} → ${h.name} (${h.id})`); }
          else console.log(`   GORA ✗ ${c.ko}`);
        }
        if (needJ && (force || !bk.jalan[c.ja])) {
          const h = bestMatch(c.ja, jList);
          if (h) { bk.jalan[c.ja] = { id: h.id, name: h.name, url: `https://golf-jalan.net/${h.id}/` }; console.log(`   자란 ✓ ${c.ko} → ${h.name} (${h.id})`); }
          else console.log(`   자란 ✗ ${c.ko}`);
        }
      }
    }
    bk.prefFallback = {};
    for (const [pref, v] of Object.entries(PREF)) {
      bk.prefFallback[pref] = {
        gora: `https://gora.golf.rakuten.co.jp/doc/special/easylink/${v.gora}.html`,
        jalan: `https://golf-jalan.net/course/${v.jalan}/`,
      };
    }
    for (const c of courses) {
      if (!bk.gora[c.ja] && !bk.jalan[c.ja]) bk.missing.push({ ko: c.ko, ja: c.ja, pref: c.pref });
    }
    bk.meta = {
      updated: new Date().toISOString().slice(0, 10),
      sources: ['楽天GORA 都道府県 코스가이드', 'じゃらんゴルフ 지역 랭킹'],
      note: '지역 랭킹 페이지는 상위권만 노출되므로 자란넷 미매칭은 미게재가 아니라 미노출일 수 있다. --verify 로 URL 유효성과 코스명 일치를 검사한다.',
      counts: { gora: Object.keys(bk.gora).length, jalan: Object.keys(bk.jalan).length, neither: bk.missing.length, total: courses.length },
    };
    await writeFile(bkPath, JSON.stringify(bk, null, 2));
    console.log('booking.json →', JSON.stringify(bk.meta.counts));
  }

  // ── 검증: URL 열어 코스명 일치 확인 ──
  if (want('--verify')) {
    console.log('');
    console.log('[검증] 저장된 URL 확인...');
    let ok = 0; let bad = 0;
    for (const [site, store] of [['GORA', bk.gora], ['자란', bk.jalan]]) {
      for (const [ja, rec] of Object.entries(store)) {
        const key = core(ja);
        let html = '';
        try { html = await get(rec.url, { charset: site === 'GORA' ? 'utf-8' : 'utf-8', timeout: 25 }); } catch {}
        const hit = norm(html).includes(key);
        rec.verified = hit;
        if (hit) ok += 1; else { bad += 1; console.log(`   ✗ ${site} ${ja} → ${rec.url}`); }
        await wait(400);
      }
    }
    await writeFile(bkPath, JSON.stringify(bk, null, 2));
    console.log(`검증 완료 — 일치 ${ok} / 불일치 ${bad}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
