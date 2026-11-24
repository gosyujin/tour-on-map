// 国土地理院の市区町村コード表から、data/municipalities.json を作り直す。
//
//   node scripts/update-municipalities.mjs
//
// 画面で会場名から住所を組み立てるとき、位置 → 市区町村コード(国土地理院の逆ジオコーダ)→ 名前、と引くのに使う。
// 市町村の合併などでコードが変わったときに動かす(めったに変わらない)。

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://maps.gsi.go.jp/js/muni.js';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/municipalities.json');

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
const text = await res.text();

// GSI.MUNI_ARRAY["40132"] = '40,福岡県,40132,福岡市　博多区';
const prefs = [];
const names = {};
for (const m of text.matchAll(/MUNI_ARRAY\["\d+"\]\s*=\s*'(\d+),([^,']+),(\d+),([^']+)'/g)) {
  const [, prefCode, pref, code, name] = m;
  prefs[Number(prefCode) - 1] = pref;
  names[Number(code)] = name.replace(/\s+/g, '');
}
if (prefs.filter(Boolean).length !== 47 || Object.keys(names).length < 1700) {
  throw new Error(`読み取れた数がおかしい(都道府県 ${prefs.filter(Boolean).length}、市区町村 ${Object.keys(names).length})。${SOURCE} の形が変わったかもしれません`);
}

// prefs[都道府県コード - 1] が都道府県名、names[市区町村コード] が市区町村名(都道府県コード = 市区町村コードの上 2 桁)
await writeFile(OUT, `${JSON.stringify({ source: SOURCE, prefs, names })}\n`);
console.log(`都道府県 ${prefs.length} / 市区町村 ${Object.keys(names).length} → ${path.relative(process.cwd(), OUT)}`);
