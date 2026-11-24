// «الجرس» (step 9, ARCHITECTURE.md section 21): bells on the spread «1» (from zero at the start) or «2» (as it is). The 🔔 button opens
// the list: add a bell (kind + level, e.g. −600 or +700), see each one waiting or rung, put a rung one back (↺) or delete it (×).
// A bell rings once when its spread reaches its level from either side between two prices (chart-core.js bellsCrossed): a sound made
// by the page itself (no files), a strip at the top with «حسناً», the window title blinking, and a Windows notification if allowed.
// Kept in this browser (spread.bells.v1). It only alerts; nothing trades.
import { bellsCrossed } from './chart-core.js';

const $ = id => document.getElementById(id);
const KEY = 'spread.bells.v1', MAX = 20;
const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = v => { const r = Math.round(v * 10) / 10; return (r > 0 ? '+' : r < 0 ? '−' : '') + format.format(Math.abs(r)); };
// A number inside an Arabic sentence as its own left-to-right run (the minus sign never flips), also in the window title.
const iso = v => '⁦' + signed(v) + '⁩';
const hhmm = ms => new Date(ms).toISOString().slice(11, 16);   // the broker's clock (tick times are the broker's clock counted as UTC)
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v.filter(b => (b.kind === 1 || b.kind === 2) && Number.isFinite(b.level)) : []; } catch { return []; } };

// ── The sounds (0.10.1, «أنواع جرس … مهم جرس قوية»): six, all made here with Web Audio, each one cycle long; a ring repeats the cycle. ──
// One note: an oscillator through its own envelope (rise, hold, fall) into out; keep() remembers it so «حسناً» can stop it.
function note(ctx, out, keep, type, freq, t, { peak = 0.4, rise = 0.01, hold = 0, fall = 0.3 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  if (typeof freq === 'function') freq(o.frequency, t); else o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + rise);
  g.gain.setValueAtTime(peak, t + rise + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + rise + hold + fall);
  o.connect(g).connect(out); o.start(t); o.stop(t + rise + hold + fall + 0.05); keep(o);
  return g;
}
export const SOUNDS = [
  // A struck bell: a deep tone with its bell partials, struck twice, ringing out.
  { key: 'bell', name: 'جرس قوي', cycle: 2.4, play(ctx, out, t, keep) {
    for (const at of [t, t + 0.8]) for (const [m, a, d] of [[1, 1, 2.2], [2, 0.6, 1.5], [2.76, 0.5, 1.1], [5.4, 0.3, 0.6], [8.93, 0.18, 0.35]]) note(ctx, out, keep, 'sine', 523 * m, at, { peak: 0.5 * a, rise: 0.004, fall: d });
  } },
  // An alarm: a hard tone sweeping up and down twice.
  { key: 'alarm', name: 'إنذار', cycle: 2, play(ctx, out, t, keep) {
    note(ctx, out, keep, 'sawtooth', (f, t0) => { f.setValueAtTime(600, t0); for (let k = 0; k < 2; k++) { f.linearRampToValueAtTime(1400, t0 + k + 0.5); f.linearRampToValueAtTime(600, t0 + k + 0.98); } }, t, { peak: 0.35, rise: 0.02, hold: 1.85, fall: 0.08 });
  } },
  // A buzzer: four short hard pulses.
  { key: 'buzz', name: 'طنين', cycle: 1.7, play(ctx, out, t, keep) {
    for (let k = 0; k < 4; k++) for (const f of [230, 233]) note(ctx, out, keep, 'square', f, t + k * 0.38, { peak: 0.22, rise: 0.005, hold: 0.24, fall: 0.03 });
  } },
  // A phone: two rings of 440 + 480 Hz trilling twenty times a second.
  { key: 'phone', name: 'هاتف', cycle: 2.8, play(ctx, out, t, keep) {
    for (const at of [t, t + 1.3]) {
      const trill = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
      trill.gain.value = 0.5; lfo.type = 'square'; lfo.frequency.value = 20; depth.gain.value = 0.5;
      lfo.connect(depth).connect(trill.gain); trill.connect(out); lfo.start(at); lfo.stop(at + 1.1); keep(lfo);
      for (const f of [440, 480]) note(ctx, trill, keep, 'sine', f, at, { peak: 0.5, rise: 0.01, hold: 0.95, fall: 0.05 });
    }
  } },
  // A siren: quick high sweeps up and down.
  { key: 'siren', name: 'صفارة', cycle: 1.6, play(ctx, out, t, keep) {
    note(ctx, out, keep, 'triangle', (f, t0) => { f.setValueAtTime(700, t0); for (let k = 0; k < 2; k++) { f.linearRampToValueAtTime(1600, t0 + k * 0.7 + 0.35); f.linearRampToValueAtTime(700, t0 + k * 0.7 + 0.7); } }, t, { peak: 0.6, rise: 0.02, hold: 1.35, fall: 0.05 });
  } },
  // The first sound (0.10.0): three rising tones.
  { key: 'tones', name: 'نغمات', cycle: 2, play(ctx, out, t, keep) {
    for (const [k, f] of [[0, 880], [1, 1175], [2, 1568]]) note(ctx, out, keep, 'sine', f, t + k * 0.22, { peak: 0.5, rise: 0.02, fall: 0.3 });
  } },
];
// Loud without breaking up: the volume, a push, then a compressor that keeps the peaks clean.
export function loudOut(ctx, volume) {
  const pre = ctx.createGain(), comp = ctx.createDynamicsCompressor();
  pre.gain.value = 1.8 * Math.max(0.1, Math.min(1, volume / 100));
  comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.15;
  pre.connect(comp).connect(ctx.destination);
  return pre;
}
const SOUND_KEY = 'spread.bellsound.v1';
const loadSound = () => { try { const v = JSON.parse(localStorage.getItem(SOUND_KEY)); return { type: SOUNDS.some(s => s.key === v?.type) ? v.type : 'bell', volume: Number.isFinite(v?.volume) ? v.volume : 100 }; } catch { return { type: 'bell', volume: 100 }; } };

