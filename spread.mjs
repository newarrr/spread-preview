// The spread from the last price message: NAS100 − US30 on the Bid prices (as MT5's charts and its minute candles are built), in points.
// (Decision 7 of ARCHITECTURE.md; versions before 0.3.0 used the mid price.)
// state: 'live'    a message arrived in the last STALE_SEC seconds and the last tick is recent
//        'quiet'   messages arrive (heartbeats) but no new tick for QUIET_SEC seconds: market closed or paused
//        'stale'   the source is gone or sent nothing for STALE_SEC seconds: the number is the last known one
//        'waiting' no usable message yet
export const STALE_SEC = 3, QUIET_SEC = 60;

// msg: the parsed price message; receivedMs: when the service received it; connected: whether its source is still there.
export function quote(msg, receivedMs, nowMs, connected = true) {
  if (!msg) return { state: 'waiting' };
  const nums = ['aBid', 'aAsk', 'bBid', 'bAsk'].map(k => msg[k]);
  if (!nums.every(v => Number.isFinite(v) && v > 0)) return { state: 'waiting' };
  const age = Math.max(0, (nowMs - receivedMs) / 1000);
  const tickAge = [msg.serverMs, msg.aTime, msg.bTime].every(Number.isFinite) ? Math.max(0, (msg.serverMs - Math.max(msg.aTime, msg.bTime)) / 1000) : null;
  const state = !connected || age > STALE_SEC ? 'stale' : tickAge !== null && tickAge > QUIET_SEC ? 'quiet' : 'live';
  const tickMs = Number.isFinite(msg.aTime) && Number.isFinite(msg.bTime) ? Math.max(msg.aTime, msg.bTime) : null;
  return { state, a: String(msg.a || 'A'), b: String(msg.b || 'B'), aBid: msg.aBid, bBid: msg.bBid, aAsk: msg.aAsk, bAsk: msg.bAsk, spread: msg.aBid - msg.bBid, age, tickAge, tickMs, seq: msg.seq ?? null, ver: Number.isFinite(msg.ver) ? msg.ver : null, receivedMs };
}

// A TCP stream arrives in pieces that do not respect lines: this keeps the unfinished end and hands over whole lines, parsed.
// Lines that are not JSON objects are dropped (and counted); a line longer than MAX_LINE is dropped so a bad sender cannot fill memory.
// (4,096 until step 5; the chart's history line of up to 1,500 candles is about 45,000 characters.)
export const MAX_LINE = 2_000_000;
export function lineReader(onMessage) {
  let rest = '', dropped = 0;
  return {
    feed(chunk) {
      rest += chunk;
      let i;
      while ((i = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, i).trim(); rest = rest.slice(i + 1);
        if (!line) continue;
        try { const msg = JSON.parse(line); if (msg && typeof msg === 'object') onMessage(msg); else dropped++; } catch { dropped++; }
      }
      if (rest.length > MAX_LINE) { rest = ''; dropped++; }
    },
    get dropped() { return dropped; },
  };
}

// Step 2, the start date. The page sends «YYYY-MM-DDTHH:MM» in the broker's (MT5's) clock; MQL5 counts that clock in seconds as if it
// were UTC (its datetime), so the same reading here gives the seconds the bridge understands. null for anything else.
export function parseStart(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(text || ''));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi) / 1000, back = new Date(t * 1000);
  if (y < 2000 || y > 2100 || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return t;
}
// The bridge's answer for a minute, as the page needs it: the spread at that moment.
// SpreadBridge 1.30 sends aPrice/bPrice (the open of that exact minute, or the close of the last common minute before it: decision 11)
// and «exact»; an older bridge sends only the opens of each symbol's own last candle, used as before.
export function startAnswer(ans) {
  if (!ans || ans.error) return { error: ans?.error || 'none', first: ans?.first ?? null };
  const fresh = [ans.aPrice, ans.bPrice].every(v => Number.isFinite(v) && v > 0);
  const a = fresh ? ans.aPrice : ans.aOpen, b = fresh ? ans.bPrice : ans.bOpen;
  if (![a, b].every(v => Number.isFinite(v) && v > 0)) return { error: 'none', first: ans.first ?? null };
  const exact = fresh ? ans.exact === true : ans.aTime === ans.t && ans.bTime === ans.t;
  return { t: ans.t, aTime: ans.aTime, bTime: ans.bTime, aPrice: a, bPrice: b, spread: a - b, exact, first: ans.first ?? null };
}
// Step 3: the bridge's answer for a range, as the page needs it (absolute spreads; the page subtracts the start's spread).
export function rangeAnswer(ans) {
  if (!ans || ans.error) return { error: ans?.error || 'none' };
  if (![ans.max, ans.min, ans.maxTime, ans.minTime].every(Number.isFinite)) return { error: 'none' };
  return { from: ans.from, to: ans.to, max: ans.max, maxTime: ans.maxTime, min: ans.min, minTime: ans.minTime, bars: ans.bars ?? null, tf: ans.tf ?? 1, firstUsed: ans.firstUsed ?? null };
}
// Step 5: the bridge's history for the chart: equal-length arrays of times and both symbols' closes, ordered by time.
export function seriesAnswer(ans) {
  if (!ans || ans.error) return { error: ans?.error || 'none' };
  const { t, a, b } = ans;
  if (![t, a, b].every(Array.isArray) || !t.length || t.length !== a.length || t.length !== b.length) return { error: 'none' };
  if (![...t, ...a, ...b].every(Number.isFinite)) return { error: 'none' };
  for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) return { error: 'none' };
  return { tf: Number.isFinite(ans.tf) ? ans.tf : 1, t, a, b };
}
export const brokerText = t => Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
