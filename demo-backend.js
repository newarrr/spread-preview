// «الفرق» — the preview's stand-in for the service (step 11, GitHub Pages). A static page has no MT5 and no service, so the page's
// price stream (/events) and its three questions (/api/at, /api/range, /api/series) are answered here, in the browser, with a random walk.
// NOTHING HERE IS A MARKET PRICE: the symbols are named NAS100.demo / US30.demo and a bar says so on every screen.
// The answers go through the same functions as the real service (lib/spread.mjs), so the page cannot tell the difference.
// (The build copies lib/spread.mjs beside this file and rewrites this one path.)
import { quote, parseStart, startAnswer, rangeAnswer, seriesAnswer } from './spread.mjs';

const STEP = 300, DAYS = 14, TFS = [5, 15, 30, 60, 240, 1440], MAX_POINTS = 1500;
const A0 = 26450, B0 = 49080;
const round2 = v => Math.round(v * 100) / 100;

// A small seeded generator (mulberry32): the history has the same shape for every visitor.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The made-up market: 14 days of 5-minute closes ending at the live start price, and a live price that keeps wandering.
export function createDemo({ nowMs = Date.now(), seed = 7 } = {}) {
  const rand = seeded(seed), last = Math.floor(nowMs / 1000 / STEP) * STEP, n = DAYS * 288;
  const t = [], a = [], b = [];
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += (rand() - .5) * 20; y += (rand() - .5) * 24; t.push(last - (n - 1 - i) * STEP); a.push(x); b.push(y); }
  const da = A0 - x, db = B0 - y;   // the history ends exactly on the live start price
  for (let i = 0; i < n; i++) { a[i] = round2(a[i] + da); b[i] = round2(b[i] + db); }
  const first = t[0];
  // The last candle at or before second s (-1 when s is before the first).
  const idxAt = s => { let lo = 0, hi = n - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= s) { r = m; lo = m + 1; } else hi = m - 1; } return r; };

  const at = s => {
    const i = idxAt(s);
    if (i < 0) return startAnswer({ error: 'before', first });
    const m = s - (s % 60);
    return startAnswer({ t: s, aTime: m, bTime: m, aPrice: a[i], bPrice: b[i], exact: true, first });
  };
  const range = s => {
    const i0 = Math.max(0, idxAt(s));
    let max = -Infinity, min = Infinity, maxTime = t[i0], minTime = t[i0];
    for (let i = i0; i < n; i++) { const d = a[i] - b[i]; if (d > max) { max = d; maxTime = t[i]; } if (d < min) { min = d; minTime = t[i]; } }
    return rangeAnswer({ from: s, to: last, max: round2(max), maxTime, min: round2(min), minTime, bars: n - i0, tf: 5, firstUsed: t[i0] });
  };
  const series = s => {
    const i0 = Math.max(0, idxAt(s)), tf = TFS.find(f => Math.ceil((n - i0) / (f / 5)) <= MAX_POINTS) ?? 1440, k = tf / 5, idx = [];
    for (let i = n - 1; i >= i0; i -= k) idx.push(i);
    idx.reverse();
    return seriesAnswer({ tf, t: idx.map(i => t[i]), a: idx.map(i => a[i]), b: idx.map(i => b[i]) });
  };

  // The live price: a message like the bridge's, run through the same quote() as the service.
  let aBid = A0, bBid = B0, seq = 0, messages = 0, received = nowMs;
  const message = () => { const now = Date.now(); return { a: 'NAS100.demo', b: 'US30.demo', aBid: round2(aBid), aAsk: round2(aBid + 1), bBid: round2(bBid), bAsk: round2(bBid + 2), aTime: now, bTime: now, serverMs: now, seq, ver: 140 }; };
  const snapshot = () => ({ ...quote(message(), received, Date.now(), true), source: 'bridge', canAsk: true, sentMs: Date.now(), messages });
  const step = () => { aBid += (Math.random() - .5) * 4; bBid += (Math.random() - .5) * 6; seq++; messages++; received = Date.now(); };
  return { at, range, series, snapshot, step, first, last };
}

// In a browser only (the tests import createDemo in Node): replace the service.
function install() {
  const demo = createDemo(), clients = new Set();
  const realFetch = window.fetch.bind(window);
  const reply = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href), m = /\/api\/(at|range|series)$/.exec(url.pathname);
    if (!m) return realFetch(input, init);
    const s = parseStart(url.searchParams.get('t'));
    return new Promise(done => setTimeout(() => done(reply(s === null ? { error: 'time' } : demo[m[1]](s))), 40));
  };
  window.EventSource = class {
    constructor() { this.onmessage = null; this.onerror = null; this.readyState = 1; clients.add(this); setTimeout(() => this._send(), 0); }
    _send() { this.onmessage?.({ data: JSON.stringify(demo.snapshot()) }); }
    close() { clients.delete(this); }
  };
  setInterval(() => { demo.step(); for (const c of clients) c._send(); }, 250);

  const bar = document.createElement('div');
  bar.id = 'demoBar'; bar.dir = 'rtl';
  bar.textContent = 'نسخة تجريبية · أرقام عشوائية وليست أسعار السوق · DEMO: random numbers, not market prices';
  Object.assign(bar.style, { position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '9999', padding: '3px 10px', font: '600 12px/1.5 "Segoe UI",system-ui,sans-serif', textAlign: 'center', color: '#1a1405', background: '#e6b94a' });
  // On a narrow screen the page scrolls: leave room under the bar so the last cards are not hidden by it.
  const room = document.createElement('style');
  room.textContent = '@media (max-width: 899px) { body { padding-bottom: 30px; } }';
  document.head.append(room);
  document.body.append(bar);
}
if (typeof window !== 'undefined') install();
