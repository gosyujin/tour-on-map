// Google マップの経路リンクを作る(Maps URLs: https://developers.google.com/maps/documentation/urls/get-started)。
// 経由地は 1 本のリンクにつき 9 か所までなので、会場が多いときは複数のリンクに分ける。

const MAX_WAYPOINTS = 9;

// 名前だけだと同名の別施設に飛ぶことがあるので、住所を前に付ける
const place = (s) => `${s.address} ${s.name}`;

export function directionsUrl(stops) {
  const params = new URLSearchParams({
    api: '1',
    origin: place(stops[0]),
    destination: place(stops.at(-1)),
    travelmode: 'driving',
  });
  if (stops.length > 2) params.set('waypoints', stops.slice(1, -1).map(place).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

/**
 * 全会場を順につなぐリンク。[{ from, to, url }] (from / to は 0 始まりの会場番号)。
 * 分けるときは、前のリンクの終点を次のリンクの起点にする。
 */
export function tourUrls(stops) {
  const out = [];
  const step = MAX_WAYPOINTS + 1;
  for (let i = 0; i < stops.length - 1; i += step) {
    const to = Math.min(i + step, stops.length - 1);
    out.push({ from: i, to, url: directionsUrl(stops.slice(i, to + 1)) });
  }
  return out;
}
