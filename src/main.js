import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre-gl 6 はワーカーを別ファイルから読むので、Vite が束ねたワーカーの URL を教える
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './style.css';
import { directionsUrl, tourUrls } from './gmaps.js';

const JAPAN = { center: [137.5, 37.5], zoom: 4.6 };
const ROUTE = '#d7263d';
const HIGHLIGHT = '#ff8a00';
const ARROW = '#8f0f22';

maplibregl.setWorkerUrl(workerUrl);

const map = new maplibregl.Map({
  container: 'map',
  center: JAPAN.center,
  zoom: JAPAN.zoom,
  minZoom: 3,
  maxZoom: 18,
  attributionControl: { compact: true },
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '地図・経路 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors / 経路計算 <a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a>',
      },
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
        // 経路の色が目立つように、背景地図の彩度を少し落とす
        paint: { 'raster-saturation': -0.55, 'raster-brightness-min': 0.12 },
      },
    ],
  },
});
// 'load' は背景地図のタイルが揃うまで待つので、経路はスタイルの準備ができた時点で描く
const styleReady = new Promise((resolve) => map.once('style.load', resolve));
if (import.meta.env.DEV) window.__map = map; // 開発時にコンソールから調べるため
const isTouch = window.matchMedia('(pointer: coarse)').matches;
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showZoom: !isTouch }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

const $ = (id) => document.getElementById(id);
const el = {
  status: $('status'),
  panel: $('panel'),
  toggle: $('panel-toggle'),
  title: $('summary-title'),
  sub: $('summary-sub'),
  stops: $('stops'),
  btnAll: $('btn-all'),
  gmapsAll: $('gmaps-all'),
  approxNote: $('approx-note'),
};
const isNarrow = () => window.matchMedia('(max-width: 720px)').matches;

// ---- 表示用の整形 -----------------------------------------------------------

const km = (m) => `${Math.round(m / 1000).toLocaleString('ja-JP')}km`;
function hours(sec) {
  const min = Math.round(sec / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const dateLabel = (s) => `${md(s.date)}${s.weekday ? `(${s.weekday})` : ''}`;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}
const ext = (href, text, cls) => h('a', { href, target: '_blank', rel: 'noopener', class: cls }, text);

// ---- 状態 ------------------------------------------------------------------

let tour = { stops: [], legs: [] };
const markers = []; // 会場の番号マーカー(会場番号順)
let selected = null; // { type: 'stop' | 'leg', index }
let popup = null;

function setStatus(text, ms) {
  el.status.textContent = text;
  el.status.hidden = !text;
  if (text && ms) setTimeout(() => el.status.textContent === text && setStatus(''), ms);
}

/** パネルに隠れない範囲に地図を合わせるための余白。 */
function padding() {
  const base = 56;
  if (isNarrow()) return { top: base, left: 36, right: 36, bottom: el.panel.offsetHeight + 24 };
  return { top: base, bottom: base, right: 64, left: el.panel.offsetWidth + 40 };
}

function bounds(points) {
  const b = new maplibregl.LngLatBounds();
  for (const p of points) b.extend(p);
  return b;
}

function fitAll() {
  if (!tour.stops.length) return;
  map.fitBounds(bounds(tour.stops.map((s) => [s.lng, s.lat])), { padding: padding(), maxZoom: 12, duration: 900 });
}

// ---- 選択 ------------------------------------------------------------------

function select(next, { fly = true, scroll = true } = {}) {
  selected = next;
  popup?.remove();
  popup = null;

  const legIndex = next?.type === 'leg' ? next.index : -1;
  if (map.getLayer('route-hl')) map.setFilter('route-hl', ['==', ['get', 'index'], legIndex]);

  for (const [i, m] of markers.entries()) {
    const on =
      (next?.type === 'stop' && next.index === i) ||
      (next?.type === 'leg' && (tour.legs[next.index].from === i || tour.legs[next.index].to === i));
    m.getElement().classList.toggle('on', on);
  }
  for (const node of el.stops.querySelectorAll('[data-type]')) {
    const on = next != null && node.dataset.type === next.type && Number(node.dataset.index) === next.index;
    node.classList.toggle('on', on);
    if (on && scroll) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  el.btnAll.disabled = next == null;
  if (!next) return;

  if (next.type === 'stop') {
    const s = tour.stops[next.index];
    popup = new maplibregl.Popup({ offset: 18, closeButton: false, maxWidth: '260px' })
      .setLngLat([s.lng, s.lat])
      .setDOMContent(stopPopup(s, next.index))
      .addTo(map);
    if (fly) map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 9.5), padding: padding(), duration: 1100 });
  } else if (fly) {
    const leg = tour.legs[next.index];
    const pts = leg.coordinates.length ? leg.coordinates : [leg.from, leg.to].map((i) => [tour.stops[i].lng, tour.stops[i].lat]);
    map.fitBounds(bounds(pts), { padding: padding(), maxZoom: 12, duration: 1100 });
  }
}

