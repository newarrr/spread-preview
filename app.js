// The page. Every new price is pushed by the service (/events, Server-Sent Events) and drawn on the next screen frame.
// Without a start: the big number is the spread NAS100 − US30 (Bid, as on MT5's charts).
// Two dates (step 4), both in MT5's clock to the minute:
//   «البداية»          → the spread at that minute and the big number «since the start» = the spread now − the spread then (steps 2-3)
//   «الأعلى والأدنى من» → the highest and lowest spread from that minute to now: from MT5's history (/api/range), then every price.
//                         Left empty, it follows the start date.
// Two cards (step 6): «بطاقة 1» = the spread «1» since the start (highest, lowest, mean), «بطاقة 2» = the spread «2» (now, at the start,
// highest, lowest from the «from» date). ARCHITECTURE.md sections 2.2 and 18.
import { cardOne, appendPrice, entryPrices } from './chart-core.js';
const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const round1 = v => Math.round(v * 10) / 10;
const signed = v => { const r = round1(v); return (r > 0 ? '+' : r < 0 ? '−' : '') + format.format(Math.abs(r)); };
const minute = t => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
// The status line is short (0.5.3, «بدون خبس… اشارة جسر وزائد ms فقط»): the coloured dot is the bridge's signal; live shows only the
// page's delay in ms, the other states two words. The full sentence (TEXT) is the line's tooltip.
const SHORT = {
  live: r => r.source === 'file' ? 'ملف' : `⁦${r.delay} ms⁩`,   // a left-to-right run, or the Arabic line shows «ms 2»
  quiet: () => 'السوق مغلق', stale: () => 'MT5 لا يرسل', waiting: () => 'بانتظار MT5', down: () => 'الخدمة متوقفة',
};
const TEXT = {
  live: r => r.source === 'file' ? `مباشر من MT5 (النسخة الأولى: ملف SpreadFeed) · ${r.rate} تحديث/ث` : `مباشر من MT5 · تأخير الصفحة ${r.delay} ms · ${r.rate} تحديث/ث`,
  quiet: r => `لا أسعار جديدة منذ ${Math.max(1, Math.round(r.tickAge / 60))} دقيقة (السوق مغلق أو متوقف) · آخر فرق معروف`,
  stale: () => 'MT5 لا يرسل: هل أُغلق MT5 أو أُزيل SpreadBridge من الشارت؟ · آخر فرق معروف',
  waiting: () => 'بانتظار MT5… أضف SpreadBridge على أي شارت في MT5',
  down: () => 'الخدمة متوقفة: شغّل START.bat',
};
const START_KEY = 'spread.start.v1', RANGE_KEY = 'spread.range.v1';
let latest = null, drawn = null, last = null, frame = 0, seen = [];
let startText = null, start = null;   // the chosen start «YYYY-MM-DDTHH:MM» and the bridge's answer for it {spread, aTime, bTime, t}
let rangeText = null, ext = null;     // the chosen «from» for highest/lowest (null: follows the start) and {max:{v,t}, min:{v,t}, tf, for}
let rangeTimer = 0, startAsk = 0, rangeAsk = 0;
// «بطاقة 1» is always measured from the START date: its highest/lowest are the range's when the «from» date is empty or the same,
// else its own range (ext1); its mean comes from the closes since the start (series1 {t, a, b, tf, for}).
let ext1 = null, series1 = null, seriesTimer = 0, seriesAsk = 0;
// Whichever of the two holds the start's date (the range itself first); the other is kept so live extremes survive a change of date.
const forDate = text => (text && [ext, ext1].find(e => e?.for === text)) || null;
const extOne = () => forDate(startText);
// Notes under the dates (0.5.1): each on its own line; 'info' in a calm colour (market closed, longer candles), 'error' in gold.
// Their parts are text, or {t} for a broker time drawn as its own left-to-right run so dates never flip inside Arabic text.
const notes = { start: null, range: null };
const info = (...parts) => ({ kind: 'info', parts }), problem = (...parts) => ({ kind: 'error', parts });
let notesKey = '';
// 0.8.0: only problems (gold) stay on screen; information (market closed at the start, longer candles) moved into the tooltip of its
// tile, so the wide layout shows no extra lines (the user's picture).
const noteText = n => n ? n.parts.map(p => typeof p === 'string' ? p : minute(p.t)).join('') : '';
function drawNotes() {
  const list = [notes.start, notes.range].filter(n => n?.kind === 'error'), key = JSON.stringify(list);
  if (key === notesKey) return; notesKey = key;
  const box = $('startNote'); box.hidden = !list.length;
  box.replaceChildren(...list.map(n => {
    const line = document.createElement('div'); line.className = 'note ' + n.kind;
    line.append(...n.parts.map(p => typeof p === 'string' ? document.createTextNode(p) : Object.assign(document.createElement('bdi'), { textContent: minute(p.t) })));
    return line;
  }));
}
const rangeFor = () => rangeText || startText;
const redraw = () => { drawn = null; if (!frame) frame = requestAnimationFrame(draw); };

