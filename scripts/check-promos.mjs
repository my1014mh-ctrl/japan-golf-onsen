// 카드/결제수단 × 아고다 할인 상태를 빌드·배치 시점에 확인해 data/promos.json 에 캐시한다.
// 페이지 런타임에서 외부 조회는 불가(아티팩트 CSP·CORS)하므로 여기서 구워 넣는다.
//   사용: node scripts/check-promos.mjs
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const OUT = new URL('../data/promos.json', import.meta.url);
const TARGET_COUNTRY = '일본';

async function fetchPage(url, timeout = 25) {
  try {
    const { stdout } = await exec('curl', ['-sL', '-m', String(timeout), '-A', UA, '--compressed',
      '-w', '\\n__HTTP__%{http_code}', url], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    const buf = stdout.toString('utf8');
    const m = buf.match(/\n__HTTP__(\d{3})$/);
    return { status: m ? Number(m[1]) : 0, body: m ? buf.slice(0, m.index) : buf };
  } catch (e) {
    return { status: 0, body: '', error: e.message };
  }
}

const toLines = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);

// 「… 일본 … 15% … 그 외 … 12% …」 류의 요약에서 대상국 요율을 뽑는다
function pickCountryRate(summary) {
  if (!summary) return null;
  // 대상국이 나열된 절에 붙은 요율
  const clauses = summary.split(/[,.、]/);
  for (const c of clauses) {
    if (c.includes(TARGET_COUNTRY)) {
      const m = c.match(/(\d{1,2})\s?%/);
      if (m) return `${m[1]}%`;
    }
  }
  // 대상국이 명시되지 않으면 '그 외 지역' 요율
  const other = summary.match(/그 ?외 ?(?:지역|국가)는? ?(\d{1,2})\s?%/);
  if (other) return `${other[1]}%`;
  const all = summary.match(/(\d{1,2})\s?%/g);
  return all ? all[all.length - 1] : null;
}

function parsePromoPage(lines) {
  const joined = lines.join(' ');
  const title = lines[0] ?? null;
  const ended = /행사 ?종료|진행되지 않습니다|진행 중인 .{0,12}할인이 없|받을 수 있는 .{0,12}할인이 없/.test(joined);
  const summary = lines.find((l) => /%/.test(l) && /(할인이 적용|할인이 됩니다|할인됩니다|할인이 들어)/.test(l))
    ?? lines.find((l) => /%/.test(l) && l.length > 40) ?? null;
  const after = (label) => {
    const i = lines.findIndex((l) => new RegExp(label).test(l));
    return i >= 0 ? lines.slice(i + 1, i + 3).find((l) => /^\d{4}-\d{2}-\d{2}$/.test(l)) ?? null : null;
  };
  const codes = [...new Set(joined.match(/\b(?:UPI|AGD|LP)[A-Z0-9]{2,10}\b/g) ?? [])];
  const maxCap = joined.match(/최대 할인 ?금액은? ?\$?([\d,]+)/)?.[1] ?? null;
  return {
    title, ended, summary,
    rates: [...new Set((summary ?? '').match(/\d{1,2}\s?%/g) ?? [])].map((x) => x.replace(/\s/g, '')),
    countryRate: pickCountryRate(summary),
    codes,
    maxCapUsd: maxCap,
    officialConfirmedAt: after('공식 안내 확인'),
    bookFrom: after('예약 ?기간'),
  };
}

// 카드사 비교 목록에서 현재 진행 중인 최고 요율을 뽑는다
function parseCardList(lines) {
  const out = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const m = lines[i + 1].match(/^최대 (\d{1,2})% (?:추가 )?할인$/);
    if (m && /카드|페이|카드$/.test(lines[i]) && lines[i].length <= 12) {
      out.push({ card: lines[i], maxRate: Number(m[1]) });
    }
  }
  return [...new Map(out.map((x) => [x.card, x])).values()].sort((a, b) => b.maxRate - a.maxRate);
}

const PROMOS = [
  {
    id: 'kb',
    card: 'KB국민카드',
    applyUrl: 'https://www.agoda.com/ko-kr/kbcard',
    howTo: 'KB국민카드 전용 페이지에서 검색해 선결제. 결제 단계에서 카드번호 입력 시 자동 적용 — 별도 코드 없음',
    sources: [
      { id: 'kb-landing', label: '아고다 KB 전용 페이지', url: 'https://www.agoda.com/ko-kr/kbcard', kind: 'landing',
        note: 'SPA라 본문 추출 불가 — 접근 가능 여부만 확인' },
      { id: 'kb-parse', label: '아고다 KB 할인 정리 (제3자)', url: 'https://www.agodaprice.com/cards/kb', kind: 'parse' },
    ],
  },
  {
    id: 'unionpay',
    card: '유니온페이',
    applyUrl: 'https://www.agoda.com/ko-kr/',
    howTo: '결제 통화를 USD로 바꾸고 결제수단을 UnionPay로 선택한 뒤 할인코드를 직접 입력. 무이자 할부 선택 시 할인 미적용, 카드당 사용 횟수 제한',
    historicalCodes: [
      { code: 'UPI15', note: '일본·중국·베트남·홍콩·대만 15%, 카드당 2회' },
      { code: 'UPI12', note: '그 외 국가 12%, 카드당 1회' },
    ],
    historicalNote: '지난 회차에 쓰인 코드. 재개 시 코드가 바뀔 수 있으므로 그대로 입력하지 말고 재확인할 것',
    sources: [
      { id: 'up-parse', label: '아고다 유니온페이 할인 정리 (제3자)', url: 'https://www.agodaprice.com/cards/unionpay', kind: 'parse' },
      { id: 'kb-up-event', label: 'KB카드 유니온페이 아고다 이벤트', url: 'https://m.kbcard.com/BON/DVIEW/MBBMCXHIABNC0026?evntSerno=277983&evntMain=Y', kind: 'parse-kb-event' },
    ],
  },
];