function stopPopup(s, i) {
  return h(
    'div',
    { class: 'popup' },
    h('strong', {}, `${i + 1}. ${s.name}`),
    h('span', {}, `${dateLabel(s)} ${[s.open && `${s.open}開場`, s.start && `${s.start}開始`].filter(Boolean).join(' ')}`),
    h('span', { class: 'muted' }, s.address),
  );
}

// ---- 一覧 ------------------------------------------------------------------

function renderList() {
  const { stops, legs } = tour;
  const now = today();
  const nextIndex = stops.findIndex((s) => s.date >= now);
  const items = [];

  for (const [i, s] of stops.entries()) {
    const time = [s.open && `${s.open}開場`, s.start && `${s.start}開始`].filter(Boolean).join(' / ');
    const links = [
      s.links?.card && ext(s.links.card, '対戦カード'),
      s.links?.ticket && ext(s.links.ticket, 'チケット'),
      ext(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.address} ${s.name}`)}`, '地図'),
    ].filter(Boolean);

    items.push(
      h(
        'li',
        { class: `stop${s.date < now ? ' past' : ''}`, dataset: { type: 'stop', index: i }, tabindex: 0, role: 'button' },
        h('span', { class: 'num' }, String(i + 1)),
        h(
          'div',
          { class: 'stop-body' },
          h(
            'div',
            { class: 'when' },
            h('b', {}, dateLabel(s)),
            time && h('span', {}, time),
            i === nextIndex && h('span', { class: 'tag' }, s.date === now ? '今日' : '次'),
          ),
          h('div', { class: 'name' }, s.pref && h('span', { class: 'pref' }, s.pref), s.name),
          h('div', { class: 'addr' }, s.address, s.approx && h('span', { class: 'approx' }, '位置は概略')),
          h('div', { class: 'links' }, ...links),
        ),
      ),
    );

    const leg = legs[i];
    if (!leg) continue;
    const gap = days(s.date, stops[leg.to].date);
    const moved = leg.distance > 0;
    items.push(
      h(
        'li',
        { class: `leg${stops[leg.to].date < now ? ' past' : ''}`, dataset: { type: 'leg', index: i }, tabindex: 0, role: 'button' },
        h('span', { class: 'arrow', 'aria-hidden': 'true' }, '↓'),
        h(
          'div',
          { class: 'leg-body' },
          moved
            ? h('span', {}, h('b', {}, km(leg.distance)), ` 約${hours(leg.duration)}`)
            : h('span', {}, '同じ会場(移動なし)'),
          gap > 1 && h('span', { class: 'muted' }, `中${gap - 1}日`),
          leg.ferry && h('span', { class: 'approx' }, `フェリー${km(leg.ferry)}を含む`),
          moved && ext(directionsUrl([s, stops[leg.to]]), 'Googleマップ', 'gmaps'),
        ),
      ),
    );
  }
  el.stops.replaceChildren(...items);

  // 概要
  const total = legs.reduce((sum, l) => sum + l.distance, 0);
  const totalTime = legs.reduce((sum, l) => sum + l.duration, 0);
  el.title.textContent = `${stops.length}会場 ${dateLabel(stops[0])} → ${dateLabel(stops.at(-1))}`;
  el.sub.textContent = `車で 約${km(total)}・約${hours(totalTime)}`;
  el.approxNote.hidden = !stops.some((s) => s.approx);

  // 全経路を Google マップで開くリンク(経由地の上限があるので、会場が多いと複数に分かれる)
  const urls = tourUrls(stops);
  el.gmapsAll.replaceChildren(
    h('span', { class: 'muted' }, 'Googleマップで全経路:'),
    ...urls.map((u) => ext(u.url, urls.length > 1 ? `${u.from + 1}→${u.to + 1}` : '開く', 'gmaps')),
  );
}

