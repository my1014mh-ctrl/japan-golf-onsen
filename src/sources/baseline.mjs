import { readFile } from 'node:fs/promises';

export async function loadBaseline(root) {
  const raw = await readFile(new URL('../../data/routes-baseline.json', root ?? import.meta.url), 'utf8');
  const parsed = JSON.parse(raw);
  return {
    source: 'baseline',
    label: '추정 베이스라인 (data/routes-baseline.json)',
    fetchedAt: new Date().toISOString(),
    meta: parsed.meta,
    routes: parsed.routes,
  };
}
