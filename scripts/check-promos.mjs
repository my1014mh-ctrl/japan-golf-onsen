// 카드사 × OTA 할인 프로모션 상태를 빌드/배치 시점에 확인해 data/promos.json 에 캐시한다.
// 페이지 런타임에서 외부 조회는 불가(아티팩트 CSP·CORS)하므로 여기서 구워 넣는다.
//   사용: node scripts/check-promos.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const OUT = new URL('../data/promos.json', import.meta.url);

async function fetchPage(url, timeout = 25) {
  try {
    const { stdout } = await exec('curl', [
      '-sL', '-m', String(timeout), '-A', UA, '--compressed',
      '-w', '\\n__HTTP__%{http_code}', url,
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    const buf = stdout.toString('utf8');
    const m = buf.match(/\n__HTTP__(\d{3})$/);
    return { status: m ? Number(m[1]) : 0, body: m ? buf.slice(0, m.index) : buf };
  } catch (e) {
    return { status: 0, body: '', error: e.message };
  }
}

const toText = (html) => {
  let t = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  t = t.replace(/<[^>]+>/g, '\n');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
};

// ── 소스 정의 ──
const SOURCES = [
  {
    id: 'agoda-kb-official',
    label: '아고다 KB국민카드 전용 페이지',
    url: 'https://www.agoda.com/ko-kr/kbcard',
    kind: 'landing',
    note: 'SPA라 본문 추출 불가 — 접근 가능 여부만 확인한다. 실제 할인은 이 페이지에서 검색·선결제해야 적용된다',
  },
  {
    id: 'kbcard-events',
    label: 'KB국민카드 이벤트',
    url: 'https://card.kbcard.com/CRD/DVIEW/HCAMCXEVNA0001',
    kind: 'landing',
    note: '이벤트 목록이 동적 로드라 본문 추출 불가 — 접근 가능 여부만 확인',
  },
  {
    id: 'agodaprice-kb',
    label: '아고다 KB 할인 정리 (제3자)',
    url: 'https://www.agodaprice.com/cards/kb',
    kind: 'parse',
    parse(lines) {
      const joined = lines.join('\n');
      const title = lines[0] ?? null;
      // 「… 태국·미국·말레이시아 호텔은 10%, 그 외 지역은 7% 할인 …」 형태의 요약 문장
      const summary = lines.find((l) => /할인이 적용됩니다/.test(l) && /%/.test(l)) ?? null;
      const rates = [...new Set((summary ?? joined).match(/\d{1,2}%/g) ?? [])];
      const confirmedAt = (() => {
        const i = lines.findIndex((l) => /공식 안내 확인/.test(l));
        return i >= 0 ? lines.slice(i + 1, i + 3).find((l) => /^\d{4}-\d{2}-\d{2}$/.test(l)) ?? null : null;
      })();
      const bookFrom = (() => {
        const i = lines.findIndex((l) => /예약 ?기간/.test(l));
        return i >= 0 ? lines.slice(i + 1, i + 3).find((l) => /^\d{4}-\d{2}-\d{2}$/.test(l)) ?? null : null;
      })();
      // 일본은 지정 지역(태국·미국·말레이시아)에 없으므로 '그 외 지역' 요율 적용
      const japanRate = (() => {
        const m = (summary ?? '').match(/그 ?외 ?지역은? ?(\d{1,2})%/);
        return m ? `${m[1]}%` : (rates.length ? rates[rates.length - 1] : null);
      })();
      return { title, summary, rates, japanRate, confirmedAt, bookFrom };
    },
  },
];

async function main() {
  const checkedAt = new Date().toISOString();
  const results = [];
  for (const s of SOURCES) {
    const { status, body, error } = await fetchPage(s.url);
    const rec = { id: s.id, label: s.label, url: s.url, kind: s.kind, status, ok: status === 200, note: s.note ?? null };
    if (error) rec.error = error;
    if (s.kind === 'parse' && status === 200) {
      try { rec.data = s.parse(toText(body)); } catch (e) { rec.parseError = e.message; }
    }
    results.push(rec);
    console.log(`[${rec.ok ? 'OK ' : 'FAIL'}] ${s.label} — HTTP ${status}${rec.data?.japanRate ? ` / 일본 적용 ${rec.data.japanRate}` : ''}`);
  }

  const parsed = results.find((r) => r.data)?.data ?? null;
  const promos = {
    meta: {
      checkedAt,
      description: 'KB국민카드 × 아고다 할인 상태. 페이지 런타임에서는 외부 조회가 불가하므로 빌드/배치 시점에 확인해 구워 넣는다.',
      staleAfterDays: 30,
    },
    headline: parsed ? {
      card: 'KB국민카드',
      ota: '아고다',
      japanRate: parsed.japanRate,
      summary: parsed.summary,
      rates: parsed.rates,
      officialConfirmedAt: parsed.confirmedAt,
      bookFrom: parsed.bookFrom,
      applyUrl: 'https://www.agoda.com/ko-kr/kbcard',
      howTo: 'KB국민카드 전용 페이지에서 호텔을 검색해 선결제. 결제 단계에서 카드번호 입력 시 자동 적용 — 별도 할인코드 없음',
      caveat: '일본은 지정 지역(태국·미국·말레이시아)이 아니라 「그 외 지역」 요율이 적용된다. 선결제 조건이며 결제 직전 화면에서 할인액 표시를 반드시 확인할 것',
    } : null,
    sources: results,
  };
  await writeFile(OUT, JSON.stringify(promos, null, 2));
  console.log('');
  console.log(`promos.json 저장 — 확인 ${checkedAt.slice(0, 10)}${promos.headline ? ` / 일본 적용 ${promos.headline.japanRate}` : ''}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
