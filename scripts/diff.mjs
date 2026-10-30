// 이전/현재 analysis.json 을 비교해 '가능 공항' 변동을 출력
import { readFile } from 'node:fs/promises';

const [prevPath, curPath] = process.argv.slice(2);
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const [prev, cur] = await Promise.all([read(prevPath), read(curPath)]);

const map = (a) => new Map(a.airports.map((x) => [x.iata, x]));
const [p, c] = [map(prev), map(cur)];

const added = [...c.values()].filter((x) => x.feasible && !p.get(x.iata)?.feasible);
const removed = [...p.values()].filter((x) => x.feasible && !c.get(x.iata)?.feasible);
const shifted = [...c.values()].filter((x) => {
  const old = p.get(x.iata);
  return old && x.feasible && old.feasible && old.earliestArrival !== x.earliestArrival;
});

if (!added.length && !removed.length && !shifted.length) {
  console.log('변동 없음');
} else {
  for (const x of added) console.log(`+ 신규 가능: ${x.iata} ${x.city} (도착 ${x.earliestArrival})`);
  for (const x of removed) console.log(`- 불가 전환: ${x.iata} ${x.city}`);
  for (const x of shifted) console.log(`~ 도착시각 변경: ${x.iata} ${x.city} ${p.get(x.iata).earliestArrival} → ${x.earliestArrival}`);
}
const rounds = [...c.values()].filter((x) => {
  const old = p.get(x.iata);
  return old && x.feasible && old.feasible && (old.maxRounds ?? 0) !== (x.maxRounds ?? 0);
});
for (const x of rounds) console.log(`~ 라운딩 횟수 변경: ${x.iata} ${x.city} ${p.get(x.iata).maxRounds}회 → ${x.maxRounds}회`);

const ret = [...c.values()].filter((x) => {
  const old = p.get(x.iata);
  return old && x.returnLeg && old.returnLeg && old.returnLeg.depJST !== x.returnLeg.depJST;
});
for (const x of ret) console.log(`~ 귀국편 변경: ${x.iata} ${x.city} ${p.get(x.iata).returnLeg.depJST} → ${x.returnLeg.depJST}`);

if (prev.source !== cur.source) console.log(`* 데이터 소스 변경: ${prev.source} → ${cur.source}`);
