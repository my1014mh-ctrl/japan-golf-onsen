const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CONFIDENCE_LABEL = {
  official: '공식 스케줄',
  high: '추정(신뢰 높음)',
  medium: '추정(변동 가능)',
  low: '추정(확인 필요)',
  unknown: '미상',
};

function ratingBar(rating, label) {
  const dots = [0, 1, 2].map((i) => `<span class="dot${i < rating ? ' on' : ''}"></span>`).join('');
  return `<span class="rating" title="${esc(label)}">${dots}</span>`;
}

function flightRows(flights) {
  if (!flights.length) return '';
  return `<table class="flights"><thead><tr><th>항공사</th><th>편명</th><th>출발</th><th>도착</th><th>운항일</th></tr></thead><tbody>
${flights.map((f) => `<tr data-arr="${f.arrMinutes}"${f.beforeEarly ? ' class="early"' : ''}><td>${esc(f.airline)}</td><td>${esc(f.flightNo ?? '-')}</td><td>${esc(f.depTime)}</td><td class="arr">${esc(f.arrTime)}${f.beforeEarly ? '<span class="mark">10시 전</span>' : ''}</td><td>${esc(f.daysText)}</td></tr>`).join('\n')}
</tbody></table>`;
}

const TWOSOME = {
  'all-days': { label: '전일 2인', cls: 'ok2' },
  weekday: { label: '평일 2인', cls: 'ok' },
  available: { label: '2인 플랜 있음', cls: 'maybe' },
  unknown: { label: '확인 필요', cls: 'unk' },
};

function courseTable(a) {
  const c = a.courses;
  if (!c || c.counts.inRadius === 0) {
    return `<p class="note">반경 ${c?.radiusKm ?? 50}km 내 정리된 코스 데이터 없음${c?.verifyUrl ? ` — <a href="${esc(c.verifyUrl)}" target="_blank" rel="noopener">GDO 2사무 코스 검색</a>` : ''}</p>`;
  }
  const rows = c.inRadius.map((x) => {
    const t = TWOSOME[x.twosome] ?? TWOSOME.unknown;
    return `<tr class="${x.twosomeUsable ? 'usable' : ''}">
      <td><strong>${esc(x.ko)}</strong><span class="ja">${esc(x.ja)}</span>${x.pedigree ? `<span class="ped">${esc(x.pedigree)}</span>` : ''}</td>
      <td class="num">${x.distanceKm}km<span class="muted"> / ${x.driveMin}분</span></td>
      <td class="num">${x.holes}H</td>
      <td><span class="tsome ${t.cls}">${esc(t.label)}</span>${x.noSurcharge ? '<span class="nosur">할증 없음</span>' : ''}${x.greenFee ? `<span class="fee">${esc(x.greenFee)}</span>` : ''}</td>
    </tr>`;
  }).join('\n');

  const out = c.outOfRadius.length
    ? `<p class="note">반경 외: ${c.outOfRadius.map((x) => `${esc(x.ko)} (${x.distanceKm}km)`).join(', ')}</p>`
    : '';

  return `<div class="coursebox">
    <div class="chead">
      <span class="k">공항 ${c.radiusKm}km 내 골프장 ${c.counts.inRadius}곳 · 2인 플레이 가능 <strong>${c.counts.twosomeUsable}곳</strong></span>
      ${c.verifyUrl ? `<a class="verify" href="${esc(c.verifyUrl)}" target="_blank" rel="noopener">GDO 2사무 검색 ↗</a>` : ''}
    </div>
    <table class="courses"><tbody>${rows}</tbody></table>
    ${c.counts.twosomeUnknown ? `<p class="note warn">${c.counts.twosomeUnknown}곳은 2인 플레이 여부 미확인 — 예약사이트에서 확인하세요.</p>` : ''}
    ${out}
  </div>`;
}

