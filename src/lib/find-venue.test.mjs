import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeAddress, municipalityOf, nameVariants, pickPlaces } from './find-venue.mjs';

/** Nominatim の検索結果 1 件ぶん。 */
const place = (name, extra = {}) => ({ name, lat: '0', lon: '0', ...extra });

test('nameVariants: 正式名のほかに、括弧の中の別名と、前の部分でも探す', () => {
  assert.deepEqual(nameVariants('Fアリーナいちき串木野(いちき串木野市総合体育館)').exact, [
    'Fアリーナいちき串木野(いちき串木野市総合体育館)',
    'Fアリーナいちき串木野',
    'いちき串木野市総合体育館',
  ]);
  assert.deepEqual(nameVariants('ツインメッセ静岡　北館').exact, ['ツインメッセ静岡 北館', 'ツインメッセ静岡']);
  assert.deepEqual(nameVariants('十和田市総合体育センター・サブアリーナ').exact, ['十和田市総合体育センター・サブアリーナ', '十和田市総合体育センター']);
});

test('nameVariants: 短すぎる一部分では探さない(別の施設に当たるため)', () => {
  assert.deepEqual(nameVariants('ポート・メッセなごや').exact, ['ポート・メッセなごや']);
  assert.deepEqual(nameVariants('東京ドーム').exact, ['東京ドーム']);
});

test('nameVariants: 公園の中の会場は、公園でも探す(位置は概略)', () => {
  assert.deepEqual(nameVariants('鬼北総合公園体育館').near, [{ q: '鬼北総合公園' }]);
  assert.deepEqual(nameVariants('都城市早水公園体育文化センター').near, [{ q: '都城市早水公園' }, { q: '早水公園', city: '都城市' }]);
  assert.deepEqual(nameVariants('岩手県営体育館').near, []);
});

test('pickPlaces: 名前に探している言い方が含まれていないものは採らない', () => {
  assert.deepEqual(pickPlaces([place('青森県会館'), place('青木武道館')], '青森県武道館'), []);
  // 「武道館」だけの施設(別の市のもの)も、名前が足りないので採らない
  assert.deepEqual(pickPlaces([place('武道館')], '青森県武道館'), []);
});

test('pickPlaces: 別名つきの名前でも当たり、ぴったり同じ名前を先にする', () => {
  assert.equal(pickPlaces([place('INPEX酒田アリーナ（国体記念体育館）')], 'INPEX酒田アリーナ').length, 1);
  const names = pickPlaces([place('ツインメッセ静岡 搬入口'), place('ツインメッセ静岡')], 'ツインメッセ静岡').map((r) => r.name);
  assert.deepEqual(names, ['ツインメッセ静岡', 'ツインメッセ静岡 搬入口']);
});

test('pickPlaces: バス停・駐車場は外す', () => {
  const results = [
    place('グランメッセ熊本前', { category: 'highway', type: 'bus_stop' }),
    place('グランメッセ熊本 駐車場', { category: 'amenity', type: 'parking' }),
  ];
  assert.deepEqual(pickPlaces(results, 'グランメッセ熊本'), []);
});

test('municipalityOf: 市区町村コードから、都道府県と市区町村を引く(先頭の 0 は無視)', () => {
  const table = { prefs: ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県'], names: { 1105: '札幌市豊平区', 6204: '酒田市' } };
  assert.deepEqual(municipalityOf('06204', table), { pref: '山形県', muni: '酒田市' });
  assert.deepEqual(municipalityOf('1105', table), { pref: '北海道', muni: '札幌市豊平区' });
  assert.equal(municipalityOf('99999', table), null);
  assert.equal(municipalityOf(undefined, table), null);
});

test('composeAddress: 町名をつなぎ、郡は「郡」で終わるものだけ入れる', () => {
  assert.equal(composeAddress({ pref: '福岡県', muni: '福岡市博多区' }, '東公園'), '福岡県福岡市博多区東公園');
  assert.equal(composeAddress({ pref: '熊本県', muni: '益城町' }, '大字福富', '上益城郡'), '熊本県上益城郡益城町大字福富');
  assert.equal(composeAddress({ pref: '北海道', muni: '札幌市豊平区' }, '豊平五条十一丁目', '石狩振興局'), '北海道札幌市豊平区豊平五条十一丁目');
  assert.equal(composeAddress({ pref: '山口県', muni: '岩国市' }), '山口県岩国市');
});
