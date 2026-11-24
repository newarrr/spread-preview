// The chart panel (step 5, ARCHITECTURE.md section 17; always shown since 0.8.0, decision 13 and section 19): weights (for the panel only, decision 12),
// the chart of the spread, Nasdaq and Dow as the change since the period's start (each line shown or hidden), the session strip,
// the period's numbers and which session moved the spread. History from MT5 (/api/series), then every price that arrives.
// Redrawn at most four times a second (the old dashboard froze from redrawing too often).
import { lines, periodStats, sessionMoves, appendPrice, niceTicks, dayStarts, sessionOf, placeTags } from './chart-core.js';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { spread: '#16e2cc', nas: '#ff6870', dow: '#3ccf7a' };
const NAMES = { spread: 'الفرق', nas: 'ناسداك', dow: 'داو' };
const KEYS = { weights: 'spread.weights.v1', lines: 'spread.lines.v1', kind: 'spread.kind.v1' };
// The chart is drawn at its frame's real size (0.8.0), so text and lines are never stretched; the right margin holds the axis labels
// and, since 0.9.3, the live price tags (wide enough for «49,102.5»).
const RIGHT = 84;
let W = 560, H = 230, X0 = 8, X1 = W - RIGHT, Y0 = 12, Y1 = H - 22;
function measure(svg) {
  const box = svg.getBoundingClientRect();
  W = Math.max(200, Math.round(box.width)); H = Math.max(120, Math.round(box.height));
  X0 = 8; X1 = W - RIGHT; Y0 = 12; Y1 = H - 22;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
}
// The stats' icons (the sprite in index.html) and their colours.
const STAT_ICONS = { range: ['i-range', 'muted'], change: ['i-trend', 'green'], mean: ['i-layers', 'muted'], above: ['i-percent', 'teal'] };
const icon = (id, cls = '') => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ic ' + cls); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = v => { const r = Math.round(v * 10) / 10; return (r > 0 ? '+' : r < 0 ? '−' : '') + format.format(Math.abs(r)); };
const minute = t => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const el = (tag, attrs = {}, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
const div = (cls, text) => { const n = document.createElement('div'); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// periodText(kind): the chosen «YYYY-MM-DDTHH:MM» or null for «the last 24 hours»: for «1» the start date (else date two), for «2»
// date two («الأعلى والأدنى من», as «بطاقة 2»; else the start) since 0.9.5.
// baseline(text): the start's own prices {a, b} when the period is the start date (so the chart's change equals the card's number), else null.
// extremes(): «بطاقة 2»'s highest and lowest {max:{v,t}, min:{v,t}, for}; startPrices(): the start's prices {a, b}, or null.
export function createPanel({ periodText, baseline = () => null, extremes = () => null, startPrices = () => null }) {
  const open = true;   // always shown (decision 13)
  let weights = read(KEYS.weights, { a: 1, b: 1 }), shown = read(KEYS.lines, { spread: true, nas: true, dow: true });
  // 0.9.4: which spread the chart draws, «1» (from zero at the start, with Nasdaq and Dow) or «2» (the spread as it is, alone).
  let kind = read(KEYS.kind, 1) === 2 ? 2 : 1;
  let series = null, tf = 1, forText = null, latest = null, timer = 0, frame = 0, lastDraw = 0, hoverIndex = null, asking = 0;

  // ── The controls ──
  $('wA').value = weights.a; $('wB').value = weights.b;
  for (const id of ['wA', 'wB']) $(id).addEventListener('input', () => {
    const a = Number($('wA').value), b = Number($('wB').value);
    if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0) { weights = { a, b }; save(KEYS.weights, weights); schedule(true); }
  });
  for (const button of $('legend').querySelectorAll('button[data-line]')) {
    const key = button.dataset.line;
    button.classList.toggle('off', !shown[key]); button.setAttribute('aria-pressed', String(!!shown[key]));
    button.addEventListener('click', () => { shown[key] = !shown[key]; save(KEYS.lines, shown); button.classList.toggle('off', !shown[key]); button.setAttribute('aria-pressed', String(shown[key])); schedule(true); });
  }

  function setKind(value) {
    kind = value; save(KEYS.kind, kind);
    $('panel').classList.toggle('k2', kind === 2);
    for (const b of $('kindPick').querySelectorAll('button[data-kind]')) { const on = Number(b.dataset.kind) === kind; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    if (series && wantedText() !== forText) { series = null; fetchSeries(); }   // «1» and «2» can have different periods (0.9.5)
    schedule(true);
  }
  for (const b of $('kindPick').querySelectorAll('button[data-kind]')) b.addEventListener('click', () => setKind(Number(b.dataset.kind)));
  setKind(kind);

  // ── The history ──
  function wantedText() {
    const chosen = periodText(kind); if (chosen) return chosen;
    if (!Number.isFinite(latest?.tickMs)) return null;
    return new Date(latest.tickMs - 86400 * 1000).toISOString().slice(0, 16);   // the last 24 hours, in the broker's clock
  }
  async function fetchSeries() {
    clearTimeout(timer);
    if (!open) return;
    const text = wantedText(); if (!text) { note('بانتظار أول سعر من MT5…'); return; }
    const ask = ++asking;
    try {
      const r = await (await fetch('/api/series?t=' + encodeURIComponent(text), { cache: 'no-store' })).json();
      if (ask !== asking) return;
      if (r.error) {
        note(r.error === 'bridge' ? 'الرسم يحتاج بوت SpreadBridge في MT5.'
          : r.error === 'timeout' && !(latest?.ver >= 140) ? 'الرسم يحتاج SpreadBridge 1.40: انسخ الملف الجديد إلى MQL5\\Experts، واضغط F7، ثم أعد سحبه إلى الشارت، وأعد START.bat.'
          : r.error === 'loading' ? 'MT5 يحمّل تاريخ تلك الفترة… يُعاد السؤال بعد قليل.' : 'لم يجب MT5 عن الرسم، يُعاد السؤال بعد قليل.');
        if (!series || forText !== text) series = null;
      } else { series = { t: r.t, a: r.a, b: r.b }; tf = r.tf; forText = text; note(''); }
    } catch { note('الخدمة لا تجيب.'); }
    schedule(true);
    timer = setTimeout(fetchSeries, series ? 5 * 60 * 1000 : 15 * 1000);   // again every 5 minutes to cover any gap; sooner after an error
  }
  function note(text) { const n = $('panelNote'); n.textContent = text; n.hidden = !text; }

  // ── Drawing, at most every 250 ms ──
  function schedule(now = false) {
    if (!open || frame) return;
    const wait = now ? 0 : Math.max(0, 250 - (performance.now() - lastDraw));
    frame = setTimeout(() => requestAnimationFrame(() => { frame = 0; lastDraw = performance.now(); draw(); }), wait);
  }
  function draw() {
    const svg = $('chart');
    measure(svg);
    if (!series || series.t.length < 2) { svg.replaceChildren(); $('stats').replaceChildren(); $('sessions').replaceChildren(); $('period').textContent = ''; return; }
    const L = lines(series, weights.a, weights.b, baseline(forText)), n = L.t.length;
    // What is drawn: «1» the three lines from zero; «2» the spread as it is (weighted Nasdaq − weighted Dow) alone, its dashed line
    // at the start's level. (Nasdaq at 26,000 and Dow at 49,000 cannot share an axis with a spread of −23,000.)
    // «2» (0.9.6): the spread as it is, and Nasdaq and Dow as their weighted change added to the spread's level at the period's start,
    // so the three lines leave one point as in «1», on the spread's real level.
    const abs = kind === 2 ? series.a.map((a, i) => weights.a * a - weights.b * series.b[i]) : null, s0 = abs ? abs[0] : 0;
    const P = kind === 2 ? { spread: abs, nas: series.a.map(a => s0 + weights.a * (a - series.a[0])), dow: series.b.map(b => s0 + weights.b * (b - series.b[0])) } : L;
    const keys = ['dow', 'nas', 'spread'].filter(k => shown[k]);
    // «2» with all its information (0.9.5): the spread now, the highest and lowest of «بطاقة 2» (its own numbers at 1:1, else the
    // drawn line's), and the start's level when there is a start.
    const sp = kind === 2 ? startPrices() : null, ex = kind === 2 ? extremes() : null, last = n - 1;
    const ref = kind === 2 ? (sp && Number.isFinite(sp.a) ? weights.a * sp.a - weights.b * sp.b : null) : 0;
    const exact = ex && ex.for === forText && weights.a === 1 && weights.b === 1;
    const levels = kind === 2 ? { now: P.spread[last], hi: exact ? ex.max.v : Math.max(...P.spread), lo: exact ? ex.min.v : Math.min(...P.spread) } : null;
    // The vertical scale fits the drawn lines and the levels (0 for «1»).
    let min = Infinity, max = -Infinity;
    for (const v of [ref, levels?.hi, levels?.lo]) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    for (const k of keys) for (const v of P[k]) { if (v < min) min = v; if (v > max) max = v; }
    const pad = (max - min) * 0.06 || 10; min -= pad; max += pad;
    const x = i => X0 + (X1 - X0) * (n === 1 ? 0 : i / (n - 1)), y = v => Y1 - (Y1 - Y0) * (v - min) / (max - min);
    const parts = [];
    // The session strip: one thin bar per run of the same session.
    for (let i = 0, s = 0; i <= n; i++) {
      if (i === n || (i > s && sessionOf(L.t[i]).key !== sessionOf(L.t[s]).key)) {
        const se = sessionOf(L.t[s]);
        parts.push(el('rect', { x: x(s), y: 0, width: Math.max(1, x(Math.min(i, n - 1)) - x(s)), height: 5, fill: se.color, opacity: se.key === 'off' ? 0.35 : 0.85 }));
        s = i;
      }
    }
    // The grid, its labels on the right, and the dashed line: zero for «1», the start's level for «2».
    for (const v of niceTicks(min, max, 4)) {
      parts.push(el('line', { x1: X0, x2: X1, y1: y(v), y2: y(v), class: kind === 1 && v === 0 ? 'zero' : 'grid' }));
      parts.push(el('text', { x: X1 + 6, y: y(v) + 4, class: 'axis' }, (kind === 1 && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US')));
    }
    if (kind === 2) {
      // The levels as horizontal lines: the highest and lowest, the start (dashed), and the price line at the spread now (dotted).
      const level = (v, cls, title) => { const z = el('line', { x1: X0, x2: X1, y1: y(v), y2: y(v), class: cls }); z.append(el('title', {}, title + ': ' + signed(v))); parts.push(z); };
      level(levels.hi, 'lvl hi', 'الأعلى'); level(levels.lo, 'lvl lo', 'الأدنى');
      if (Number.isFinite(ref)) level(ref, 'zero', 'الفرق عند البداية');
      level(levels.now, 'lvl now', 'الفرق الآن');
    }
    for (const i of dayStarts(L.t, 6)) parts.push(el('text', { x: x(i), y: H - 4, class: 'axis day', 'text-anchor': x(i) < X0 + 24 ? 'start' : x(i) > X1 - 24 ? 'end' : 'middle' }, minute(L.t[i]).slice(5, 10)));
    // Under the spread line a teal shade that fades downwards (from the picture of 0.8.0).
    if (keys.includes('spread')) {
      const defs = el('defs'), grad = el('linearGradient', { id: 'shade', x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.append(el('stop', { offset: '0', 'stop-color': COLORS.spread, 'stop-opacity': '0.22' }), el('stop', { offset: '1', 'stop-color': COLORS.spread, 'stop-opacity': '0' }));
      defs.append(grad); parts.unshift(defs);
      let d = ''; for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(P.spread[i]).toFixed(1);
      parts.push(el('path', { d: d + `L${x(n - 1).toFixed(1)} ${Y1}L${x(0).toFixed(1)} ${Y1}Z`, fill: 'url(#shade)', stroke: 'none' }));
    }
    // The lines, the spread last (on top), then the hover mark.
    for (const k of keys) {
      let d = ''; for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(P[k][i]).toFixed(1);
      parts.push(el('path', { d, fill: 'none', stroke: COLORS[k], 'stroke-width': k === 'spread' ? 2 : 1.4, 'stroke-linejoin': 'round' }));
    }
    if (keys.includes('spread')) parts.push(el('circle', { cx: x(last), cy: y(P.spread[last]), r: 9, fill: COLORS.spread, opacity: 0.18 }), el('circle', { cx: x(last), cy: y(P.spread[last]), r: 4.5, fill: COLORS.spread }));
    // 0.9.3 («سعر تظهر مباشر»): at the end of the Nasdaq and Dow lines, a tag in the line's colour on the axis with the symbol's price
    // now (Bid, the last candle's close, which every live price moves). Tags that would overlap are pushed apart, and kept inside.
    // The tags: Nasdaq's and Dow's price now at the end of their lines (both kinds); in «2» also the levels: the spread now (filled),
    // the highest, the lowest and the start (outlined).
    const TAG = 18, w = W - X1 - 6;
    const priceTags = [['nas', series.a[last]], ['dow', series.b[last]]].filter(([k, price]) => keys.includes(k) && Number.isFinite(price))
      .map(([k, price]) => ({ cls: k, name: `${NAMES[k]}: السعر الآن (Bid)`, text: format.format(price), y: y(P[k][last]), fill: COLORS[k] }));
    const levelTags = kind === 2
      ? [['now', levels.now, 'الفرق الآن'], ['hi', levels.hi, 'الأعلى'], ['lo', levels.lo, 'الأدنى'], ['start', ref, 'الفرق عند البداية']]
        .filter(([, v]) => Number.isFinite(v)).map(([cls, v, name]) => ({ cls, name, text: signed(v), y: y(v) }))
      : [];
    const tags = [...levelTags, ...priceTags];
    for (const g of placeTags(tags, Y0, Y1, TAG)) {
      const tag = el('g', { class: 'tag ' + g.cls });
      tag.append(el('title', {}, g.name), el('rect', { x: X1 + 4, y: g.y - TAG / 2, width: w, height: TAG, rx: 4, ...(g.fill ? { fill: g.fill } : {}) }),
        el('text', { x: X1 + 4 + w / 2, y: g.y + 4.5, 'text-anchor': 'middle' }, g.text));
      parts.push(tag);
    }
    if (hoverIndex !== null && hoverIndex < n) parts.push(el('line', { x1: x(hoverIndex), x2: x(hoverIndex), y1: Y0 - 4, y2: Y1, class: 'cross' }));
    svg.replaceChildren(...parts);
    // Under the pointer: «1» the three changes; «2» the spread as it is and both prices.
    drawTip(L, kind === 2 ? (k, i) => (k === 'spread' ? signed(P.spread[i]) : format.format(k === 'nas' ? series.a[i] : series.b[i])) : (k, i) => signed(L[k][i]));
    // The period, its numbers and the sessions.
    const tfText = tf >= 1440 ? 'يومية' : tf >= 60 ? `${tf / 60} ساعة` : `${tf} دقيقة`;
    const from = document.createElement('bdi'); from.textContent = minute(forText ? Date.parse(forText + ':00Z') / 1000 : L.t[0]);
    $('period').replaceChildren(document.createTextNode('الفترة: من '), from, document.createTextNode(` حتى الآن · شموع ${tfText}`));
    const st = periodStats(L.spread);
    // 0.8.2: «التغيّر» and «المتوسط» removed, the user marked them as repeats of the big number and of «بطاقة 1»'s mean (« هذا تكرار »).
    $('stats').replaceChildren(...[['range', 'المدى', format.format(st.range)], ['above', 'فوق الصفر', Math.round(st.above * 100) + '%']]
      .map(([key, label, value]) => {
        const c = div('stat'), text = div('stat-text'), v = document.createElement('bdi'), box = div('stat-icon ' + STAT_ICONS[key][1]);
        v.textContent = value; text.append(div('stat-label', label), v); box.append(icon(STAT_ICONS[key][0])); c.append(text, box); return c;
      }));
    const nowKey = Number.isFinite(latest?.tickMs) ? sessionOf(Math.floor(latest.tickMs / 1000)).key : null;
    $('sessions').replaceChildren(...sessionMoves(L.t, L.spread).map(s => {
      const card = div('session' + (s.key === nowKey ? ' now' : ''));
      const head = div('session-head'); const dot = document.createElement('span'); dot.className = 'sdot'; dot.style.background = s.color;
      head.append(dot, document.createTextNode(s.label + (s.hours ? ' ' : '')));
      if (s.hours) { const h = document.createElement('bdi'); h.className = 'hours'; h.textContent = s.hours; head.append(h); }
      if (s.key === nowKey) head.append(Object.assign(document.createElement('span'), { className: 'now-badge', textContent: 'الآن' }));
      const sum = document.createElement('bdi'); sum.className = 'session-sum ' + (s.sum > 0 ? 'up' : s.sum < 0 ? 'down' : ''); sum.textContent = signed(s.sum);
      // 0.9.1: under the sum, the highest, lowest and mean of the spread «1» in this session's hours (the old «times · average move»
      // line was deleted by the user). A session without candles shows «—».
      const meta = div('session-meta');
      meta.title = `حركة ${s.label} وحدها من بدايتها (0): خطواتها فقط مجموعة، وآخرها المجموع فوق`;   // 0.9.2
      for (const [label, value, cls] of [['الأعلى', s.hi, 'hi'], ['الأدنى', s.lo, 'lo'], ['المتوسط', s.mean, '']]) {
        const cell = document.createElement('span'); cell.className = 'meta-cell';
        cell.append(document.createTextNode(label + ' '), Object.assign(document.createElement('bdi'), { className: cls, textContent: value === null ? '—' : signed(value) }));
        meta.append(cell);
      }
      card.append(head, sum, meta); return card;
    }));
  }
  // The values under the pointer.
  function drawTip(L, value) {
    const tip = $('chartTip');
    if (hoverIndex === null || hoverIndex >= L.t.length) { tip.hidden = true; return; }
    const i = hoverIndex;
    tip.replaceChildren(div('tip-time', minute(L.t[i])), ...['spread', 'nas', 'dow'].map(k => {
      const row = div('tip-row'); const v = document.createElement('bdi'); v.textContent = value(k, i); v.style.color = COLORS[k];
      row.append(document.createTextNode(NAMES[k] + ' '), v); return row;
    }));
    tip.hidden = false;
    const frac = (L.t.length === 1 ? 0 : i / (L.t.length - 1));
    tip.style.left = frac > 0.6 ? '8px' : ''; tip.style.right = frac > 0.6 ? '' : '8px';
  }
  const svg = $('chart');
  svg.addEventListener('mousemove', e => {
    if (!series) return;
    const box = svg.getBoundingClientRect(), vx = (e.clientX - box.left) / box.width * W;   // W = the real width since 0.8.0
    const n = series.t.length; hoverIndex = Math.max(0, Math.min(n - 1, Math.round((vx - X0) / (X1 - X0) * (n - 1))));
    schedule(true);
  });
  svg.addEventListener('mouseleave', () => { hoverIndex = null; schedule(true); });

  // A new window size: draw again at the new size.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => schedule(true)).observe(svg.parentElement);
  fetchSeries();
  return {
    // Every pushed price: the last candle moves (or a new one starts), and the chart is redrawn soon.
    onPrice(r) {
      const first = !latest; latest = r;
      if (!open) return;
      if (first && !series) { fetchSeries(); return; }
      if (series && Number.isFinite(r.tickMs) && appendPrice(series, tf, Math.floor(r.tickMs / 1000), r.aBid, r.bBid)) schedule();
    },
    // The start or highest/lowest date changed (or the bridge came back): ask the history again.
    periodChanged() { if (open && wantedText() !== forText) { series = null; fetchSeries(); } },
    bridgeBack() { if (open) fetchSeries(); },
  };
}
