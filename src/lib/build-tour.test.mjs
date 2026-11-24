import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLegs, missingVenues, resolveVenues, routeKey, simplify, toLeg, toTour } from './build-tour.mjs';

const A = { venue: '東京・A', name: 'A', lat: 35.1, lng: 139.1 };
const B = { venue: '大阪・B', name: 'B', lat: 34.7, lng: 135.5 };

test('missingVenues: 住所の無い会場を、出てきた順に重複なく返す', () => {
  const events = [{ venue: 'x' }, { venue: 'y' }, { venue: 'x' }, { venue: 'z' }];
  assert.deepEqual(missingVenues(events, { y: { address: '東京都' }, z: { address: '' } }), ['x', 'z']);
});

test('resolveVenues: 座標のある会場は、問い合わせずに住所・座標を付ける', async () => {
  const events = [{ venue: '東京・A' }];
  const venues = { '東京・A': { address: '東京都千代田区', lat: 35.1, lng: 139.1, approx: true, note: '覚え書き' } };
  assert.deepEqual(await resolveVenues(events, venues), []);
  assert.deepEqual(events[0], { venue: '東京・A', address: '東京都千代田区', lat: 35.1, lng: 139.1, approx: true });
});

test('resolveVenues: 住所の無い会場は、会場名を付けて投げる', async () => {
  await assert.rejects(resolveVenues([{ venue: '東京・A' }], {}), (err) => err.venue === '東京・A');
});

test('simplify: 直線上の点は落とし、外れた点は残す', () => {
  const line = [[0, 0], [1, 0.00001], [2, 0], [3, 1], [4, 0]];
  assert.deepEqual(simplify(line, 0.0003), [[0, 0], [2, 0], [3, 1], [4, 0]]);
});

test('toLeg: 距離・時間を丸め、フェリーの区間を合計する', () => {
  const data = {
    routes: [
      {
        distance: 1234.56,
        duration: 99.4,
        geometry: { coordinates: [[139.123456789, 35.1], [139.2, 35.2]] },
        legs: [{ steps: [{ mode: 'driving', distance: 1000 }, { mode: 'ferry', distance: 200.4 }, { mode: 'ferry', distance: 34 }] }],
      },
    ],
  };
  assert.deepEqual(toLeg(data), { distance: 1235, duration: 99, ferry: 234, coordinates: [[139.12346, 35.1], [139.2, 35.2]] });
  data.routes[0].legs[0].steps = [{ mode: 'driving', distance: 1000 }];
  assert.equal('ferry' in toLeg(data), false);
});

test('buildLegs: 同じ会場の連戦は経路を引かず、ほかは順につなぐ', async () => {
  const asked = [];
  const getRoute = async (a, b) => {
    asked.push(routeKey(a, b));
    return { distance: 500_000, duration: 20_000, coordinates: [[a.lng, a.lat], [b.lng, b.lat]] };
  };
  const legs = await buildLegs([A, { ...A }, B], getRoute);
  assert.deepEqual(asked, ['139.1,35.1;135.5,34.7']);
  assert.deepEqual(legs[0], { from: 0, to: 1, distance: 0, duration: 0, coordinates: [] });
  assert.equal(legs[1].from, 1);
  assert.equal(legs[1].distance, 500_000);
});

test('toTour: 会場辞書のキー(venue)は出力に入れない', () => {
  assert.deepEqual(toTour([A], []), { stops: [{ name: 'A', lat: 35.1, lng: 139.1 }], legs: [] });
});
