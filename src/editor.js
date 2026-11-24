// 「日程を変える」ダイアログ。貼り付けた日程表から、その場で tour ({ stops, legs }) を作る。
// コマンドの npm run build-tour と同じ変換(src/lib/)を、ブラウザの中で動かしている。
//
//   貼り付けた日程表 → 公演の一覧 → 会場ごとの住所(分からない会場は入力してもらう)
//   → 住所から位置(国土地理院) → 会場間の経路(OSRM) → 地図に表示して、このブラウザに保存
//
// 最初の表示には要らないので、ボタンが押されたときに読み込む(main.js の import('./editor.js'))。

import seedVenues from '../data/venues.json';
import defaultText from '../tours/tour.txt?raw';
import { h } from './dom.js';
import { buildLegs, fetchRoute, resolveVenues, routeKey, toLeg, toTour } from './lib/build-tour.mjs';
import { parseTour } from './lib/parse-tour.mjs';
import { clearTour, loadTour, loadVenues, saveTour, saveVenues } from './store.js';

const $ = (id) => document.getElementById(id);
const el = {
  dialog: $('editor'),
  close: $('editor-close'),
  text: $('editor-text'),
  parsed: $('editor-parsed'),
  venues: $('editor-venues'),
  progress: $('editor-progress'),
  download: $('editor-download'),
  reset: $('editor-reset'),
  build: $('editor-build'),
};

const hasPosition = (v) => typeof v?.lat === 'number' && typeof v?.lng === 'number';

let host = null; // main.js から渡される { getTour, onBuilt, onReset }
let events = []; // 貼り付けた日程表から読み取った公演
let parseError = '';
let runId = 0; // 計算の途中でダイアログを閉じたら、進めて結果を捨てる
let busy = false;

// 会場名 → 入力中の住所・位置。日程表を書き換えても、入れた住所は消さない。
//   { address, lat?, lng?, matched?, manual?, error?, badCoords?, base? }  base は辞書にあった元の値
const drafts = new Map();

function draftOf(name) {
  if (!drafts.has(name)) {
    const known = loadVenues()[name] ?? seedVenues[name];
    const base = known?.address ? { address: known.address, lat: known.lat, lng: known.lng, approx: known.approx } : null;
    drafts.set(name, base ? { ...base, base } : { address: '' });
  }
  return drafts.get(name);
}

const venueNames = () => [...new Set(events.map((e) => e.venue))];

function setProgress(text, isError = false) {
  el.progress.textContent = text;
  el.progress.classList.toggle('error', isError);
}

// ---- 会場の一覧 --------------------------------------------------------------

function statusOf(d) {
  if (d.error) return { text: d.error, cls: 'error' };
  if (hasPosition(d)) {
    const from = d.manual ? '手入力' : d.matched;
    return { text: `位置: ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}${from ? ` (${from})` : ''}`, cls: '' };
  }
  if (!d.address) return { text: '住所を入れてください', cls: 'need' };
  return { text: '位置は、計算するときに住所から調べます', cls: '' };
}

const rowOf = (name) => [...el.venues.children].find((row) => row.dataset.venue === name);

function updateStatus(name) {
  const row = rowOf(name);
  if (!row) return;
  const { text, cls } = statusOf(draftOf(name));
  const node = row.querySelector('.venue-status-text');
  node.textContent = text;
  node.className = `venue-status-text ${cls}`;
}

