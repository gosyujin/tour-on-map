import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeVenue, parseTour, splitVenue } from './parse-tour.mjs';

const SAMPLE = `
日時
2026年12月02日 (水) 17:30開場18:30開始
会場
静岡・ツインメッセ静岡　北館

* [対戦カード](https://example.com/card/2)
* 先行予約（受付終了）
* [チケット](https://example.com/2)

日時
2026年11月25日 (水) 17:30開場18:30開始
会場
山形・INPEX酒田アリーナ
放送
[※試合前サイン会](https://example.com/sign)

* [対戦カード](https://example.com/card/1)
* [チケット](https://example.com/1)

日時
2026年12月11日 (金) 17:30開場18:30開始
会場
鹿児島・Fアリーナいちき串木野（いちき串木野市総合体育館）
`;

test('日時・会場・リンクを取り出し、日時順に並べる', () => {
  const ev = parseTour(SAMPLE);
  assert.equal(ev.length, 3);
  assert.deepEqual(ev[0], {
    links: { card: 'https://example.com/card/1', ticket: 'https://example.com/1' },
    date: '2026-11-25',
    weekday: '水',
    open: '17:30',
    start: '18:30',
    venue: '山形・INPEX酒田アリーナ',
    pref: '山形',
    name: 'INPEX酒田アリーナ',
  });
  assert.deepEqual(
    ev.map((e) => e.date),
    ['2026-11-25', '2026-12-02', '2026-12-11'],
  );
});

test('会場名の全角空白・全角括弧をそろえる', () => {
  const ev = parseTour(SAMPLE);
  assert.equal(ev[1].venue, '静岡・ツインメッセ静岡 北館');
  assert.equal(ev[1].name, 'ツインメッセ静岡 北館');
  assert.equal(ev[2].venue, '鹿児島・Fアリーナいちき串木野(いちき串木野市総合体育館)');
  assert.equal(normalizeVenue('  A　　B  '), 'A B');
});

test('都道府県の付かない会場名はそのまま', () => {
  assert.deepEqual(splitVenue('両国国技館'), { pref: '', name: '両国国技館' });
  assert.deepEqual(splitVenue('神奈川・横浜武道館'), { pref: '神奈川', name: '横浜武道館' });
  assert.deepEqual(splitVenue('青森・十和田市総合体育センター・サブアリーナ'), {
    pref: '青森',
    name: '十和田市総合体育センター・サブアリーナ',
  });
});

test('同じ日は開始時刻の順', () => {
  const ev = parseTour(`日時
2026年1月4日 (日) 17:00開始
会場
B
日時
2026年1月4日 (日) 11:00開始
会場
A`);
  assert.deepEqual(
    ev.map((e) => e.name),
    ['A', 'B'],
  );
});

test('読み取れない日時・会場の欠けはエラーにする', () => {
  assert.throws(() => parseTour('日時\n未定\n会場\nA'), /日時を読み取れません/);
  assert.throws(() => parseTour('日時\n2026年1月4日\n'), /会場がありません/);
});