function parseKbEvent(lines) {
  const joined = lines.join(' ');
  const period = joined.match(/예약 ?((?:\d{2}|\d{4})\.\d{2}\.\d{2}[^~]*~[^대]{0,24})/)?.[1]?.trim() ?? null;
  const stay = joined.match(/숙박 ?((?:\d{2}|\d{4})\.\d{2}\.\d{2}[^~]*~[^대]{0,24})/)?.[1]?.trim() ?? null;
  const rates = [...new Set(joined.match(/\d{1,2}%/g) ?? [])];
  // 예약 기간 종료 연도로 만료 판단
  const yearMatch = period?.match(/~ ?(\d{2})\./);
  const endYear = yearMatch ? 2000 + Number(yearMatch[1]) : null;
  const expired = endYear != null && endYear < new Date().getFullYear();
  return { title: lines.find((l) => /아고다/.test(l)) ?? null, period, stay, rates, endYear, expired };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const results = [];

  for (const p of PROMOS) {
    const srcs = [];
    let parsed = null;
    let kbEvent = null;
    for (const s of p.sources) {
      const { status, body, error } = await fetchPage(s.url);
      const rec = { ...s, status, ok: status === 200 };
      if (error) rec.error = error;
      if (status === 200) {
        const lines = toLines(body);
        try {
          if (s.kind === 'parse') parsed ??= parsePromoPage(lines);
          if (s.kind === 'parse-kb-event') kbEvent = parseKbEvent(lines);
        } catch (e) { rec.parseError = e.message; }
      }
      srcs.push(rec);
    }
    const active = parsed ? !parsed.ended : null;
    results.push({
      id: p.id, card: p.card, ota: '아고다',
      status: active == null ? 'unknown' : active ? 'active' : 'ended',
      countryRate: parsed?.countryRate ?? null,
      rates: parsed?.rates ?? [],
      codes: parsed?.codes ?? [],
      maxCapUsd: parsed?.maxCapUsd ?? null,
      summary: parsed?.summary ?? null,
      officialConfirmedAt: parsed?.officialConfirmedAt ?? null,
      bookFrom: parsed?.bookFrom ?? null,
      applyUrl: p.applyUrl,
      howTo: p.howTo,
      historicalCodes: p.historicalCodes ?? null,
      historicalNote: p.historicalNote ?? null,
      kbEvent,
      sources: srcs,
    });
    const r = results.at(-1);
    console.log(`[${r.status === 'active' ? '진행' : r.status === 'ended' ? '종료' : '미상'}] ${p.card} × 아고다 — ${TARGET_COUNTRY} ${r.countryRate ?? '—'}${r.codes.length ? ` / 코드 ${r.codes.join(',')}` : ''}`);
    if (kbEvent?.expired) console.log(`   ⚠ KB 이벤트 페이지는 만료 행사 (예약 ${kbEvent.period})`);
  }

  // 전체 카드사 비교 — 현재 최고 요율
  const list = await fetchPage('https://www.agodaprice.com/cards/');
  const cards = list.status === 200 ? parseCardList(toLines(list.body)) : [];
  if (cards.length) console.log('');
  if (cards.length) console.log(`[비교] 현재 최고 요율: ${cards.slice(0, 4).map((c) => `${c.card} ${c.maxRate}%`).join(' · ')}`);

  const promos = {
    meta: {
      checkedAt,
      targetCountry: TARGET_COUNTRY,
      staleAfterDays: 30,
      description: 'KB국민카드·유니온페이 × 아고다 할인 상태. 페이지 런타임에서는 외부 조회가 불가하므로 빌드·배치 시점에 확인해 구워 넣는다.',
      note: '아고다는 결제수단 프로모션을 주기적으로 여닫는다. status=ended 여도 재개될 수 있어 주간 배치가 계속 확인한다.',
    },
    promos: results,
    cardRanking: cards,
    rankingUrl: 'https://www.agodaprice.com/cards/',
  };
  await writeFile(OUT, JSON.stringify(promos, null, 2));
  console.log('');
  console.log(`promos.json 저장 — ${results.length}개 프로모션, 확인 ${checkedAt.slice(0, 10)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