function card(a, early) {
  const win = a.morningDepWindow ? `${a.morningDepWindow[0]}~${a.morningDepWindow[1]}` : null;
  const onsenAreas = (a.onsen.areas ?? []).slice(0, 3)
    .map((o) => `<li>${esc(o.name)} <span class="muted">${o.transitMin === 0 ? '공항 내' : `${o.transitMin}분`}</span></li>`).join('');
  const courses = (a.golf.courses ?? []).slice(0, 4).map((c) => `<span class="chip">${esc(c)}</span>`).join('');

  return `<article class="card tier-${a.verdict.tier}" data-region="${esc(a.region)}" data-golf="${a.golf.rating}" data-onsen="${a.onsen.rating}" data-arrmin="${a.slackMinutes == null ? '' : 720 - a.slackMinutes}" data-earliest="${esc(a.earliestArrival ?? '')}" data-score="${a.score}" data-iata="${esc(a.iata)}" data-early="${a.beforeEarly ? 1 : 0}" data-earlycount="${a.earlyCount ?? ''}" data-rounds="${a.golfRounds}" data-sunday="${(a.returnLeg?.rating ?? 0) >= 2 ? 1 : 0}" data-twosome="${a.courses.counts.twosomeUsable}" data-shopping="${a.shopping.rating}">
  <header>
    <div class="titleline">
      <h3>${esc(a.city)} <span class="iata">${esc(a.iata)}</span></h3>
      <span class="badges">${a.beforeEarly ? `<span class="badge early">${esc(early)} 전 도착</span>` : ''}<span class="badge t${a.verdict.tier}">${esc(a.verdict.label)}</span></span>
    </div>
    <p class="sub">${esc(a.region)} · ${esc(a.airportName)} · 비행 ${esc(a.blockLabel)}</p>
  </header>

  <div class="arrivalbox">
    <div><span class="k">가장 빠른 도착</span><strong class="big">${esc(a.earliestArrival ?? '—')}</strong></div>
    <div><span class="k">출발 마감</span><strong>${esc(a.latestDepForCutoff)}</strong><span class="muted"> 이전</span></div>
    <div class="earlyslot${a.beforeEarly ? ' hit' : ''}"><span class="k">${esc(early)} 도착 조건</span><strong>${esc(a.latestDepForEarly)}</strong><span class="muted"> 이전 출발</span></div>
  </div>

  <div class="dayplan">
    <div class="day golfday">
      <span class="dn">목</span>
      <span class="dv">${esc(a.earliestArrival ?? '—')} 도착</span>
      <span class="dd ${a.arrivalRound.possible ? 'on' : 'off'}">${a.arrivalRound.teeOff ? `티업 ${esc(a.arrivalRound.teeOff)} · ${esc(a.arrivalRound.quality)}` : '라운딩 불가'}</span>
    </div>
    <div class="day golfday">
      <span class="dn">금</span>
      <span class="dv">종일 골프</span>
      <span class="dd on">2인 플레이 ${a.courses.counts.twosomeUsable}곳</span>
    </div>
    <div class="day">
      <span class="dn">토</span>
      <span class="dv">쇼핑 · 온천</span>
      <span class="dd">${esc(a.shopping.areas.split('·')[0])}</span>
    </div>
    <div class="day">
      <span class="dn">일</span>
      <span class="dv">${a.returnLeg ? `${esc(a.returnLeg.depJST)} 귀국` : '—'}</span>
      <span class="dd ${(a.returnLeg?.rating ?? 0) >= 2 ? 'on' : 'off'}">${a.returnLeg ? `여유 ${a.returnLeg.leisureHours}h · ${esc(a.returnLeg.label)}` : '미상'}</span>
    </div>
  </div>
  <div class="roundsline"><span class="k">목·금 라운딩</span><strong class="r${a.golfRounds}">${a.golfRounds}회</strong>${a.arrivalRound.note ? `<span class="muted">${esc(a.arrivalRound.note)}</span>` : ''}</div>
  ${a.returnLeg ? `<p class="note ret">일요일 현지 활동은 <strong>${esc(a.returnLeg.lastActivity)}</strong>까지 (귀국편 ${esc(a.returnLeg.depJST)}${a.returnLeg.derived ? ' 역산' : ''} − 수속 2시간 − 공항이동 1시간). ${a.returnLeg.pattern === 'single-rotation' ? '1일 1왕복 노선이라 귀국편이 낮에 출발합니다.' : '저녁 귀국편이 있어 일요일을 온전히 씁니다.'}</p>` : ''}
  ${a.dowCheckNeeded ? `<p class="note warn">⚠ ${a.weeklyFrequency === 'limited' ? '주 3~5회 운항 노선 — ' : ''}${esc(a.departDowName)}요일 출발·${esc(a.returnDowName)}요일 귀국 운항 여부를 개별 확인해야 합니다.</p>` : ''}

  <dl class="specs">
    <div><dt>3월 골프</dt><dd>${ratingBar(a.golf.rating, a.golf.word)} <span class="word">${esc(a.golf.word)}</span></dd></div>
    <div><dt>온천</dt><dd>${ratingBar(a.onsen.rating, a.onsen.word)} <span class="word">${esc(a.onsen.word)}</span>${a.onsen.nearest ? `<span class="muted"> · 최근접 ${esc(a.onsen.nearest.name)} ${a.onsen.nearest.transitMin}분</span>` : ''}</dd></div>
    <div><dt>쇼핑</dt><dd>${ratingBar(a.shopping.rating, '쇼핑')} <span class="word">${esc(a.shopping.areas)}</span></dd></div>
    <div><dt>3월 기온</dt><dd>${a.weatherMarch.highC}° / ${a.weatherMarch.lowC}°</dd></div>
    <div><dt>${esc(early)} 전</dt><dd>${a.beforeEarly ? `<span class="yes">가능</span>${a.earlyCount != null ? `<span class="muted"> · 해당 ${a.earlyCount}편</span>` : ''}` : `<span class="no">불가</span><span class="muted"> · 가장 빠른 도착 ${esc(a.earliestArrival ?? '—')}</span>`}</dd></div>
    <div><dt>운항</dt><dd>${a.dailyFlights ? `1일 ${a.dailyFlights}편` : '편수 미상'}${win ? ` · 오전 출발 ${esc(win)}` : ''} <span class="conf c-${esc(a.confidence)}">${esc(CONFIDENCE_LABEL[a.confidence] ?? a.confidence)}</span></dd></div>
  </dl>

  ${courses ? `<div class="chips"><span class="k">코스</span>${courses}</div>` : ''}
  ${onsenAreas ? `<div class="onsenlist"><span class="k">온천지</span><ul>${onsenAreas}</ul></div>` : ''}
  <p class="note">${esc(a.golf.note)}</p>
  <p class="note">${esc(a.accessNote)}</p>
  ${a.sourceNote ? `<p class="note src">※ ${esc(a.sourceNote)}</p>` : ''}
  ${courseTable(a)}
  ${flightRows(a.qualifyingFlights ?? [])}
</article>`;
}