function draw() {
  frame = 0;
  const r = latest; if (!r || r === drawn) return; drawn = r;
  const box = $('spread');
  if (Number.isFinite(r.spread)) {
    const main = start ? r.spread - start.spread : r.spread, value = round1(main);
    box.firstElementChild.textContent = signed(value);
    if (last !== null && value !== last) { box.classList.toggle('up', value > last); box.classList.toggle('down', value < last); }
    last = value;
    const pair = $('pair');
    if (pair.dataset.names !== r.a + '|' + r.b) {
      pair.dataset.names = r.a + '|' + r.b;
      pair.replaceChildren(Object.assign(document.createElement('bdi'), { textContent: r.a }), ' − ', Object.assign(document.createElement('bdi'), { textContent: r.b }));
    }
  }
  $('mainLabel').textContent = start ? 'منذ البداية' : 'الفرق';
  drawEntry(r);
  drawInfo();
  $('state').className = 'state ' + r.state;
  $('stateText').textContent = (SHORT[r.state] || SHORT.waiting)(r);
  $('state').title = (TEXT[r.state] || TEXT.waiting)(r);
}

// ── «الشراء والبيع» (step 8): the entry spread now for «زيادة» and «نقصان», and the cost; display only (decision 14) ──
function drawEntry(r) {
  const e = entryPrices(r);
  $('entryUp').textContent = e ? signed(e.up) : '—';
  $('entryDown').textContent = e ? signed(e.down) : '—';
  $('entryCost').textContent = e ? format.format(round1(e.cost)) : '—';
  // A service older than 0.9.0 sends no Ask: say what to do.
  $('entry').title = !e && Number.isFinite(r?.aBid) && r.aAsk === undefined ? 'سعر الدخول يحتاج إعادة START.bat مرة واحدة' : '';
}

// ── The two cards under the dates ──
const tfName = tf => tf >= 1440 ? 'يومية' : tf >= 60 ? `${tf / 60} ساعة` : `${tf} دقيقة`;
function drawCardOne() {
  $('card1').hidden = !startText;
  if (!startText) return;
  const one = cardOne(start, extOne(), series1);
  const tf = extOne()?.tf, longer = tf > 1 ? ` · من شموع ${tfName(tf)}` : '';
  for (const [key, row, id] of [['max', 'max1Row', 'max1'], ['min', 'min1Row', 'min1']]) {
    const e = one[key];
    $(id).textContent = e ? signed(e.v) : '…';
    $(row).title = !e ? '' : (e.v === 0 && e.t === start?.t ? 'البداية نفسها (0)' : `عند ${minute(e.t)} بساعة MT5`) + longer;
  }
  $('mean1').textContent = one.mean === null ? '…' : signed(one.mean);
  $('mean1Row').title = one.mean !== null ? `متوسط «1» على ${one.n} شمعة (${tfName(series1.tf)}) منذ البداية`
    : latest?.source === 'bridge' && !(latest.ver >= 140) ? 'المتوسط يحتاج SpreadBridge 1.40' : '';
}
function drawInfo() {
  const any = !!(startText || rangeText);
  $('startInfo').hidden = !any;
  drawNotes();
  drawCardOne();
  if (!any) return;
  $('nowSpread').textContent = Number.isFinite(latest?.spread) ? signed(latest.spread) : '—';
  $('startRow').hidden = !startText;
  $('startAt').textContent = start ? minute(start.aTime) : '';
  $('startSpread').textContent = start ? signed(start.spread) : '…';
  $('startRow').title = notes.start?.kind === 'info' ? noteText(notes.start) : '';
  const longer = ext?.tf > 1 ? ` · من شموع ${tfName(ext.tf)}` : '';
  // The highest and lowest as the spread itself (0.4.1), without the time on screen (0.5.2: «بدون نخبس»): the time is only in the
  // tooltip of the line. Both stay current up to the latest price.
  for (const [key, row, id] of [['max', 'maxRow', 'maxSince'], ['min', 'minRow', 'minSince']]) {
    const e = ext?.[key];
    $(row).hidden = !rangeFor();
    $(id).textContent = e ? signed(e.v) : '…';
    $(row).title = e ? `عند ${minute(e.t)} بساعة MT5${longer}` : '';
  }
}
// A new price moves the highest or lowest when it passes them (time: the last tick, broker clock).
function track(r) {
  if (!Number.isFinite(r.spread)) return;
  const t = Number.isFinite(r.tickMs) ? Math.floor(r.tickMs / 1000) : Math.floor(Date.now() / 1000);
  for (const e of new Set([ext, ext1].filter(Boolean))) {
    if (r.spread > e.max.v) e.max = { v: r.spread, t };
    if (r.spread < e.min.v) e.min = { v: r.spread, t };
  }
  // The mean of «بطاقة 1»: the last candle moves, or a new one starts.
  if (series1 && Number.isFinite(r.tickMs)) appendPrice(series1, series1.tf, Math.floor(r.tickMs / 1000), r.aBid, r.bBid);
}
const errorParts = r => r.error === 'bridge' ? ['التاريخ يحتاج بوت SpreadBridge في MT5: النسخة الأولى (الملف) لا تجيب عن الدقائق الماضية.']
  : r.error === 'before' ? ['هذا قبل أقدم دقيقة عند الوسيط في MT5 (', { t: r.first }, '). اختر تاريخاً بعدها.']
  : r.error === 'loading' ? ['MT5 ما زال يحمّل تاريخ تلك الفترة… أعد الاختيار بعد لحظات.']
  : r.error === 'time' ? ['اكتب التاريخ والساعة والدقيقة كاملة.'] : ['لم يجب MT5، أعد المحاولة.'];
