// 운항시간(blockMinutes) 점검: 인천-목적지 대권거리 기반 모델과 저장값을 비교한다.
// 검증된 노선(공개 시간표 확인)으로 모델을 보정하고, 벗어난 추정값을 교정한다.
import { readFile, writeFile } from 'node:fs/promises';

const ICN = { lat: 37.4617, lon: 126.4406 }; // 인천공항 기준점(ARP)

// 공항 기준점 좌표 (ARP). 지오코딩 오류를 피하기 위해 고정값 사용.
const ARP = {
  FUK: [33.5859, 130.4510], KKJ: [33.8459, 131.0350], OIT: [33.4794, 131.7372],
  KMJ: [32.8373, 130.8550], NGS: [32.9169, 129.9137], HSG: [33.1497, 130.3022],
  KMI: [31.8772, 131.4487], KOJ: [31.8034, 130.7194], MYJ: [33.8272, 132.6997],
  TAK: [34.2142, 134.0156], TKS: [34.1328, 134.6064], HIJ: [34.4361, 132.9195],
  OKJ: [34.7569, 133.8553], YGJ: [35.4922, 133.2364], UBJ: [33.9300, 131.2786],
  KIX: [34.4347, 135.2328], UKB: [34.6328, 135.2239], NGO: [34.8584, 136.8054],
  KMQ: [36.3946, 136.4075], FSZ: [34.7961, 138.1894], TOY: [36.6483, 137.1875],
  KIJ: [37.9559, 139.1211], NRT: [35.7647, 140.3864], HND: [35.5494, 139.7798],
  SDJ: [38.1397, 140.9169], AOJ: [40.7347, 140.6908], CTS: [42.7752, 141.6923],
  HKD: [41.7700, 140.8219], AKJ: [43.6708, 142.4475], OKA: [26.1958, 127.6458],
  MMY: [24.7828, 125.2950], ISG: [24.3964, 124.2450],
};

const hv = (a, b) => {
  const R = 6371;
  const dLa = ((b.lat - a.lat) * Math.PI) / 180;
  const dLo = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLa / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function main() {
  const apply = process.argv.includes('--apply');
  const apPath = new URL('../data/airports.json', import.meta.url);
  const rtPath = new URL('../data/routes-baseline.json', import.meta.url);
  const ad = JSON.parse(await readFile(apPath, 'utf8'));
  const rd = JSON.parse(await readFile(rtPath, 'utf8'));
  const routeBy = new Map(rd.routes.map((r) => [r.iata, r]));

  // 1) 좌표 고정 + 거리 산출
  const rows = [];
  for (const a of ad.airports) {
    const c = ARP[a.iata];
    if (!c) { console.warn(`${a.iata} 좌표 미정의`); continue; }
    a.coord = { lat: c[0], lon: c[1] };
    const km = Math.round(hv(ICN, { lat: c[0], lon: c[1] }));
    a.greatCircleKm = km;
    rows.push({ iata: a.iata, city: a.city, km, stored: a.blockMinutes, route: routeBy.get(a.iata) });
  }

  // 2) 검증 노선으로 모델 보정: block = overhead + km / speed
  const truth = rows.filter((r) => r.route?.confidence === 'verified');
  let best = null;
  for (let overhead = 10; overhead <= 45; overhead += 1) {
    for (let speed = 500; speed <= 820; speed += 5) {
      const err = truth.reduce((s, r) => s + (overhead + (r.km / speed) * 60 - r.stored) ** 2, 0);
      if (!best || err < best.err) best = { overhead, speed, err };
    }
  }
  const model = (km) => Math.round((best.overhead + (km / best.speed) * 60) / 5) * 5;
  const rmse = Math.sqrt(best.err / truth.length).toFixed(1);
  console.log(`모델 보정: 지상·상승강하 ${best.overhead}분 + 거리/${best.speed}km/h   (검증 ${truth.length}개 노선, RMSE ${rmse}분)`);
  console.log('');
  console.log('검증 노선 대조:');
  for (const r of truth) console.log(`  ${r.iata} ${String(r.km).padStart(5)}km  실제 ${r.stored}분 / 모델 ${model(r.km)}분`);
  console.log('');
  console.log('추정 노선 점검 (|차이| 10분 이상만):');
  const fixes = [];
  for (const r of rows) {
    if (r.route?.confidence === 'verified') continue;
    const m = model(r.km);
    const diff = m - r.stored;
    if (Math.abs(diff) >= 10) {
      fixes.push({ ...r, model: m, diff });
      console.log(`  ${r.iata} ${r.city.padEnd(9)} ${String(r.km).padStart(5)}km  저장 ${String(r.stored).padStart(3)}분 → 모델 ${String(m).padStart(3)}분  (${diff > 0 ? '+' : ''}${diff})`);
    }
  }
  if (!fixes.length) console.log('  없음');

  if (apply) {
    for (const a of ad.airports) {
      const r = rows.find((x) => x.iata === a.iata);
      if (!r) continue;
      a.blockSource = r.route?.confidence === 'verified' ? 'verified' : 'model';
      if (a.blockSource === 'model') a.blockMinutes = model(r.km);
    }
    ad.meta.blockNote = `blockMinutes 출처: verified=공개 시간표 확인, model=인천 대권거리 기반 추정 (지상·상승강하 ${best.overhead}분 + 거리/${best.speed}km/h, 검증 ${truth.length}개 노선으로 보정, RMSE ${rmse}분). 5분 단위로 반올림.`;
    ad.meta.updated = new Date().toISOString().slice(0, 10);
    await writeFile(apPath, JSON.stringify(ad, null, 2));
    console.log('');
    console.log(`적용 완료 — ${fixes.length}개 노선 운항시간 교정, 좌표 ${rows.length}곳 고정`);
  } else {
    console.log('');
    console.log('(--apply 로 반영)');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
