// tours/tour.txt(公式サイトの日程表の貼り付け)と data/venues.json(会場の住所・座標)から、
// 画面が読む public/data/tour.json を作る。
//
//   npm run build-tour                 # .cache/ に経路があればそれを使う
//   npm run build-tour -- --force      # 経路を OSRM から取り直す
//   npm run build-tour -- tours/x.txt  # 別の入力ファイル
//
// 経路は公開の OSRM サーバー(車・陸路)から取る。CI からは呼ばず、できた tour.json をコミットする。

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTour } from './parse-tour.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENUES = path.join(ROOT, 'data/venues.json');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public/data/tour.json');

const OSRM_URL = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
const GSI_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
// 経路の線を間引くときの許容誤差(度)。0.0003 度 ≒ 30m
const SIMPLIFY = 0.0003;

const args = process.argv.slice(2);
const force = args.includes('--force');
const input = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) ?? 'tours/tour.txt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 入力の不備(会場が辞書に無い、など)は、スタックトレースではなく内容だけを出す
process.on('uncaughtException', (err) => {
  console.error(`エラー: ${err.message}`);
  process.exit(1);
});

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${new URL(url).host} から取得できません: ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
}

// ---- 会場 ------------------------------------------------------------------

/** 住所 → 座標(国土地理院の住所検索)。見つからなければ null。 */
async function geocode(address) {
  const list = await getJson(`${GSI_URL}?q=${encodeURIComponent(address)}`);
  const hit = list[0];
  if (!hit) return null;
  const [lng, lat] = hit.geometry.coordinates;
  return { lat, lng, matched: hit.properties.title };
}

/** 公演に会場辞書の住所・座標を付ける。座標の無い会場は住所から引いて、辞書に書き戻す。 */
async function resolveVenues(events) {
  const venues = JSON.parse(await readFile(VENUES, 'utf8'));
  const missing = [];
  let changed = false;

  for (const e of events) {
    const v = venues[e.venue];
    if (!v || !v.address) {
      if (!missing.includes(e.venue)) missing.push(e.venue);
      continue;
    }
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') {
      const g = await geocode(v.address);
      if (!g) throw new Error(`住所から座標を引けません: ${e.venue} (${v.address})。data/venues.json に lat / lng を書いてください`);
      console.log(`  座標を取得: ${e.venue} ← ${g.matched}`);
      Object.assign(v, { lat: g.lat, lng: g.lng });
      changed = true;
    }
    Object.assign(e, { address: v.address, lat: v.lat, lng: v.lng });
    if (v.approx) e.approx = true;
  }

  if (missing.length) {
    const template = Object.fromEntries(missing.map((m) => [m, { address: '' }]));
    throw new Error(
      `data/venues.json に無い会場があります。住所を足してください(座標は住所から自動で入ります):\n${JSON.stringify(template, null, 2)}`,
    );
  }
  if (changed) await writeFile(VENUES, `${JSON.stringify(venues, null, 2)}\n`);
}

// ---- 経路 ------------------------------------------------------------------

/** Douglas-Peucker で線を間引く。 */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let max = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (max > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (n) => Math.round(n * 1e5) / 1e5;

/** 2 会場間の車の経路。OSRM の結果は .cache/ に置く。 */
async function route(from, to) {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const file = path.join(CACHE, `route-${createHash('sha1').update(coords).digest('hex').slice(0, 16)}.json`);

  let data;
  if (!force) data = await readFile(file, 'utf8').then(JSON.parse, () => null);
  if (!data) {
    data = await getJson(`${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`);
    if (data.code !== 'Ok') throw new Error(`経路を取得できません (${from.venue} → ${to.venue}): ${data.code} ${data.message ?? ''}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(data));
    await sleep(1100); // 公開サーバーなので間隔を空ける
  }

  const r = data.routes[0];
  const steps = r.legs.flatMap((l) => l.steps);
  // 陸路だけのつもりなので、フェリーの区間が混じったら分かるようにしておく
  const ferry = steps.filter((s) => s.mode === 'ferry').reduce((sum, s) => sum + s.distance, 0);
  return {
    distance: Math.round(r.distance),
    duration: Math.round(r.duration),
    ...(ferry > 0 ? { ferry: Math.round(ferry) } : {}),
    coordinates: simplify(r.geometry.coordinates, SIMPLIFY).map(([x, y]) => [round(x), round(y)]),
  };
}

// ---- 本体 ------------------------------------------------------------------

const events = parseTour(await readFile(input, 'utf8'));
if (!events.length) throw new Error(`${path.relative(ROOT, input)} に公演がありません(「日時」「会場」の行が必要です)`);
console.log(`${path.relative(ROOT, input)}: ${events.length} 公演`);

await resolveVenues(events);

const legs = [];
for (let i = 0; i + 1 < events.length; i++) {
  const [a, b] = [events[i], events[i + 1]];
  // 同じ会場での連戦は移動なし
  if (a.lat === b.lat && a.lng === b.lng) {
    legs.push({ from: i, to: i + 1, distance: 0, duration: 0, coordinates: [] });
    continue;
  }
  const leg = await route(a, b);
  legs.push({ from: i, to: i + 1, ...leg });
  const note = leg.ferry ? ` ※フェリー ${(leg.ferry / 1000).toFixed(0)}km を含む` : '';
  console.log(
    `  ${String(i + 1).padStart(2)} → ${String(i + 2).padStart(2)}  ${(leg.distance / 1000).toFixed(0).padStart(5)} km  ${(leg.duration / 3600).toFixed(1).padStart(5)} h  ${a.name} → ${b.name}${note}`,
  );
}

const stops = events.map(({ venue, ...e }) => e);
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify({ stops, legs })}\n`);

const total = legs.reduce((s, l) => s + l.distance, 0);
const points = legs.reduce((s, l) => s + l.coordinates.length, 0);
console.log(`合計 ${(total / 1000).toFixed(0)} km / 線の点 ${points} → ${path.relative(ROOT, OUT)}`);
