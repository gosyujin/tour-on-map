// 画面で作った日程を、このブラウザ(localStorage)に覚えておく。
// プライベートブラウズなどで使えないこともあるので、読み書きの失敗は握りつぶして「保存なし」として動かす。

const TOUR_KEY = 'tour-on-map:tour'; // { text: 貼り付けた日程表, tour: { stops, legs } }
const VENUES_KEY = 'tour-on-map:venues'; // 画面で入れた会場の住所・座標(data/venues.json と同じ形)

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** 画面で作った日程。無ければ(または壊れていれば)null。 */
export function loadTour() {
  const saved = read(TOUR_KEY);
  const ok = typeof saved?.text === 'string' && Array.isArray(saved.tour?.stops) && saved.tour.stops.length && Array.isArray(saved.tour.legs);
  return ok ? saved : null;
}

/** 保存できたら true。 */
export const saveTour = (text, tour) => write(TOUR_KEY, { text, tour });

export function clearTour() {
  try {
    localStorage.removeItem(TOUR_KEY);
  } catch {
    // 使えない環境では、もともと保存されていない
  }
}

export const loadVenues = () => read(VENUES_KEY) ?? {};
export const saveVenues = (venues) => write(VENUES_KEY, venues);
