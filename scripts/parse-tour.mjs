// 公式サイトの日程表を貼り付けたテキストから、公演(日時・会場・リンク)を取り出す。
//
//   日時
//   2026年11月25日 (水) 17:30開場18:30開始
//   会場
//   山形・INPEX酒田アリーナ
//   * [チケット](https://...)
//
// 「日時」の行で公演が始まり、次の「日時」までがその公演。日時順に並べて返す。

const DATE_RE =
  /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(?:[（(]\s*(.)\s*[）)])?\s*(?:(\d{1,2}:\d{2})\s*開場)?\s*(?:(\d{1,2}:\d{2})\s*開始)?/;
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const LINK_KEYS = { 対戦カード: 'card', チケット: 'ticket' };

const pad = (n) => String(n).padStart(2, '0');

/** 会場名のゆれ(全角空白・全角括弧・連続する空白)をそろえる。会場辞書のキーに使う。 */
export function normalizeVenue(s) {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** 「山形・INPEX酒田アリーナ」→ { pref: '山形', name: 'INPEX酒田アリーナ' }。「・」が無ければ pref は空。 */
export function splitVenue(venue) {
  const i = venue.indexOf('・');
  if (i <= 0 || i > 4) return { pref: '', name: venue };
  return { pref: venue.slice(0, i), name: venue.slice(i + 1) };
}

export function parseTour(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const events = [];
  let cur = null;
  let expect = null; // 次の空でない行が何か: 'date' | 'venue'

  for (const [idx, line] of lines.entries()) {
    if (line === '日時') {
      cur = { line: idx + 1, links: {} };
      events.push(cur);
      expect = 'date';
      continue;
    }
    if (!cur) continue;
    if (line === '会場') {
      expect = 'venue';
      continue;
    }
    if (!line) continue;

    if (expect === 'date') {
      const m = DATE_RE.exec(line);
      if (!m) throw new Error(`${idx + 1}行目: 日時を読み取れません: ${line}`);
      cur.date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
      cur.weekday = m[4] ?? '';
      cur.open = m[5] ?? '';
      cur.start = m[6] ?? '';
      expect = null;
      continue;
    }
    if (expect === 'venue') {
      cur.venue = normalizeVenue(line);
      Object.assign(cur, splitVenue(cur.venue));
      expect = null;
      continue;
    }
    for (const m of line.matchAll(LINK_RE)) {
      const key = LINK_KEYS[m[1]];
      if (key && !cur.links[key]) cur.links[key] = m[2];
    }
  }

  for (const e of events) {
    if (!e.date) throw new Error(`${e.line}行目から始まる公演に、日時がありません`);
    if (!e.venue) throw new Error(`${e.line}行目から始まる公演(${e.date})に、会場がありません`);
  }

  // 日時順。同じ日は開始時刻順(時刻が無いものは先)。元の順番は保つ。
  const key = (e) => `${e.date}T${(e.start || e.open || '00:00').padStart(5, '0')}`;
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => key(a.e).localeCompare(key(b.e)) || a.i - b.i)
    .map(({ e }) => {
      const { line, ...rest } = e;
      return rest;
    });
}