function courseModal(analysis) {
  const groups = analysis.airports
    .filter((a) => a.courses?.counts.inRadius > 0)
    .map((a) => {
      const rows = a.courses.inRadius.map((c) => {
        const t = TWOSOME[c.twosome] ?? TWOSOME.unknown;
        const remarks = [c.pedigree, c.greenFee, c.noSurcharge ? '2사무 할증 없음' : null]
          .filter(Boolean).join(' · ');
        return `<tr class="${c.twosomeUsable ? 'usable' : 'nope'}" data-usable="${c.twosomeUsable ? 1 : 0}">
          <td class="cname"><strong>${esc(c.ko)}</strong><span class="ja">${esc(c.ja)}</span></td>
          <td class="cdist">${c.distanceKm}km<span class="muted"> / ${c.driveMin}분</span></td>
          <td class="cts"><span class="tsome ${t.cls}">${esc(t.label)}</span>${c.noSurcharge ? '<span class="nosur">할증 없음</span>' : ''}</td>
          <td class="crem">${esc(remarks || '—')}</td>
        </tr>`;
      }).join('\n');

      return `<tbody class="apgroup" data-usable="${a.courses.counts.twosomeUsable > 0 ? 1 : 0}">
        <tr class="aphead">
          <th colspan="4">
            <span class="apcode">${esc(a.iata)}</span>
            <span class="apcity">${esc(a.city)}</span>
            <span class="apmeta">도착 ${esc(a.earliestArrival ?? '—')} · 목 티업 ${esc(a.arrivalRound.teeOff ?? '—')} · 온천 ${esc(a.onsen.nearest ? `${a.onsen.nearest.name} ${a.onsen.nearest.transitMin}분` : '—')}</span>
            <span class="apcount${a.courses.counts.twosomeUsable ? ' on' : ''}">2인 ${a.courses.counts.twosomeUsable}/${a.courses.counts.inRadius}곳</span>
          </th>
        </tr>
        ${rows}
      </tbody>`;
    }).join('\n');

  const usableTotal = analysis.airports.reduce((n, a) => n + (a.courses?.counts.twosomeUsable ?? 0), 0);
  const inTotal = analysis.airports.reduce((n, a) => n + (a.courses?.counts.inRadius ?? 0), 0);

  return `<dialog id="coursemodal" aria-labelledby="cmtitle">
  <div class="mhead">
    <div>
      <h2 id="cmtitle">2인 플레이 가능 골프장</h2>
      <p>공항 반경 ${analysis.trip.courseRadiusKm ?? 50}km 이내 · 전체 ${inTotal}곳 중 <strong>${usableTotal}곳</strong>에서 2인 플레이 확인</p>
    </div>
    <div class="mactions">
      <label class="toggle"><input type="checkbox" id="mfilter" checked>2인 가능만</label>
      <button type="button" class="mclose" aria-label="닫기">닫기</button>
    </div>
  </div>
  <div class="mbody">
    <table class="mtable">
      <thead><tr><th>골프장</th><th>거리</th><th>2인 플레이</th><th>비고</th></tr></thead>
      ${groups}
    </table>
    <p class="mnote">목·금 플레이 기준이라 <strong>평일 2사무 보증</strong> 플랜이 모두 유효합니다. 2사무 할증은 1인당 500~2,200엔 수준이고 할증 없는 플랜은 평일 한정이 많습니다. 플랜은 날짜 단위로 바뀌니 예약 시점에 각 공항 카드의 GDO 링크로 확인하세요.</p>
  </div>
</dialog>`;
}

