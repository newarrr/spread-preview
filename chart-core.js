// Pure calculations of the chart panel (step 5, ARCHITECTURE.md section 17), shared by the page (panel.js) and the tests.
// Times are the broker's clock in seconds (MQL5's datetime: the broker's clock counted as if it were UTC).

// The sessions in the broker's clock (minutes of the day), as on the old dashboard's strip; the rest is «outside the sessions».
export const SESSIONS = [
  { key: 'asia', label: 'آسيا', from: 2 * 60, to: 10 * 60, color: '#d4a017' },
  { key: 'europe', label: 'أوروبا', from: 10 * 60, to: 16 * 60 + 30, color: '#4a7fd6' },
  { key: 'america', label: 'أمريكا', from: 16 * 60 + 30, to: 23 * 60, color: '#d65a8a' },
];
export const OFF = { key: 'off', label: 'خارج الجلسات', color: '#5b6878' };
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const sessionHours = s => s.key === 'off' ? '' : `${hhmm(s.from)}–${hhmm(s.to)}`;
export function sessionOf(t) {
  const m = Math.floor((((t % 86400) + 86400) % 86400) / 60);
  return SESSIONS.find(s => m >= s.from && m < s.to) || OFF;
}

// The three lines as the change since the start: Nasdaq = wA × its change, Dow = wB × its change, spread = the difference.
// base {a, b}: the prices to measure from (the start's own prices, so the chart's last spread equals the card's «since the start»);
// without it, the first point.
export function lines({ t, a, b }, wA = 1, wB = 1, base = null) {
  const n = t.length, nas = new Array(n), dow = new Array(n), spread = new Array(n);
  const a0 = Number.isFinite(base?.a) ? base.a : a[0], b0 = Number.isFinite(base?.b) ? base.b : b[0];
  for (let i = 0; i < n; i++) { nas[i] = wA * (a[i] - a0); dow[i] = wB * (b[i] - b0); spread[i] = nas[i] - dow[i]; }
  return { t, nas, dow, spread };
}

// The period's numbers on the weighted spread's change since the start (0 = the start itself, which the values are measured from):
// range (highest − lowest, the start included), change (now − the start = the last value), mean, share of points above 0.
// (0.6.1: the change was last − FIRST CANDLE, so with a start price the panel said −72.1 while the card said −87.3.)
export function periodStats(values) {
  const n = values.length;
  if (!n) return null;
  let max = 0, min = 0, sum = 0, above = 0;
  for (const v of values) { if (v > max) max = v; if (v < min) min = v; sum += v; if (v > 0) above++; }
  return { range: max - min, change: values[n - 1], mean: sum / n, above: above / n, max, min };
}

// Which session moved the spread: every step between two points is counted in the session of the later point's candle; a session's
// «times» are its separate runs (a new run when the session changes, or after a pause over 6 hours). Per session: the sum of its steps
// (the four sums add up to the period's change), the number of runs, and the average size of a run's move (mean of |run total|).
// 0.9.2: and per session its OWN line from zero: only that session's steps added up (0 = where the session began), so its highest
// (never under 0), lowest (never over 0) and mean sit around its sum, which is the line's last value. (0.9.1 measured the spread «1»
// itself in the session's hours; the user: «مو صحيح» — America at −483.4 showed a highest of −112.5.)
export function sessionMoves(t, values) {
  const all = [...SESSIONS, OFF], acc = new Map(all.map(s => [s.key, { ...s, sum: 0, runs: 0, moveSum: 0, hi: 0, lo: 0, vSum: 0, n: 0 }]));
  let runKey = null, runTotal = 0;
  const close = () => { if (runKey) { const s = acc.get(runKey); s.runs++; s.moveSum += Math.abs(runTotal); } runKey = null; runTotal = 0; };
  // The step from the start itself (0) to the first candle counts too, so the four sums add up to the period's change exactly.
  for (let i = values[0] ? 0 : 1; i < t.length; i++) {
    const key = sessionOf(t[i]).key, step = values[i] - (i ? values[i - 1] : 0);
    if (key !== runKey || (i && t[i] - t[i - 1] > 6 * 3600)) close();
    runKey = key; runTotal += step;
    const s = acc.get(key); s.sum += step;
    if (s.sum > s.hi) s.hi = s.sum; if (s.sum < s.lo) s.lo = s.sum; s.vSum += s.sum; s.n++;
  }
  close();
  return all.map(s => { const r = acc.get(s.key); return { key: s.key, label: s.label, color: s.color, hours: sessionHours(s), sum: r.sum, count: r.runs, avg: r.runs ? r.moveSum / r.runs : 0, hi: r.n ? r.hi : null, lo: r.n ? r.lo : null, mean: r.n ? r.vSum / r.n : null }; });
}