const getJson = async url => (await fetch(url, { cache: 'no-store' })).json();

// The start: the spread at that minute.
async function askStart() {
  if (!startText || start) return;
  const forText = startText, ask = ++startAsk;
  try {
    const r = await getJson('/api/at?t=' + encodeURIComponent(forText));
    if (ask !== startAsk) return;
    if (r.error) notes.start = problem('البداية: ', ...errorParts(r));
    else {
      start = { ...r, text: forText }; last = null;
      // Market closed (or no tick) at that minute: the last price before it is used (decision 11), said as information.
      // An older service sends no «exact»: the minute was exact when both candles start at the asked time.
      const exact = r.exact ?? (r.aTime === r.t && r.bTime === r.t);
      notes.start = exact ? null : info('البداية ', { t: r.t }, ': السوق مغلق، المستعمل آخر سعر عند ', { t: Math.min(r.aTime, r.bTime) });
    }
  } catch { notes.start = problem('الخدمة لا تجيب.'); }
  redraw();
}
// The highest and lowest from the «from» date (or the start) to now; asked again every 5 minutes to cover any gap in the pushed prices.
// One answer, with the live extremes already seen for the same date kept.
function merged(r, forText, before) {
  const keep = before?.for === forText ? before : null;
  const max = [{ v: r.max, t: r.maxTime }, keep?.max].filter(Boolean).reduce((a, b) => (b.v > a.v ? b : a));
  const min = [{ v: r.min, t: r.minTime }, keep?.min].filter(Boolean).reduce((a, b) => (b.v < a.v ? b : a));
  return { max, min, tf: r.tf, for: forText };
}
async function askRange() {
  clearTimeout(rangeTimer);
  const forText = rangeFor(); if (!forText) return;
  // «بطاقة 1» needs the range from the start too, when the «from» date is another one.
  const oneText = startText && startText !== forText ? startText : null;
  const ask = ++rangeAsk;
  try {
    const [r, r1] = await Promise.all([getJson('/api/range?t=' + encodeURIComponent(forText)), oneText ? getJson('/api/range?t=' + encodeURIComponent(oneText)).catch(() => null) : null]);
    if (ask !== rangeAsk) return;
    if (r1 && !r1.error) ext1 = merged(r1, oneText, forDate(oneText));
    if (!r.error) {
      ext = merged(r, forText, forDate(forText));
      notes.range = r.tf > 1 ? info(`الأعلى والأدنى من شموع ${r.tf === 60 ? 'الساعة' : r.tf + ' دقائق'}، لأن الفترة أطول مما يحفظه MT5 من شموع الدقيقة.`) : null;
      if (Number.isFinite(latest?.spread)) track(latest);
    } else if (r.error === 'timeout' && latest?.source === 'bridge' && !(latest.ver >= 120)) {
      notes.range = problem('الأعلى والأدنى يحتاجان SpreadBridge 1.20 أو أحدث: انسخ الملف الجديد إلى MQL5\\Experts، واضغط F7، ثم أعد سحبه إلى الشارت.');
    } else notes.range = problem('الأعلى والأدنى: ', ...errorParts(r));
  } catch {}
  redraw();
  rangeTimer = setTimeout(askRange, 5 * 60 * 1000);
}

// The closes since the start, for the mean of «بطاقة 1» (SpreadBridge 1.40); asked again every 5 minutes, or a minute after a failure.
async function askSeries() {
  clearTimeout(seriesTimer);
  const forText = startText; if (!forText) return;
  const ask = ++seriesAsk;
  let ok = false;
  try {
    const r = await getJson('/api/series?t=' + encodeURIComponent(forText));
    if (ask !== seriesAsk) return;
    if (!r.error) { series1 = { t: r.t, a: r.a, b: r.b, tf: r.tf, for: forText }; ok = true; }
  } catch {}
  if (ask !== seriesAsk) return;
  redraw();
  seriesTimer = setTimeout(askSeries, ok ? 5 * 60 * 1000 : 60 * 1000);
}