export function renderHtml(analysis, opts = {}) {
  const tripLabel = opts.tripLabel ?? '2027년 3월';
  const feasible = analysis.airports.filter((a) => a.feasible);
  const infeasible = analysis.airports.filter((a) => !a.feasible);
  const regions = [...new Set(analysis.airports.map((a) => a.region))];
  const fmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>일본 골프·온천 플래너</title>
<!-- 외부 요청 없음: 네트워크 지연이 첫 페인트를 막지 않도록 시스템 서체만 사용 -->
<style>
:root{
  --bg:#f6f5f2; --panel:#ffffff; --ink:#15171c; --ink2:#5b6270; --line:#e2e0da;
  --accent:#1f6f4a; --accent2:#9a6b2f; --a:#1f6f4a; --b:#2c6ea3; --c:#8a7331; --x:#8d8d93;
  --shadow:0 1px 2px rgba(20,22,28,.05),0 8px 24px rgba(20,22,28,.05);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#12141a; --panel:#1a1d25; --ink:#eef0f4; --ink2:#9aa3b2; --line:#2a2f3a;
  --accent:#5fd39b; --accent2:#d9a85f; --a:#5fd39b; --b:#6fb6e8; --c:#d9c06a; --x:#777d89;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);
}}
:root[data-theme="dark"]{
  --bg:#12141a; --panel:#1a1d25; --ink:#eef0f4; --ink2:#9aa3b2; --line:#2a2f3a;
  --accent:#5fd39b; --accent2:#d9a85f; --a:#5fd39b; --b:#6fb6e8; --c:#d9c06a; --x:#777d89;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);
}
*{box-sizing:border-box}
:root{
  --sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",Segoe UI,Roboto,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
.cut,.arrivalbox strong,.day .dv,.roundsline strong,.stat b,.wdates,.tripstrip strong,
table.courses td.num,.flights td,.fee{font-family:var(--mono);font-variant-numeric:tabular-nums}
.stat span,.specs dt,.day .dn,.chead .k,.chips .k,.onsenlist .k,.arrivalbox .k,.roundsline .k,.metaline,.conf,.tsome,.nosur{letter-spacing:.01em}
.day .dn,.specs dt,.arrivalbox .k,.day .dn{font-family:var(--mono)}
a{color:var(--b)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
.wrap{max-width:1180px;margin:0 auto;padding:32px 20px 72px}
header.top h1{margin:0 0 6px;font-size:clamp(22px,3.4vw,32px);letter-spacing:-.02em}
header.top .lede{margin:0;color:var(--ink2);font-size:15px}
.metaline{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px;color:var(--ink2)}
.metaline span{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:24px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;box-shadow:var(--shadow)}
.stat b{display:block;font-size:26px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat span{font-size:12.5px;color:var(--ink2)}
.controls{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow);display:grid;gap:14px;margin-bottom:26px}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.row > label.k{font-size:12.5px;color:var(--ink2);min-width:88px}
input[type=range]{accent-color:var(--accent);width:min(260px,60vw)}
.cut{font-variant-numeric:tabular-nums;font-weight:650;color:var(--accent)}
.toggle{display:inline-flex;align-items:center;gap:6px;font-size:13px;border:1px solid var(--line);border-radius:999px;padding:5px 11px;cursor:pointer;user-select:none;background:transparent}
.toggle input{margin:0;accent-color:var(--accent)}
select{font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
h2.sec{font-size:15px;letter-spacing:.02em;text-transform:none;color:var(--ink2);margin:30px 0 12px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--x);border-radius:14px;padding:16px;box-shadow:var(--shadow)}
.card.tier-A{border-left-color:var(--a)} .card.tier-B{border-left-color:var(--b)} .card.tier-C{border-left-color:var(--c)}
.titleline{display:flex;align-items:center;justify-content:space-between;gap:10px}
.card h3{margin:0;font-size:18px;letter-spacing:-.01em}
.iata{font-size:12px;color:var(--ink2);font-weight:500;font-variant-numeric:tabular-nums}
.badge{font-size:11.5px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.badge.tA{color:var(--a);border-color:color-mix(in srgb,var(--a) 40%,transparent)}
.badge.tB{color:var(--b);border-color:color-mix(in srgb,var(--b) 40%,transparent)}
.badge.tC{color:var(--c);border-color:color-mix(in srgb,var(--c) 40%,transparent)}
.badge.tX{color:var(--x)}
.sub{margin:4px 0 0;font-size:12.5px;color:var(--ink2)}
.arrivalbox{display:flex;gap:18px;align-items:flex-end;margin:14px 0;padding:12px;border-radius:10px;background:color-mix(in srgb,var(--accent) 7%,transparent)}
.arrivalbox .k{display:block;font-size:11.5px;color:var(--ink2)}
.arrivalbox strong{font-variant-numeric:tabular-nums;font-size:16px}
.arrivalbox .big{font-size:28px;letter-spacing:-.03em;line-height:1.1;color:var(--accent)}
.specs{margin:0;display:grid;gap:7px}
.specs > div{display:flex;gap:10px;font-size:13px}
.specs dt{min-width:64px;color:var(--ink2);font-size:12.5px;margin:0}
.specs dd{margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rating{display:inline-flex;gap:3px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--line)}
.dot.on{background:var(--accent)}
.word{font-size:12.5px}
.muted{color:var(--ink2);font-size:12px}
.conf{font-size:11px;color:var(--ink2);border:1px dashed var(--line);border-radius:6px;padding:1px 6px}
.conf.c-official{color:var(--accent);border-style:solid}
.chips,.onsenlist{margin-top:12px;font-size:12.5px}
.chips .k,.onsenlist .k{display:block;font-size:11.5px;color:var(--ink2);margin-bottom:5px}
.chip{display:inline-block;border:1px solid var(--line);border-radius:7px;padding:2px 8px;margin:0 5px 5px 0;font-size:12px}
.onsenlist ul{margin:0;padding-left:16px}
.note{margin:10px 0 0;font-size:12.5px;color:var(--ink2)}
.note.src{color:var(--accent2)}
.flights{width:100%;border-collapse:collapse;margin-top:14px;font-size:12.5px;display:block;overflow-x:auto}
.flights th{text-align:left;font-weight:600;color:var(--ink2);font-size:11.5px;border-bottom:1px solid var(--line);padding:5px 8px 5px 0}
.flights td{padding:5px 8px 5px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 50%,transparent);font-variant-numeric:tabular-nums}
.flights td.arr{color:var(--accent);font-weight:600}
.card.off{display:none}
.badges{display:inline-flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.badge.early{color:var(--bg);background:var(--accent);border-color:var(--accent);font-weight:650}
.arrivalbox .earlyslot{opacity:.55}
.arrivalbox .earlyslot.hit{opacity:1}
.arrivalbox .earlyslot.hit strong{color:var(--accent)}
.specs .yes{color:var(--accent);font-weight:600;font-size:12.5px}
.specs .no{color:var(--ink2);font-size:12.5px}
.stat.accent{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));background:color-mix(in srgb,var(--accent) 7%,var(--panel))}
.stat.accent b{color:var(--accent)}
.flights tr.early td{background:color-mix(in srgb,var(--accent) 8%,transparent)}
.windows{margin:26px 0 8px}
.wgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.win{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:12px;padding:13px 14px;box-shadow:var(--shadow)}
.win.caution{border-left-color:var(--accent2)}
.wdates{font-size:17px;font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.wdates .arrow{color:var(--ink2);font-weight:400;margin:0 2px}
.wtags{margin:6px 0 8px}
.win ul{margin:0;padding-left:16px;font-size:12.5px;color:var(--ink2)}
.win li{margin-bottom:3px}
.dayplan{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:13px 0}
.day{border:1px solid var(--line);border-radius:9px;padding:8px 9px;display:flex;flex-direction:column;gap:2px;min-width:0}
.day.golfday{background:color-mix(in srgb,var(--accent) 7%,transparent);border-color:color-mix(in srgb,var(--accent) 30%,var(--line))}
.day .dn{font-size:11px;font-weight:700;color:var(--ink2)}
.day .dv{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.day .dd{font-size:10.5px;color:var(--ink2);line-height:1.35}
.day .dd.on{color:var(--accent)}
.day .dd.off{color:var(--accent2)}
.roundsline{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:12.5px}
.roundsline .k{font-size:11.5px;color:var(--ink2)}
.roundsline strong{font-size:17px;color:var(--accent)}
.roundsline strong.r1{color:var(--accent2)}
.roundsline strong.r0{color:var(--x)}
.coursebox{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.chead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:7px}
.chead .k{font-size:11.5px;color:var(--ink2)}
.chead .k strong{color:var(--accent)}
.verify{font-size:11px;color:var(--b);text-decoration:none;white-space:nowrap}
.verify:hover{text-decoration:underline}
table.courses{width:100%;border-collapse:collapse;font-size:12.5px}
table.courses td{padding:6px 6px 6px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent);vertical-align:top}
table.courses tr.usable td:first-child{border-left:2px solid var(--accent);padding-left:7px}
table.courses td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--ink2);font-size:12px}
.ja{display:block;font-size:10.5px;color:var(--ink2)}
.ped{display:block;font-size:10.5px;color:var(--accent2);margin-top:1px}
.tsome{display:inline-block;font-size:10.5px;padding:2px 6px;border-radius:5px;white-space:nowrap;border:1px solid var(--line);color:var(--ink2)}
.tsome.ok2{background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:650}
.tsome.ok{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 50%,transparent);font-weight:600}
.nosur{display:block;font-size:10px;color:var(--accent);font-weight:650;margin-top:2px}
.fee{display:block;font-size:10px;color:var(--ink2);margin-top:1px}
.tsome.maybe{color:var(--b);border-color:color-mix(in srgb,var(--b) 45%,transparent)}
.tripstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0;padding:10px 12px;border:1px solid var(--line);border-radius:10px}
.tripstrip .leg{display:flex;flex-direction:column;gap:1px}
.tripstrip .k{font-size:11px;color:var(--ink2)}
.tripstrip strong{font-size:16px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.tripstrip .muted{font-size:10.5px}
.tripstrip .rounds strong{color:var(--ink2)}
.tripstrip .rounds.r3 strong,.tripstrip .rounds.r4 strong,.tripstrip .rounds.r5 strong{color:var(--accent)}
.note.ret{color:var(--ink);font-size:12.5px}
.note.warn{color:var(--accent2)}
.stat .unit{font-size:14px;font-weight:400;color:var(--ink2);margin-left:1px}
.mark{display:inline-block;margin-left:6px;font-size:10px;font-weight:650;color:var(--bg);background:var(--accent);border-radius:4px;padding:1px 4px;vertical-align:1px}
.empty{color:var(--ink2);font-size:13.5px;padding:18px;border:1px dashed var(--line);border-radius:12px}
@media (max-width:680px){
  .wrap{padding:20px 14px 56px}
  .stats{grid-template-columns:repeat(2,1fr);gap:8px}
  .stat{padding:11px 12px;border-radius:12px}
  .stat b{font-size:22px}
  .wgrid{grid-template-columns:1fr;gap:8px}
  .grid{grid-template-columns:1fr;gap:10px}
  .card{padding:14px;border-radius:12px}
  .dayplan{grid-template-columns:repeat(2,1fr)}
  .arrivalbox{flex-wrap:wrap;gap:12px 20px}
  .arrivalbox .big{font-size:25px}
  .controls{padding:13px;gap:11px}
  .row{gap:7px}
  .row > label.k{min-width:100%;margin-bottom:-2px}
  input[type=range]{width:100%}
  .toggle{padding:7px 12px;font-size:12.5px}
  select{padding:7px 9px}
  .row > label.k[for=sort]{min-width:auto;margin:0}
  .specs dt{min-width:56px}
  .chead{flex-direction:column;gap:3px}
  /* 코스 표 → 행 단위 블록 */
  table.courses tr{display:block;padding:9px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent)}
  table.courses tr:last-child{border-bottom:0}
  table.courses tr.usable td:first-child{border-left:0;padding-left:0}
  table.courses tr.usable{border-left:2px solid var(--accent);padding-left:9px}
  table.courses td{display:block;border:0;padding:0}
  table.courses td.num{display:inline-block;margin:3px 10px 3px 0}
  table.courses td:last-child{margin-top:4px}
  .tsome,.nosur,.fee{display:inline-block;margin-right:6px}
  .flights{font-size:12px}
}
.cta{font:inherit;font-size:13px;font-weight:600;color:var(--bg);background:var(--accent);border:0;border-radius:999px;padding:7px 14px;cursor:pointer}
.cta:hover{filter:brightness(1.08)}
dialog#coursemodal{width:min(860px,94vw);max-height:88vh;padding:0;border:1px solid var(--line);border-radius:16px;background:var(--panel);color:var(--ink);box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden}
dialog#coursemodal::backdrop{background:rgba(10,12,16,.55);backdrop-filter:blur(2px)}
dialog#coursemodal[open]{display:flex;flex-direction:column}
.mhead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.mhead h2{margin:0;font-size:17px;letter-spacing:-.01em}
.mhead p{margin:3px 0 0;font-size:12.5px;color:var(--ink2)}
.mhead p strong{color:var(--accent)}
.mactions{display:flex;align-items:center;gap:8px}
.mclose{font:inherit;font-size:12.5px;color:var(--ink2);background:transparent;border:1px solid var(--line);border-radius:999px;padding:6px 13px;cursor:pointer}
.mclose:hover{color:var(--ink);border-color:var(--ink2)}
.mbody{overflow-y:auto;padding:4px 18px 18px}
table.mtable{width:100%;border-collapse:collapse;font-size:13px}
table.mtable thead th{position:sticky;top:0;background:var(--panel);text-align:left;font-size:11px;font-weight:600;color:var(--ink2);padding:9px 10px 7px 0;border-bottom:1px solid var(--line);z-index:1}
tr.aphead th{text-align:left;padding:16px 0 6px;font-weight:600;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent)}
.apcode{font-family:var(--mono);font-size:11px;color:var(--bg);background:var(--ink2);border-radius:4px;padding:2px 5px;margin-right:6px}
.apcity{font-size:14.5px;letter-spacing:-.01em}
.apmeta{font-size:11.5px;color:var(--ink2);font-weight:400;margin-left:8px}
.apcount{float:right;font-size:11px;color:var(--ink2);border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-weight:500}
.apcount.on{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
table.mtable td{padding:8px 10px 8px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 45%,transparent);vertical-align:top}
table.mtable tr.usable .cname{border-left:2px solid var(--accent);padding-left:9px}
table.mtable tr.nope{opacity:.62}
.cname strong{font-weight:600}
.cdist{white-space:nowrap;font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--ink2);font-size:12px}
.cts{white-space:nowrap}
.crem{font-size:12px;color:var(--ink2)}
.mnote{margin:16px 0 0;padding:11px 13px;border-radius:10px;background:color-mix(in srgb,var(--accent2) 8%,transparent);border:1px solid color-mix(in srgb,var(--accent2) 28%,var(--line));font-size:12px;color:var(--ink2)}
tbody.apgroup.off,table.mtable tr.off{display:none}
@media (max-width:680px){
  dialog#coursemodal{width:100vw;max-width:100vw;max-height:92vh;margin:auto 0 0;border-radius:16px 16px 0 0;border-bottom:0}
  .mhead{padding:14px}
  .mbody{padding:0 14px 20px}
  table.mtable thead{display:none}
  table.mtable tr{display:block}
  table.mtable td{display:block;border:0;padding:1px 0}
  table.mtable tbody tr.usable,table.mtable tbody tr.nope{padding:10px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 45%,transparent)}
  table.mtable tr.usable .cname{padding-left:9px}
  table.mtable tr.usable{border-left:2px solid var(--accent);padding-left:9px}
  table.mtable tr.usable .cname{border-left:0;padding-left:0}
  .cdist,.cts{display:inline-block;margin:3px 10px 2px 0}
  tr.aphead th{padding:14px 0 4px}
  .apmeta{display:block;margin:2px 0 0}
  .apcount{float:none;display:inline-block;margin-top:4px}
}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--ink2)}
footer code{background:var(--panel);border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:11.5px}
footer ul{padding-left:18px}
.banner{margin:0 0 22px;padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--accent2) 40%,var(--line));background:color-mix(in srgb,var(--accent2) 8%,transparent);font-size:13px}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <h1>${esc(tripLabel)} 일본 골프·온천 — 오전 도착 가능 공항</h1>
  <p class="lede"><strong>목 출발 · 일 귀국 (3박 4일) · 목·금 골프 / 토·일 쇼핑·온천</strong> 기준. 인천공항 출발 <strong>직항</strong>으로 현지 <strong>${esc(analysis.cutoff)} 이전 도착</strong>이 가능한 공항. 골프장은 <strong>공항 반경 ${analysis.trip.courseRadiusKm ?? 50}km 이내 + 공항↔도시 축선</strong>의 코스만 추렸고, <strong>2인 플레이(2사무) 가능 여부</strong>를 코스별로 표기했습니다. 목·금 플레이라 <em>평일 2사무 보증</em> 플랜이 모두 유효합니다.</p>
  <div class="metaline">
    <span>갱신 ${esc(fmt.format(new Date(analysis.generatedAt)))}</span>
    <span>데이터: ${esc(analysis.sourceLabel)}</span>
    <span>커트오프 ${esc(analysis.cutoff)}</span>
    <span>검토 노선 ${analysis.stats.totalRoutes}개</span>
    <span>${esc(analysis.trip.month ?? '2027-03')} · ${esc(analysis.trip.departDowName ?? '목')}→${esc(analysis.trip.returnDowName ?? '일')}</span>
  </div>
