// 会場名(「山口・岩国市総合体育館」の pref と name)から、位置と住所を探す。
//
// 名前だけの検索は、同じような名前の別の施設に当たりやすい(「青森県武道館」で三沢市の武道館、など)。
// そこで、正確なものから順に試し、「名前が含まれている」「都道府県が合っている」ものだけを採る。
//
//   1. Wikipedia の同名の記事(転送も含む)の座標                … 正確
//   2. OpenStreetMap の検索(Nominatim)で、会場名そのもの       … 正確
//   3. 会場のある公園など、親にあたる施設の位置(Nominatim)      … 概略(approx)
//   4. 国土地理院の検索で当たった市町村・町名の位置              … 概略(approx)
//
// Nominatim の公開サーバーは「1 秒に 1 回まで」の決まりなので、制限のゆるい Wikipedia を先に試す。
// (Photon という別の検索も試したが、続けて問い合わせると接続ごと拒否されたので使っていない)
//
// 住所は、見つけた位置から「都道府県 + 市区町村 + 町名」まで組み立てる(番地は入らない)。
// 位置 → 市区町村コード・町名は国土地理院の逆ジオコーダで引き、コード → 名前は
// data/municipalities.json(呼び出し側から渡してもらう)で引く。

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
// Nominatim へ続けて問い合わせるときに空ける間隔(ミリ秒)。利用規約で 1 秒に 1 回まで
const NOMINATIM_INTERVAL = 1100;
// 応答を待つ上限(ミリ秒)。止まっている検索先で、いつまでも待たないようにする
const TIMEOUT = 10_000;
const WIKIPEDIA_URL = 'https://ja.wikipedia.org/w/api.php';
const GSI_SEARCH_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
const GSI_REVERSE_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
// 会場名から切り出した一部分で探すときの、最低の文字数(短いと別の施設に当たる)
const MIN_PART = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 取れなければ null。検索先が止まっていても、ほかの方法や手入力に進めるようにする。 */
async function tryJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// ---- 名前の扱い --------------------------------------------------------------

const clean = (s) => (s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
/** 比べるための形(空白・括弧・大文字小文字の違いを無視する)。 */
const key = (s) => clean(s).replace(/[\s()]/g, '').toLowerCase();

/**
 * 会場名から、検索に使う言い方を作る。
 *   exact: 会場そのものを指す名前(正式名、括弧の中の別名、「北館」などを除いた名前)
 *   near:  会場のある公園など(見つかっても位置は概略)。city があれば、その市区町村のものに限る
 */
export function nameVariants(name) {
  const full = clean(name);
  const inner = [...full.matchAll(/\(([^)]+)\)/g)].map((m) => clean(m[1]));
  const outer = clean(full.replace(/\([^)]*\)/g, ' '));
  // 「ツインメッセ静岡 北館」「十和田市総合体育センター・サブアリーナ」の、前の部分
  const head = outer.split(/[・ ]/)[0];
  const exact = [...new Set([full, outer, head, ...inner])].filter((v, i) => v && (i === 0 || v.length >= MIN_PART));

  const near = [];
  const park = /^(.+?公園)/.exec(outer)?.[1];
  if (park && !exact.includes(park)) {
    near.push({ q: park });
    // 「都城市早水公園」→ 都城市の「早水公園」
    const m = /^(.+?[市区町村])(.{2,}公園)$/.exec(park);
    if (m) near.push({ q: m[2], city: m[1] });
  }
  return { exact, near };
}

/**
 * Nominatim の検索結果から、探している施設にあたりそうなものを選ぶ(名前がぴったり同じものが先)。
 * 名前に探している言い方が含まれているものだけを残す。都道府県が合うかは、このあと位置から確かめる
 * (検索結果の住所の欄は、東京 23 区で都道府県が入っていないなど、場所によって形が違うため)。
 */
export function pickPlaces(results, variant) {
  const want = key(variant);
  const hits = (results ?? []).filter((r) => {
    if (!key(r.name).includes(want)) return false;
    // 施設そのものではなく、その名前の付いたバス停・駐車場などは外す
    if (r.category === 'highway' || r.category === 'railway') return false;
    return !['parking', 'bicycle_rental', 'bicycle_parking', 'bus_stop'].includes(r.type);
  });
  return [...hits.filter((r) => key(r.name) === want), ...hits.filter((r) => key(r.name) !== want)];
}

/**
 * 市区町村コード(「40132」)→ { pref: '福岡県', muni: '福岡市博多区' }。表に無ければ null。
 * table は data/municipalities.json の中身。
 */
export function municipalityOf(code, table) {
  const n = Number(code);
  const muni = table?.names?.[n];
  const pref = table?.prefs?.[Math.floor(n / 1000) - 1];
  return muni && pref ? { pref, muni } : null;
}