function keep(key, text) { try { text ? localStorage.setItem(key, text) : localStorage.removeItem(key); } catch {} }
function chooseStart(text) {
  startText = text || null; start = null; last = null; notes.start = null;
  keep(START_KEY, startText); $('startClear').hidden = !startText;
  askStart();
  if (!rangeText) { ext = null; notes.range = null; }   // the highest/lowest follow the start while their own date is empty
  ext1 = null; series1 = null; clearTimeout(seriesTimer); seriesAsk++;
  askRange(); askSeries();   // «بطاقة 1» is measured from the start
  redraw();
}
function chooseRange(text) {
  if (startText && ext?.for === startText) ext1 = ext;   // «بطاقة 1» keeps what it already counted since the start
  rangeText = text || null; ext = null; notes.range = null;
  keep(RANGE_KEY, rangeText); $('rangeClear').hidden = !rangeText;
  askRange();
  redraw();
}
$('startInput').addEventListener('change', e => chooseStart(e.target.value));
$('startClear').addEventListener('click', () => { $('startInput').value = ''; chooseStart(null); });
$('rangeInput').addEventListener('change', e => chooseRange(e.target.value));
$('rangeClear').addEventListener('click', () => { $('rangeInput').value = ''; chooseRange(null); });
// The two dates come back from this browser; each is asked of MT5 (the range from its own date, or the start's).
try {
  const savedStart = localStorage.getItem(START_KEY), savedRange = localStorage.getItem(RANGE_KEY);
  if (savedStart) { $('startInput').value = savedStart; startText = savedStart; $('startClear').hidden = false; }
  if (savedRange) { $('rangeInput').value = savedRange; rangeText = savedRange; $('rangeClear').hidden = false; }
} catch {}
askStart(); askRange(); askSeries(); redraw();

// ── Step 5: the chart panel; its period is the start date, else the highest/lowest date, else the last 24 hours ──
// Loaded softly: an older service that does not serve panel.js yet leaves the card working and the button says what to do.
let panel = { onPrice() {}, periodChanged() {}, bridgeBack() {} };
import('./panel.js')
  .then(m => {
    panel = m.createPanel({
      // «1» from the start date, «2» from date two (as «بطاقة 2», 0.9.5); each falls back on the other.
      periodText: kind => kind === 2 ? (rangeText || startText || null) : (startText || rangeText || null),
      extremes: () => ext,
      startPrices: () => start ? { a: start.aPrice, b: start.bPrice } : null,
      // When the chart's period is the start date, it measures from the start's own prices, as the big number does.
      baseline: text => start && start.text === text ? { a: start.aPrice, b: start.bPrice } : null,
    });
    if (latest?.messages) panel.onPrice(latest);
  })
  .catch(() => { const n = $('panelNote'); n.textContent = 'الرسم يحتاج إعادة START.bat'; n.hidden = false; });
for (const id of ['startInput', 'startClear', 'rangeInput', 'rangeClear']) $(id).addEventListener(id.endsWith('Input') ? 'change' : 'click', () => panel.periodChanged());

// ── Step 9: «الجرس», loaded softly like the panel: an older service has no bell.js, the button then says what to do ──
let bells = { onPrice() {} };
import('./bell.js')
  .then(m => { bells = m.createBells(); })
  .catch(() => { const b = $('bellButton'); b.disabled = true; b.title = 'الجرس يحتاج إعادة START.bat'; });

// ── The live price ──
const events = new EventSource('/events');
events.onmessage = e => {
  const r = JSON.parse(e.data), now = Date.now();
  r.delay = Math.max(0, now - r.sentMs);
  // Updates in the last second (prices only; the once-a-second state ticks do not count).
  if (r.messages !== latest?.messages) {
    seen.push(now); track(r); panel.onPrice(r);
    if (Number.isFinite(r.spread)) bells.onPrice({ one: start ? r.spread - start.spread : null, two: r.spread, tickMs: r.tickMs, startText: start?.text });
  }
  seen = seen.filter(t => now - t <= 1000); r.rate = seen.length;
  // Dates chosen before the bridge could answer are asked as soon as it can; the range and the chart again after a reconnection.
  if (r.canAsk && !latest?.canAsk) { askStart(); askRange(); askSeries(); panel.bridgeBack(); }
  latest = r;
  if (!frame) frame = requestAnimationFrame(draw);
};
events.onerror = () => { latest = { state: 'down' }; redraw(); };