</header>

${analysis.source !== 'api' ? `<p class="banner"><strong>추정 데이터로 렌더링됨.</strong> 편명 단위 실제 시각은 공공데이터포털 <em>인천국제공항공사 여객기 정기운항편 일정 정보</em> API 키를 <code>.env</code>에 넣고 <code>npm run build:api</code>를 실행하면 확정됩니다. 현재 표는 노선별 오전 출발 윈도우 기준 가능성 판정입니다.</p>` : ''}

<section class="windows">
  <h2 class="sec">출발 ${esc(analysis.trip.departDowName ?? '목')}요일 · 귀국 ${esc(analysis.trip.returnDowName ?? '일')}요일 — 3월 후보 4개 창</h2>
  <div class="wgrid">
${(analysis.trip.windows ?? []).map((w) => {
  const d = (iso) => { const [, m, dd] = iso.split('-'); return `${Number(m)}/${Number(dd)}`; };
  return `<div class="win${(w.tags ?? []).includes('연휴주의') || (w.tags ?? []).includes('시즌변경') ? ' caution' : ''}">
      <div class="wdates">${esc(d(w.depart))} <span class="arrow">→</span> ${esc(d(w.return))}</div>
      <div class="wtags">${(w.tags ?? []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      <ul>${(w.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    </div>`;
}).join('\n')}
  </div>