/** 都道府県 + 郡 + 市区町村 + 町名 → 住所。郡は、検索結果にあって「郡」で終わるときだけ入れる。 */
export function composeAddress({ pref, muni }, town = '', county = '') {
  const gun = clean(county).endsWith('郡') && !muni.startsWith(clean(county)) ? clean(county) : '';
  return `${pref}${gun}${muni}${clean(town)}`;
}

// ---- 検索先 ------------------------------------------------------------------

let lastNominatimAt = 0;

async function nominatimSearch(q) {
  const wait = lastNominatimAt + NOMINATIM_INTERVAL - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatimAt = Date.now();
  const url = `${NOMINATIM_URL}/search?q=${encodeURIComponent(q)}&format=jsonv2&countrycodes=jp&limit=5&addressdetails=1&accept-language=ja`;
  return (await tryJson(url)) ?? [];
}

/**
 * 位置 → 住所(国土地理院の逆ジオコーダ + 市区町村コード表)。
 * 引けないとき、都道府県(pref)・市区町村(city)が指定と合わないときは null。
 * 同じ名前の別の施設を採らないための確かめも兼ねる。
 */
async function addressAt(lat, lng, { pref, city, table, county }) {
  const res = (await tryJson(`${GSI_REVERSE_URL}?lat=${lat}&lon=${lng}`))?.results;
  const place = municipalityOf(res?.muniCd, table);
  if (!place || (pref && !place.pref.startsWith(pref)) || (city && !place.muni.includes(city))) return null;
  return composeAddress(place, res.lv01Nm, county);
}

async function fromNominatim(variant, { pref, city, table }) {
  // 同じ名前の施設がいくつかあっても、確かめるのは上から 3 つまで
  for (const hit of pickPlaces(await nominatimSearch(variant), variant).slice(0, 3)) {
    const [lat, lng] = [Number(hit.lat), Number(hit.lon)];
    const address = await addressAt(lat, lng, { pref, city, table, county: hit.address?.county });
    if (address) return { lat, lng, address, matched: clean(hit.name), via: 'OpenStreetMap' };
  }
  return null;
}

/** 同じ題名(または転送元)の Wikipedia の記事に座標があれば、それを使う。 */
async function fromWikipedia(variant, { pref, table }) {
  const data = await tryJson(`${WIKIPEDIA_URL}?action=query&titles=${encodeURIComponent(variant)}&redirects=1&prop=coordinates&format=json&origin=*`);
  await sleep(200); // 続けて問い合わせると断られることがあるので、少し空ける
  const page = Object.values(data?.query?.pages ?? {})[0];
  const at = page?.coordinates?.[0];
  if (!at) return null;
  const address = await addressAt(at.lat, at.lon, { pref, table });
  return address && { lat: at.lat, lng: at.lon, address, matched: page.title, via: 'Wikipedia' };
}

/** 会場名に含まれる市町村・町名の位置(国土地理院の検索)。都道府県が分からないときは使わない。 */
async function fromGsi(variant, pref) {
  if (!pref) return null;
  const list = (await tryJson(`${GSI_SEARCH_URL}?q=${encodeURIComponent(variant)}`)) ?? [];
  // 都道府県が合っていて、市区町村まで分かるものだけ(「愛知県体育館」で当たる「愛知県」だけ、は使わない)
  const hits = list.filter((x) => {
    const title = clean(x.properties?.title);
    return title.startsWith(pref) && /[市区町村]/.test(title.slice(pref.length));
  });
  if (!hits.length) return null;
  // いちばん細かい(長い)ものを採る
  const best = hits.reduce((a, b) => (b.properties.title.length > a.properties.title.length ? b : a));
  const [lng, lat] = best.geometry.coordinates;
  return { lat, lng, address: best.properties.title, matched: best.properties.title, via: '国土地理院' };
}

/**
 * 会場の位置と住所を探す。見つからなければ null。
 * table は data/municipalities.json の中身(市区町村コード → 名前)。
 * 戻り値: { address, lat, lng, approx, matched(当たったものの名前), via(検索先) }
 */
export async function findVenue({ pref = '', name }, table) {
  const { exact, near } = nameVariants(name);

  for (const v of exact) {
    const hit = await fromWikipedia(v, { pref, table });
    if (hit) return { ...hit, approx: false };
  }
  for (const v of exact) {
    const hit = await fromNominatim(v, { pref, table });
    if (hit) return { ...hit, approx: false };
  }
  for (const { q, city } of near) {
    const hit = await fromNominatim(q, { pref, city, table });
    if (hit) return { ...hit, approx: true };
  }
  for (const v of exact) {
    const hit = await fromGsi(v, pref);
    if (hit) return { ...hit, approx: true };
  }
  return null;
}