function renderVenues() {
  const rows = venueNames().map((name, i) => {
    const d = draftOf(name);
    const { text, cls } = statusOf(d);
    const id = `venue-${i}`;
    return h(
      'div',
      { class: 'venue', dataset: { venue: name } },
      h('label', { for: id }, name),
      h('input', { id, type: 'text', class: 'venue-address', value: d.address, placeholder: '住所(例: 東京都文京区後楽1-3-61)', autocomplete: 'off' }),
      h(
        'div',
        { class: 'venue-status' },
        h('span', { class: `venue-status-text ${cls}` }, text),
        h('button', { type: 'button', class: 'link venue-manual' }, '位置を手で入れる'),
      ),
      h('input', {
        type: 'text',
        class: 'venue-coords',
        value: d.manual ? `${d.lat}, ${d.lng}` : '',
        placeholder: '緯度, 経度(例: 35.7056, 139.7519)',
        'aria-label': `${name} の緯度, 経度`,
        autocomplete: 'off',
        hidden: !d.manual,
      }),
    );
  });
  el.venues.replaceChildren(...rows);
}

function parse() {
  const text = el.text.value;
  try {
    events = parseTour(text);
    parseError = '';
  } catch (err) {
    events = [];
    parseError = err.message;
  }
  renderVenues();

  const names = venueNames();
  const need = names.filter((n) => !draftOf(n).address).length;
  el.parsed.classList.toggle('error', Boolean(parseError));
  if (parseError) el.parsed.textContent = parseError;
  else if (!text.trim()) el.parsed.textContent = '日程表を貼り付けてください。';
  else if (!events.length) el.parsed.textContent = '公演が見つかりません。「日時」「会場」という行と、その次の行に日時・会場名が必要です。';
  else el.parsed.textContent = `${events.length}公演・${names.length}会場を読み取りました。${need ? `住所の分からない会場が ${need} か所あります。` : ''}`;
  setProgress('');
}

/** 「35.7056, 139.7519」→ { lat, lng }。読めなければ null。 */
function parseCoords(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,、\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text.normalize('NFKC'));
  if (!m) return null;
  const [lat, lng] = [Number(m[1]), Number(m[2])];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** 住所から決まる位置に戻す。辞書の住所のままなら辞書の位置、変えていたら「あとで調べる」。 */
function useAddressPosition(d) {
  delete d.manual;
  delete d.matched;
  const same = d.base && d.base.address === d.address;
  d.lat = same ? d.base.lat : undefined;
  d.lng = same ? d.base.lng : undefined;
}

function onVenueInput(e) {
  const row = e.target.closest('.venue');
  if (!row) return;
  const name = row.dataset.venue;
  const d = draftOf(name);
  if (!d.badCoords) d.error = '';

  if (e.target.classList.contains('venue-address')) {
    d.address = e.target.value.trim();
    if (!d.manual) useAddressPosition(d);
  } else if (e.target.classList.contains('venue-coords')) {
    const text = e.target.value.trim();
    const pos = parseCoords(text);
    d.badCoords = Boolean(text) && !pos;
    d.error = d.badCoords ? '「緯度, 経度」の形で入れてください(例: 35.7056, 139.7519)' : '';
    if (pos) Object.assign(d, pos, { manual: true });
    else useAddressPosition(d);
  }
  updateStatus(name);
}

function onVenueClick(e) {
  if (!e.target.classList.contains('venue-manual')) return;
  const input = e.target.closest('.venue').querySelector('.venue-coords');
  input.hidden = false;
  input.focus();
}

// ---- 計算 ------------------------------------------------------------------

function setBusy(on) {
  busy = on;
  for (const node of el.dialog.querySelectorAll('textarea, input, .venue-manual, #editor-build, #editor-reset, #editor-download')) node.disabled = on;
}

function focusVenue(name, selector = '.venue-address') {
  const input = rowOf(name)?.querySelector(selector);
  if (input) {
    input.hidden = false;
    input.focus();
  }
}

/** いま表示している日程の区間。会場の位置が同じ区間は、問い合わせずに使い回す。 */
function knownLegs() {
  const { stops, legs } = host.getTour();
  const known = new Map();
  for (const { from, to, ...leg } of legs) {
    if (leg.coordinates.length) known.set(routeKey(stops[from], stops[to]), leg);
  }
  return known;
}