</section>

<section class="stats">
  <div class="stat"><b id="s-feasible">${analysis.stats.feasible}</b><span>${esc(analysis.cutoff)} 이전 도착</span></div>
  <div class="stat accent"><b id="s-early">${analysis.stats.beforeEarly}</b><span>${esc(analysis.early)} 이전 도착</span></div>
  <div class="stat"><b id="s-golf">${analysis.stats.golfPlayable}</b><span>3월 골프 가능</span></div>
  <div class="stat"><b id="s-a">${analysis.stats.tierA}</b><span>최우선 후보</span></div>
  <div class="stat accent"><b id="s-two">${analysis.stats.twosomeReady}</b><span>2인 플레이 코스 보유</span></div>
  <div class="stat"><b id="s-sun">${analysis.stats.twoRounds}</b><span>목·금 2라운딩 가능</span></div>
</section>

<div class="controls">
  <div class="row">
    <label class="k" for="cut">도착 커트오프</label>
    <input id="cut" type="range" min="540" max="900" step="15" value="${(() => { const [h, m] = analysis.cutoff.split(':').map(Number); return h * 60 + m; })()}">
    <span class="cut" id="cutlabel">${esc(analysis.cutoff)}</span>
  </div>
  <div class="row">
    <label class="k">지역</label>
    <div class="row" id="regions">${regions.map((r) => `<label class="toggle"><input type="checkbox" value="${esc(r)}" checked>${esc(r)}</label>`).join('')}</div>
  </div>
  <div class="row">
    <label class="k">골프장</label>
    <button type="button" id="openmodal" class="cta">2인 플레이 골프장 한눈에 보기 →</button>
  </div>
  <div class="row">
    <label class="k">조건</label>
    <label class="toggle"><input type="checkbox" id="earlyonly">${esc(analysis.early)} 전 도착만</label>
    <label class="toggle"><input type="checkbox" id="golfonly">3월 골프 가능만</label>
    <label class="toggle"><input type="checkbox" id="onsenonly">온천 양호 이상만</label>
    <label class="toggle"><input type="checkbox" id="twosomeonly">2인 플레이 가능 코스 있는 곳만</label>
    <label class="toggle"><input type="checkbox" id="sundayonly">일요일 여유 4시간+</label>
    <label class="k" for="sort" style="margin-left:auto">정렬</label>
    <select id="sort">
      <option value="score">종합 추천순</option>
      <option value="arrival">도착 이른순</option>
      <option value="golf">골프 조건순</option>
      <option value="onsen">온천 조건순</option>
      <option value="rounds">라운딩 횟수순</option>
      <option value="twosome">2인 플레이 코스순</option>
      <option value="shopping">쇼핑 조건순</option>
    </select>
  </div>