function onListAction(e) {
  if (e.target.closest('a')) return; // リンクはそのまま開く
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  const node = e.target.closest('[data-type]');
  if (!node) return;
  e.preventDefault();
  const next = { type: node.dataset.type, index: Number(node.dataset.index) };
  const same = selected && selected.type === next.type && selected.index === next.index;
  select(same ? null : next, { scroll: false });
  if (same) fitAll();
}
el.stops.addEventListener('click', onListAction);
el.stops.addEventListener('keydown', onListAction);
el.btnAll.addEventListener('click', () => {
  select(null);
  fitAll();
});
el.toggle.addEventListener('click', () => {
  const collapsed = el.panel.classList.toggle('collapsed');
  el.toggle.setAttribute('aria-expanded', String(!collapsed));
});

// ---- 地図 ------------------------------------------------------------------

/** 進行方向を示す矢印(線に沿って並べるアイコン)。フォントを使わないよう画像で描く。 */
function arrowImage() {
  const size = 40;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(10, 6);
  g.lineTo(32, 20);
  g.lineTo(10, 34);
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 5;
  g.strokeStyle = ARROW;
  g.stroke();
  g.fillStyle = '#fff';
  g.fill();
  return g.getImageData(0, 0, size, size);
}

function renderMap() {
  const { stops, legs } = tour;
  map.addImage('arrow', arrowImage(), { pixelRatio: 2 });
  map.addSource('route', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: legs
        .filter((l) => l.coordinates.length)
        .map((l) => ({ type: 'Feature', properties: { index: l.from }, geometry: { type: 'LineString', coordinates: l.coordinates } })),
    },
  });
  const line = { 'line-cap': 'round', 'line-join': 'round' };
  const width = (k) => ['interpolate', ['linear'], ['zoom'], 4, 2.2 * k, 9, 4 * k, 14, 7 * k];
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: line, paint: { 'line-color': '#fff', 'line-width': width(1.7), 'line-opacity': 0.9 } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', layout: line, paint: { 'line-color': ROUTE, 'line-width': width(1) } });
  map.addLayer({
    id: 'route-hl',
    type: 'line',
    source: 'route',
    layout: line,
    filter: ['==', ['get', 'index'], -1],
    paint: { 'line-color': HIGHLIGHT, 'line-width': width(1.5) },
  });
  map.addLayer({
    id: 'route-arrows',
    type: 'symbol',
    source: 'route',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 110,
      'icon-image': 'arrow',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 9, 0.8, 14, 1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  // 線は細いので、当たり判定用に太い透明の線を重ねる
  map.addLayer({ id: 'route-hit', type: 'line', source: 'route', layout: line, paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } });

  map.on('click', 'route-hit', (e) => {
    // 往復で重なる区間は、いま選んでいる区間の次の候補へ順に切り替える
    const hits = [...new Set(e.features.map((f) => f.properties.index))].sort((a, b) => a - b);
    const cur = selected?.type === 'leg' ? hits.indexOf(selected.index) : -1;
    select({ type: 'leg', index: hits[(cur + 1) % hits.length] }, { fly: false });
    e.originalEvent.handled = true;
  });
  map.on('mouseenter', 'route-hit', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'route-hit', () => (map.getCanvas().style.cursor = ''));
  map.on('click', (e) => {
    if (!e.originalEvent.handled && selected) select(null);
  });

  // 同じ会場に 2 回来るときは、番号を「3・7」のようにまとめて 1 つのマーカーにする
  const byPlace = new Map();
  for (const [i, s] of stops.entries()) {
    const key = `${s.lng},${s.lat}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), i]);
  }
  for (const [i, s] of stops.entries()) {
    const group = byPlace.get(`${s.lng},${s.lat}`);
    const node = h('button', { type: 'button', class: 'marker', title: `${dateLabel(s)} ${s.name}`, 'aria-label': `${i + 1}番目 ${s.name}` }, group.map((n) => n + 1).join('・'));
    if (group[0] !== i) node.hidden = true;
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      // まとめたマーカーは、押すたびに次の公演へ
      const at = selected?.type === 'stop' ? group.indexOf(selected.index) : -1;
      select({ type: 'stop', index: group[(at + 1) % group.length] }, { fly: false });
    });
    markers.push(new maplibregl.Marker({ element: node }).setLngLat([s.lng, s.lat]).addTo(map));
  }
}

// ---- 起動 ------------------------------------------------------------------

async function start() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/tour.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tour = await res.json();
    renderList();
    await styleReady;
    renderMap();
    select(null);
    fitAll();
    setStatus('');
  } catch (err) {
    console.error(err);
    el.title.textContent = '読み込めませんでした';
    setStatus('日程データを読み込めませんでした。再読み込みしてください。');
  }
}
start();