/** 画面で入れた(辞書と違う)会場を、次に同じ会場が出てきたときのために覚えておく。 */
function rememberVenues(venues) {
  const mine = loadVenues();
  for (const [name, v] of Object.entries(venues)) {
    const seed = seedVenues[name];
    if (seed && seed.address === v.address && seed.lat === v.lat && seed.lng === v.lng) delete mine[name];
    else mine[name] = v;
  }
  saveVenues(mine);
}

async function build() {
  if (busy) return;
  if (parseError || !events.length) {
    setProgress(parseError || '公演がありません。日程表を貼り付けてください。', true);
    el.text.focus();
    return;
  }
  const names = venueNames();
  const bad = names.find((n) => draftOf(n).badCoords);
  if (bad) {
    setProgress(`緯度, 経度を読み取れない会場があります: ${bad}`, true);
    return focusVenue(bad, '.venue-coords');
  }
  // 前回の計算で出たエラーは消して、やり直す
  for (const n of names) {
    draftOf(n).error = '';
    updateStatus(n);
  }
  const empty = names.find((n) => !draftOf(n).address);
  if (empty) {
    setProgress(`住所の無い会場があります: ${empty}`, true);
    return focusVenue(empty);
  }

  const run = ++runId;
  const cancelled = () => run !== runId;
  setBusy(true);
  try {
    const text = el.text.value;
    const list = parseTour(text); // resolveVenues が書き換えるので、画面用の events とは別に作る
    const venues = Object.fromEntries(
      names.map((n) => {
        const d = draftOf(n);
        return [n, { address: d.address, ...(hasPosition(d) ? { lat: d.lat, lng: d.lng } : {}), ...(d.approx && d.base?.address === d.address ? { approx: true } : {}) }];
      }),
    );

    setProgress('会場の位置を調べています…');
    await resolveVenues(list, venues, (name, g) => {
      Object.assign(draftOf(name), { lat: g.lat, lng: g.lng, matched: g.matched });
      updateStatus(name);
    });
    if (cancelled()) return;

    const known = knownLegs();
    let done = 0;
    const legs = await buildLegs(
      list,
      async (a, b) => {
        if (cancelled()) throw new Error('中止しました');
        return known.get(routeKey(a, b)) ?? toLeg(await fetchRoute(a, b));
      },
      () => setProgress(`経路を計算しています… ${++done} / ${list.length - 1}`),
    );
    if (cancelled()) return;

    const tour = toTour(list, legs);
    rememberVenues(venues);
    const saved = saveTour(text, tour);
    el.dialog.close();
    host.onBuilt(tour, { saved });
  } catch (err) {
    if (cancelled()) return;
    console.error(err);
    setBusy(false);
    setProgress(err.message, true);
    if (err.venue) {
      draftOf(err.venue).error = '住所から位置を引けませんでした。住所を見直すか、位置を手で入れてください。';
      updateStatus(err.venue);
      focusVenue(err.venue);
    }
  }
}

function download() {
  const blob = new Blob([`${JSON.stringify(host.getTour())}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: 'tour.json' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function reset() {
  clearTour();
  el.text.value = defaultText;
  el.dialog.close();
  host.onReset();
}

// ---- 開く ------------------------------------------------------------------

el.text.addEventListener('input', parse);
el.venues.addEventListener('input', onVenueInput);
el.venues.addEventListener('click', onVenueClick);
el.build.addEventListener('click', build);
el.download.addEventListener('click', download);
el.reset.addEventListener('click', reset);
el.close.addEventListener('click', () => el.dialog.close());
el.dialog.addEventListener('close', () => {
  // 計算の途中で閉じたら、結果は使わない
  runId++;
  setBusy(false);
});

export function openEditor(next) {
  host = next;
  const saved = loadTour();
  // 開き直したときは、書きかけの内容を残す
  if (!el.text.value) el.text.value = saved?.text ?? defaultText;
  el.reset.hidden = !saved;
  parse();
  el.dialog.showModal();
}