</div>

<h2 class="sec">오전 도착 가능 (<span id="cnt">${feasible.length}</span>)</h2>
<div class="grid" id="grid">
${feasible.map((a) => card(a, analysis.early)).join('\n')}
</div>
<p class="empty" id="noresult" style="display:none">조건에 맞는 공항이 없습니다. 커트오프를 늦추거나 필터를 해제하세요.</p>

${infeasible.length ? `<h2 class="sec">오전 도착 불가 (${infeasible.length})</h2>
<div class="grid">
${infeasible.map((a) => `<article class="card tier-X"><div class="titleline"><h3>${esc(a.city)} <span class="iata">${esc(a.iata)}</span></h3><span class="badge tX">${esc(a.verdict.label)}</span></div><p class="sub">${esc(a.region)} · 비행 ${esc(a.blockLabel)} · 가장 빠른 도착 ${esc(a.earliestArrival ?? '—')}</p><p class="note">${esc(a.verdict.reason)} — ${esc(analysis.cutoff)} 도착은 인천 ${esc(a.latestDepForCutoff)} 이전, ${esc(analysis.early)} 도착은 ${esc(a.latestDepForEarly)} 이전 출발편이 필요합니다.</p>${a.sourceNote ? `<p class="note src">※ ${esc(a.sourceNote)}</p>` : ''}</article>`).join('\n')}
</div>` : ''}

${courseModal(analysis)}

<footer>
  <p><strong>판정 방식</strong> — 한국·일본은 시차가 없으므로 <em>현지 도착시각 = 인천 출발시각 + 운항시간</em>으로 계산했습니다. 운항시간은 노선별 표준 block time 추정치입니다.</p>
  <ul>
    <li>2027년 3월은 <strong>IATA 동계시즌(~3/27)과 하계시즌(3/28~)이 갈리는 달</strong>입니다. 3월 하순 출발이면 하계 스케줄을 확인하세요.</li>
    <li>홋카이도·도호쿠 공항은 3월 골프 코스가 적설 휴장이라 온천 전용으로 분류했습니다.</li>
    <li>골프장 티업은 보통 현지 도착 후 2시간 이상 필요합니다(수하물·렌터카·이동). 도착 12:00이면 오후 1~2시 티업이 현실적입니다.</li>
    <li><strong>목요일 티업</strong> = 도착 + 2시간(수하물·렌터카·이동). 12:00 이전이면 '여유', 13:30 이전 '가능', 14:30 이전 '타이트'(3월 일몰 18시 전후, 셀프 18홀 4시간 30분).</li>
    <li><strong>2인 플레이</strong>: 일본은 3~4인 플레이가 기본이고 2사무는 1인당 500~2,200엔 할증이 붙습니다. <em>割増なし(할증 없음) 플랜은 평일 한정이 많고 토·일·공휴일은 2사무 대상 제외</em>가 흔합니다 — 목·금 플레이가 이 문제를 피합니다.</li>
    <li>일요일 현지 활동 마감 = 귀국편 출발 − 수속 2시간 − 공항이동 1시간. 1일 1왕복 노선은 낮에 떠서 일요일이 거의 사라집니다.</li>
  </ul>
  <p>갱신: <code>npm run build</code> · 실제 스케줄 반영: <code>npm run build:api</code> · 주간 배치: <code>npm run weekly</code></p>