export function createBells() {
  let bells = load(), kind = 1, before = { 1: null, 2: null }, now = { 1: null, 2: null }, startKey = null;
  let audio = null, voices = [], blink = 0, blinkStop = 0, loop = 0, loopStop = 0, settings = loadSound();
  const title = document.title;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(bells)); } catch {} };
  const saveSound = () => { try { localStorage.setItem(SOUND_KEY, JSON.stringify(settings)); } catch {} };

  // ── The sound: made here (Web Audio). Browsers allow it only after a click on the page, so any click opens it. ──
  function sound() {
    try { audio ||= new AudioContext(); if (audio.state === 'suspended') audio.resume(); } catch { audio = null; }
    drawSound();
    return audio;
  }
  document.addEventListener('pointerdown', sound);
  function drawSound() {
    const ok = audio && audio.state === 'running';
    $('bellSound').textContent = ok ? 'الصوت يعمل' : 'انقر في الصفحة مرة ليعمل الصوت';
    $('bellSound').classList.toggle('off', !ok);
  }
  // The chosen sound: once (to hear it), or ringing: again and again, one cycle ahead, until «حسناً» or 30 seconds.
  function play(ringing = false) {
    const ctx = sound(); if (!ctx) return;
    stopSound();
    const s = SOUNDS.find(x => x.key === settings.type) || SOUNDS[0], out = loudOut(ctx, settings.volume), keep = o => voices.push(o);
    let t = ctx.currentTime + 0.05;
    const cycle = () => { voices = voices.slice(-300); s.play(ctx, out, t, keep); t += s.cycle; };
    cycle();
    if (ringing) { cycle(); loop = setInterval(cycle, s.cycle * 1000); loopStop = setTimeout(stopSound, 30000); }
  }
  function stopSound() { clearInterval(loop); clearTimeout(loopStop); for (const o of voices) { try { o.stop(); } catch {} } voices = []; }
  // The sound picker: a button per sound (choosing one plays it), and the volume.
  function drawSounds() {
    $('bellSoundList').replaceChildren(...SOUNDS.map(s => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'bell-sound-pick' + (s.key === settings.type ? ' on' : ''), textContent: '▶ ' + s.name });
      b.addEventListener('click', () => { settings.type = s.key; saveSound(); drawSounds(); play(); });
      return b;
    }));
    $('bellVolume').value = String(settings.volume);
  }
  $('bellVolume').addEventListener('input', () => { settings.volume = Number($('bellVolume').value); saveSound(); });
  $('bellVolume').addEventListener('change', () => play());

  // ── The button and the list ──
  const button = $('bellButton'), menu = $('bellMenu');
  function setOpen(open) {
    menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
    if (open) { drawList(); drawNow(); drawSound(); drawSounds(); $('bellLevel').focus(); }
  }
  button.addEventListener('click', () => setOpen(menu.hidden));
  $('bellClose').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) setOpen(false); });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !$('bell').contains(e.target)) setOpen(false); });
  for (const b of $('bellKind').querySelectorAll('button[data-kind]')) b.addEventListener('click', () => {
    kind = Number(b.dataset.kind);
    for (const x of $('bellKind').querySelectorAll('button[data-kind]')) x.classList.toggle('on', x === b);
    drawNow();
  });
  function add() {
    const text = $('bellLevel').value.trim().replace('−', '-'), level = Number(text);
    if (!text || !Number.isFinite(level)) { hint('اكتب رقماً، مثل −600 أو 700'); return; }
    if (bells.length >= MAX) { hint(`حتى ${MAX} جرساً`); return; }
    bells.push({ id: Date.now() + Math.random(), kind, level, armed: true, rang: null, at: null });
    save(); $('bellLevel').value = ''; hint('');
    drawList(); drawCount();
    // A Windows notification too, when allowed (asked once, on this click).
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  }
  $('bellAdd').addEventListener('click', add);
  $('bellLevel').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  $('bellTest').addEventListener('click', () => play());
  function hint(text) { const h = $('bellHint'); h.textContent = text; h.hidden = !text; }

  function drawList() {
    const list = $('bellList');
    if (!bells.length) { list.replaceChildren(Object.assign(document.createElement('div'), { className: 'bell-empty', textContent: 'لا أجراس بعد' })); return; }
    const sorted = [...bells].sort((p, q) => p.kind - q.kind || q.level - p.level);
    list.replaceChildren(...sorted.map(b => {
      const row = document.createElement('div'); row.className = 'bell-row' + (b.armed ? '' : ' rang');
      const k = Object.assign(document.createElement('span'), { className: 'bell-k', textContent: String(b.kind) });
      const v = Object.assign(document.createElement('bdi'), { className: 'bell-v', textContent: signed(b.level) });
      const s = Object.assign(document.createElement('span'), { className: 'bell-s', textContent: b.armed ? 'ينتظر' : `رنّ ${hhmm(b.rang)}` });
      if (!b.armed && Number.isFinite(b.at)) s.title = `كان الفرق ${iso(b.at)}`;
      if (b.kind === 1 && !startKey && b.armed) { s.textContent = 'يحتاج تاريخ بداية'; s.classList.add('warn'); }
      const again = Object.assign(document.createElement('button'), { type: 'button', className: 'bell-again', textContent: '↺', title: 'أعده ينتظر' });
      again.hidden = b.armed;
      again.addEventListener('click', () => { b.armed = true; b.rang = null; b.at = null; save(); drawList(); drawCount(); });
      const del = Object.assign(document.createElement('button'), { type: 'button', className: 'bell-del', textContent: '×', title: 'احذف' });
      del.addEventListener('click', () => { bells = bells.filter(x => x !== b); save(); drawList(); drawCount(); });
      row.append(k, v, s, again, del); return row;
    }));
  }
  function drawNow() {
    const part = k => Number.isFinite(now[k]) ? iso(now[k]) : '—';
    $('bellNow').textContent = `الآن: «1» ${part(1)} · «2» ${part(2)}`;
  }
  function drawCount() {
    const waiting = bells.filter(b => b.armed).length, c = $('bellCount');
    c.textContent = String(waiting); c.hidden = !waiting;
  }

  // ── Ringing ──
  function ring(fired, tickMs) {
    for (const b of fired) { b.armed = false; b.rang = tickMs; b.at = now[b.kind]; }
    save(); drawCount(); if (!menu.hidden) drawList();
    const text = fired.map(b => `«${b.kind}» وصل ${iso(b.level)} (الآن ${iso(now[b.kind])})`).join(' · ');
    $('bellToastText').textContent = '🔔 ' + text;
    $('bellToast').hidden = false;
    button.classList.add('ringing');
    play(true);   // rings until «حسناً» (or 30 seconds)
    clearInterval(blink); clearTimeout(blinkStop);
    let on = false; blink = setInterval(() => { on = !on; document.title = on ? '🔔 ' + text : title; }, 700);
    blinkStop = setTimeout(quiet, 30000);
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('🔔 الفرق', { body: text, tag: 'spread-bell' }); } catch {}
  }
  function quiet() {
    stopSound(); clearInterval(blink); clearTimeout(blinkStop); document.title = title;
    $('bellToast').hidden = true; button.classList.remove('ringing');
  }
  $('bellOk').addEventListener('click', quiet);

  drawCount();
  return {
    // Every pushed price: one = the spread «1» (null without a start), two = the spread «2»; startText changes reset «1»'s last value.
    onPrice({ one, two, tickMs, startText }) {
      if ((startText || null) !== startKey) { startKey = startText || null; before[1] = null; if (!menu.hidden) drawList(); }
      now = { 1: Number.isFinite(one) ? one : null, 2: Number.isFinite(two) ? two : null };
      const fired = bellsCrossed(bells, now, before);
      before = { ...now };
      if (fired.length) ring(fired, Number.isFinite(tickMs) ? tickMs : Date.now());
      if (!menu.hidden) drawNow();
    },
  };
}
