// 公演の一覧(parse-tour.mjs の結果)と会場の住所から、画面が読む tour ({ stops, legs }) を作る。
// コマンド(scripts/build-tour.mjs)と画面(src/editor.js)の両方から使うので、ファイルにも DOM にも触らない。

export const OSRM_URL = 'https://router.project-osrm.org';
const GSI_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
// 経路の線を間引くときの許容誤差(度)。0.0003 度 ≒ 30m
const SIMPLIFY = 0.0003;
// 公開サーバーへ続けて問い合わせるときに空ける間隔(ミリ秒)
const ROUTE_INTERVAL = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 1e5) / 1e5;

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      // 経路が無いときなど、OSRM は 400 番台でも理由を JSON で返すので、それは呼び出し側で見る
      if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${new URL(url).host} から取得できません: ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
}

// ---- 会場 ------------------------------------------------------------------

const hasPosition = (v) => typeof v?.lat === 'number' && typeof v?.lng === 'number';

/** 住所 → 座標(国土地理院の住所検索)。見つからなければ null。 */
export async function geocode(address) {
  const list = await getJson(`${GSI_URL}?q=${encodeURIComponent(address)}`);
  const hit = list[0];
  if (!hit) return null;
  const [lng, lat] = hit.geometry.coordinates;
  return { lat, lng, matched: hit.properties.title };
}

/** 公演に出てくる会場のうち、会場辞書に住所が無いもの(出てきた順、重複なし)。 */
export function missingVenues(events, venues) {
  return [...new Set(events.map((e) => e.venue))].filter((name) => !venues[name]?.address);
}

/**
 * 公演に会場辞書の住所・座標を付ける(events を書き換える)。
 * 座標の無い会場は住所から引いて venues に書き足し、その会場名の一覧を返す。
 * 住所から引けなかったときは、err.venue に会場名を入れて投げる。
 */
export async function resolveVenues(events, venues, onGeocode) {
  const geocoded = [];
  for (const e of events) {
    const v = venues[e.venue];
    if (!v?.address) throw Object.assign(new Error(`会場の住所がありません: ${e.venue}`), { venue: e.venue });
    if (!hasPosition(v)) {
      const g = await geocode(v.address);
      if (!g) throw Object.assign(new Error(`住所から位置を引けません: ${e.venue} (${v.address})`), { venue: e.venue });
      Object.assign(v, { lat: g.lat, lng: g.lng });
      geocoded.push(e.venue);
      onGeocode?.(e.venue, g);
    }
    Object.assign(e, { address: v.address, lat: v.lat, lng: v.lng });
    if (v.approx) e.approx = true;
  }
  return geocoded;
}

// ---- 経路 ------------------------------------------------------------------

/** Douglas-Peucker で線を間引く。 */
export function simplify(points, tolerance) {
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

/** 2 地点の組を表すキー。同じ組の経路を使い回すときの目印にする。 */
export const routeKey = (from, to) => `${from.lng},${from.lat};${to.lng},${to.lat}`;

let lastRouteAt = 0;

/** 2 会場間の車の経路を OSRM に問い合わせ、応答をそのまま返す。続けて呼ぶと、間隔を空けて待つ。 */
export async function fetchRoute(from, to, base = OSRM_URL) {
  const wait = lastRouteAt + ROUTE_INTERVAL - Date.now();
  if (wait > 0) await sleep(wait);
  const data = await getJson(`${base}/route/v1/driving/${routeKey(from, to)}?overview=full&geometries=geojson&steps=true`);
  lastRouteAt = Date.now();
  if (data.code !== 'Ok') {
    const why = data.code === 'NoRoute' ? '車で行ける道がつながっていません' : `${data.code} ${data.message ?? ''}`.trim();
    throw new Error(`経路を取得できません (${from.venue} → ${to.venue}): ${why}`);
  }
  return data;
}

/** OSRM の応答 → tour.json の 1 区間(距離・時間・間引いた線)。 */
export function toLeg(data) {
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

/**
 * 隣り合う公演を順につないで、区間の一覧を作る。
 * getRoute(a, b) は 1 区間ぶん({ distance, duration, ferry?, coordinates })を返す関数。
 * onLeg(leg, a, b) は 1 区間できるたびに呼ばれる。
 */
export async function buildLegs(events, getRoute, onLeg) {
  const legs = [];
  for (let i = 0; i + 1 < events.length; i++) {
    const [a, b] = [events[i], events[i + 1]];
    // 同じ会場での連戦は移動なし
    const same = a.lat === b.lat && a.lng === b.lng;
    const leg = { from: i, to: i + 1, ...(same ? { distance: 0, duration: 0, coordinates: [] } : await getRoute(a, b)) };
    legs.push(leg);
    onLeg?.(leg, a, b);
  }
  return legs;
}

/** 画面が読む形にまとめる(会場辞書のキーだった venue は落とす)。 */
export function toTour(events, legs) {
  return { stops: events.map(({ venue, ...e }) => e), legs };
}