</footer>
</div>

<script>
(function(){
  const grid = document.getElementById('grid');
  const cards = [...grid.querySelectorAll('.card')];
  const cut = document.getElementById('cut');
  const cutlabel = document.getElementById('cutlabel');
  const sortSel = document.getElementById('sort');
  const golfonly = document.getElementById('golfonly');
  const earlyonly = document.getElementById('earlyonly');
  const sundayonly = document.getElementById('sundayonly');
  const twosomeonly = document.getElementById('twosomeonly');
  const onsenonly = document.getElementById('onsenonly');
  const regionBoxes = [...document.querySelectorAll('#regions input')];
  const cnt = document.getElementById('cnt');
  const noresult = document.getElementById('noresult');
  const pad = (n) => String(n).padStart(2,'0');
  const hhmm = (m) => pad(Math.floor(m/60)) + ':' + pad(m%60);
  const toMin = (s) => { const p = String(s).split(':'); return (+p[0])*60 + (+p[1]); };

  function apply(){
    const c = +cut.value;
    cutlabel.textContent = hhmm(c);
    const regions = new Set(regionBoxes.filter(b=>b.checked).map(b=>b.value));
    let shown = 0;
    for (const el of cards){
      const earliest = el.dataset.earliest ? toMin(el.dataset.earliest) : null;
      let ok = earliest !== null && earliest <= c;
      if (ok && !regions.has(el.dataset.region)) ok = false;
      if (ok && earlyonly.checked && el.dataset.early !== '1') ok = false;
      if (ok && golfonly.checked && +el.dataset.golf < 2) ok = false;
      if (ok && onsenonly.checked && +el.dataset.onsen < 2) ok = false;
      if (ok && sundayonly.checked && el.dataset.sunday !== '1') ok = false;
      if (ok && twosomeonly.checked && +el.dataset.twosome < 1) ok = false;
      el.classList.toggle('off', !ok);
      if (ok) shown++;
      // 편별 행도 커트오프에 맞춰 숨김
      el.querySelectorAll('.flights tbody tr').forEach(tr=>{
        tr.style.display = (+tr.dataset.arr <= c) ? '' : 'none';
      });
    }
    cnt.textContent = shown;
    noresult.style.display = shown ? 'none' : '';
    const visible = cards.filter(el=>!el.classList.contains('off'));
    document.getElementById('s-feasible').textContent = visible.length;
    document.getElementById('s-early').textContent = visible.filter(el=>el.dataset.early==='1').length;
    document.getElementById('s-golf').textContent = visible.filter(el=>+el.dataset.golf>=2).length;
    document.getElementById('s-sun').textContent = visible.filter(el=>+el.dataset.rounds>=2).length;
    document.getElementById('s-two').textContent = visible.filter(el=>+el.dataset.twosome>0).length;
    document.getElementById('s-a').textContent = visible.filter(el=>el.classList.contains('tier-A')).length;
  }

  function sortCards(){
    const key = sortSel.value;
    const val = (el) => {
      if (key === 'arrival') return el.dataset.earliest ? toMin(el.dataset.earliest) : 9999;
      if (key === 'golf') return -(+el.dataset.golf * 10 + +el.dataset.onsen);
      if (key === 'onsen') return -(+el.dataset.onsen * 10 + +el.dataset.golf);
      if (key === 'rounds') return -(+el.dataset.rounds * 10 + +el.dataset.golf);
      if (key === 'twosome') return -(+el.dataset.twosome * 10 + +el.dataset.golf);
      if (key === 'shopping') return -(+el.dataset.shopping * 10 + +el.dataset.onsen);
      return -(+el.dataset.score);
    };
    [...cards].sort((a,b)=>val(a)-val(b)).forEach(el=>grid.appendChild(el));
  }

  // 2인 플레이 골프장 팝업
  const modal = document.getElementById('coursemodal');
  const openBtn = document.getElementById('openmodal');
  const mfilter = document.getElementById('mfilter');
  function applyModalFilter(){
    const only = mfilter.checked;
    modal.querySelectorAll('tbody.apgroup').forEach(g=>{
      g.querySelectorAll('tr[data-usable]').forEach(tr=>{
        tr.classList.toggle('off', only && tr.dataset.usable !== '1');
      });
      g.classList.toggle('off', only && g.dataset.usable !== '1');
    });
  }
  openBtn.addEventListener('click', ()=>{ applyModalFilter(); modal.showModal(); });
  mfilter.addEventListener('change', applyModalFilter);
  modal.querySelector('.mclose').addEventListener('click', ()=>modal.close());
  modal.addEventListener('click', (e)=>{ if (e.target === modal) modal.close(); });

  cut.addEventListener('input', apply);
  golfonly.addEventListener('change', apply);
  earlyonly.addEventListener('change', apply);
  sundayonly.addEventListener('change', apply);
  twosomeonly.addEventListener('change', apply);
  onsenonly.addEventListener('change', apply);
  regionBoxes.forEach(b=>b.addEventListener('change', apply));
  sortSel.addEventListener('change', ()=>{ sortCards(); apply(); });
  apply();
})();
</script>
</body>
</html>`;
}