// «بطاقة 1» (step 6, ARCHITECTURE.md section 18): the spread «1» — from zero at the start — out of the absolute spreads.
// start {spread, t}: the spread at the start; ext {max:{v,t}, min:{v,t}}: the highest and lowest absolute spread since the start;
// series {t, a, b}: both symbols' closes since the start. The start itself (0) counts, so the highest is never under 0 and the lowest
// never over 0; the mean is over the candles' closes (the level the spread «1» held on average, not the middle of highest and lowest).
export function cardOne(start, ext, series) {
  const out = { max: null, min: null, mean: null, n: 0 };
  if (!start || !Number.isFinite(start.spread)) return out;
  if (ext?.max && ext?.min) {
    const hi = ext.max.v - start.spread, lo = ext.min.v - start.spread;
    out.max = hi > 0 ? { v: hi, t: ext.max.t } : { v: 0, t: start.t };
    out.min = lo < 0 ? { v: lo, t: ext.min.t } : { v: 0, t: start.t };
  }
  const n = series?.t?.length || 0;
  if (n) { let sum = 0; for (let i = 0; i < n; i++) sum += series.a[i] - series.b[i]; out.mean = sum / n - start.spread; out.n = n; }
  return out;
}

// «الشراء والبيع» (step 8, ARCHITECTURE.md section 20): the spread you enter at now, for each kind of trade, from the live prices.
// «زيادة» (gains if the spread rises): buy Nasdaq at its Ask, sell Dow at its Bid. «نقصان» (gains if it falls): sell Nasdaq at its Bid,
// buy Dow at its Ask. The cost is the gap between the two = both symbols' spreads. Null when a price is missing (an older service).
export function entryPrices(r) {
  const ok = r && [r.aBid, r.aAsk, r.bBid, r.bAsk].every(v => Number.isFinite(v) && v > 0);
  if (!ok) return null;
  const up = r.aAsk - r.bBid, down = r.aBid - r.bAsk;
  return { up, down, cost: up - down };
}

// Tags on the chart's axis (0.9.5): sorted by height and pushed apart so none overlap (h tall, 2 apart), kept between top and bottom.
export function placeTags(tags, top, bottom, h = 18) {
  const out = tags.map(g => ({ ...g })).sort((p, q) => p.y - q.y), push = () => { for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < h + 2) out[i].y = out[i - 1].y + h + 2; };
  push();
  const over = out.length ? out[out.length - 1].y - (bottom - h / 2) : 0;
  if (over > 0) for (const g of out) g.y -= over;
  if (out.length && out[0].y < top + h / 2) { out[0].y = top + h / 2; push(); }
  return out;
}

// «الجرس» (step 9, ARCHITECTURE.md section 21): the waiting bells whose spread («1» or «2», by kind) reached their level from either
// side between the price before and now. now / before: { 1: value or null, 2: value or null }.
export function bellsCrossed(bells, now, before) {
  return bells.filter(b => {
    const v = now?.[b.kind], p = before?.[b.kind];
    return b.armed && Number.isFinite(b.level) && Number.isFinite(v) && Number.isFinite(p) && ((p < b.level && v >= b.level) || (p > b.level && v <= b.level));
  });
}

// A live price into the history: it updates the last candle when it falls in it, or starts a new candle (time = the candle's start).
// tf in minutes; tSec in the broker's clock. Returns true when something changed.
export function appendPrice(series, tf, tSec, a, b) {
  if (!series || !Number.isFinite(tSec) || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  const size = tf * 60, start = tSec - (((tSec % size) + size) % size), last = series.t.length - 1;
  if (last >= 0 && start < series.t[last]) return false;
  if (last >= 0 && start === series.t[last]) { series.a[last] = a; series.b[last] = b; return true; }
  series.t.push(start); series.a.push(a); series.b.push(b);
  return true;
}

// The axis: «nice» steps for the vertical scale, and the indices where a new day starts (for the day labels under the chart).
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) { const v = Number.isFinite(min) ? min : 0; return [v]; }
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw);
  const ticks = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v / step) * step || 0);   // || 0: never «−0»
  return ticks;
}
export function dayStarts(t, most = 6) {
  const idx = []; for (let i = 0; i < t.length; i++) if (i === 0 || Math.floor(t[i] / 86400) !== Math.floor(t[i - 1] / 86400)) idx.push(i);
  if (idx.length <= most) return idx;
  const every = Math.ceil(idx.length / most); return idx.filter((_, k) => k % every === 0);
}
