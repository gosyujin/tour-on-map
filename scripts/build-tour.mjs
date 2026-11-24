// tours/tour.txt(公式サイトの日程表の貼り付け)と data/venues.json(会場の住所・座標)から、
// 画面が最初に読む public/data/tour.json を作る。
//
//   npm run build-tour                 # .cache/ に経路があればそれを使う
//   npm run build-tour -- --force      # 経路を OSRM から取り直す
//   npm run build-tour -- tours/x.txt  # 別の入力ファイル
//
// 変換そのものは src/lib/ にあり、画面の「日程を変える」と同じものを使う。
// ここで足しているのは、ファイルの読み書きと、OSRM の応答を .cache/ に置くことだけ。

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OSRM_URL, buildLegs, fetchRoute, missingVenues, resolveVenues, routeKey, toLeg, toTour } from '../src/lib/build-tour.mjs';
import { parseTour } from '../src/lib/parse-tour.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENUES = path.join(ROOT, 'data/venues.json');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public/data/tour.json');

const args = process.argv.slice(2);
const force = args.includes('--force');
const input = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) ?? 'tours/tour.txt');

// 入力の不備(会場が辞書に無い、など)は、スタックトレースではなく内容だけを出す
process.on('uncaughtException', (err) => {
  console.error(`エラー: ${err.message}`);
  process.exit(1);
});

/** 2 会場間の車の経路。OSRM の応答は .cache/ に置く。 */
async function route(from, to) {
  const file = path.join(CACHE, `route-${createHash('sha1').update(routeKey(from, to)).digest('hex').slice(0, 16)}.json`);
  let data;
  if (!force) data = await readFile(file, 'utf8').then(JSON.parse, () => null);
  if (!data) {
    data = await fetchRoute(from, to, process.env.OSRM_URL ?? OSRM_URL);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(data));
  }
  return toLeg(data);
}

const events = parseTour(await readFile(input, 'utf8'));
if (!events.length) throw new Error(`${path.relative(ROOT, input)} に公演がありません(「日時」「会場」の行が必要です)`);
console.log(`${path.relative(ROOT, input)}: ${events.length} 公演`);

const venues = JSON.parse(await readFile(VENUES, 'utf8'));
const missing = missingVenues(events, venues);
if (missing.length) {
  const template = Object.fromEntries(missing.map((m) => [m, { address: '' }]));
  throw new Error(
    `data/venues.json に無い会場があります。住所を足してください(座標は住所から自動で入ります):\n${JSON.stringify(template, null, 2)}`,
  );
}
const geocoded = await resolveVenues(events, venues, (name, g) => console.log(`  座標を取得: ${name} ← ${g.matched}`)).catch((err) => {
  if (err.venue) err.message += '。data/venues.json に lat / lng を書いてください';
  throw err;
});
// 住所から引いた座標は、辞書に書き戻す
if (geocoded.length) await writeFile(VENUES, `${JSON.stringify(venues, null, 2)}\n`);

const legs = await buildLegs(events, route, (leg, a, b) => {
  if (!leg.distance) return;
  const note = leg.ferry ? ` ※フェリー ${(leg.ferry / 1000).toFixed(0)}km を含む` : '';
  console.log(
    `  ${String(leg.from + 1).padStart(2)} → ${String(leg.to + 1).padStart(2)}  ${(leg.distance / 1000).toFixed(0).padStart(5)} km  ${(leg.duration / 3600).toFixed(1).padStart(5)} h  ${a.name} → ${b.name}${note}`,
  );
});

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(toTour(events, legs))}\n`);

const total = legs.reduce((s, l) => s + l.distance, 0);
const points = legs.reduce((s, l) => s + l.coordinates.length, 0);
console.log(`合計 ${(total / 1000).toFixed(0)} km / 線の点 ${points} → ${path.relative(ROOT, OUT)}`);
