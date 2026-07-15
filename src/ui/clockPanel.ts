/**
 * The one clock that drives every panel. The timeline SVG is the headline
 * visualization: fixed validity windows that never move, and a NOW cursor the
 * learner drags across them. Nothing cryptographic reacts to the drag — only
 * decisions do.
 */
import {
  CERT_NOT_AFTER_MS,
  CERT_NOT_BEFORE_MS,
  JWT_EXP_SEC,
  TOKEN_EXP_SEC,
  URL_EXPIRES_SEC,
} from '../scenario';
import { CLOCK_MAX_OFFSET_MS, CLOCK_MIN_OFFSET_MS, DEMO_EPOCH_MS, HOUR, MIN, SEC, fmtOffset, fmtUtc } from '../time/clock';
import { byId, clear, el } from './dom';
import type { Lab, LabEvent, Preset } from './lab';

export interface ClockControl {
  get(): number;
  set(ms: number): void;
  subscribe(fn: (ms: number) => void): void;
}

export function createClock(): ClockControl {
  let masterMs = DEMO_EPOCH_MS;
  const subs: Array<(ms: number) => void> = [];
  return {
    get: () => masterMs,
    set(ms: number) {
      masterMs = Math.min(DEMO_EPOCH_MS + CLOCK_MAX_OFFSET_MS, Math.max(DEMO_EPOCH_MS + CLOCK_MIN_OFFSET_MS, ms));
      for (const fn of subs) fn(masterMs);
    },
    subscribe(fn: (ms: number) => void) {
      subs.push(fn);
    },
  };
}

interface Track {
  label: string;
  startMs: number;
  endMs: number;
}

const TRACKS: Track[] = [
  { label: 'Certificate validity', startMs: CERT_NOT_BEFORE_MS, endMs: CERT_NOT_AFTER_MS },
  { label: 'JWT nbf → exp', startMs: DEMO_EPOCH_MS, endMs: JWT_EXP_SEC * 1000 },
  { label: 'Signed URL expiry', startMs: DEMO_EPOCH_MS, endMs: URL_EXPIRES_SEC * 1000 },
  { label: 'Node token exp', startMs: DEMO_EPOCH_MS, endMs: TOKEN_EXP_SEC * 1000 },
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const ROW_H = 30;
const AXIS_H = 26;

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function drawTimeline(svg: SVGSVGElement, viewStartMs: number, viewEndMs: number, nowMs: number): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const H = TRACKS.length * ROW_H + AXIS_H;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x = (ms: number) => ((ms - viewStartMs) / (viewEndMs - viewStartMs)) * (W - 180) + 175;

  // hour ticks
  const span = viewEndMs - viewStartMs;
  const tickStep = span > 12 * HOUR ? 6 * HOUR : span > 3 * HOUR ? HOUR : 30 * MIN;
  const firstTick = Math.ceil(viewStartMs / tickStep) * tickStep;
  for (let t = firstTick; t <= viewEndMs; t += tickStep) {
    const tx = x(t);
    svg.append(
      svgEl('line', { x1: `${tx}`, y1: '0', x2: `${tx}`, y2: `${H - AXIS_H}`, stroke: 'currentColor', 'stroke-opacity': '0.18' }),
    );
    const lbl = svgEl('text', { x: `${tx}`, y: `${H - 8}`, 'text-anchor': 'middle', 'font-size': '12', fill: 'currentColor' });
    lbl.textContent = fmtOffset(t).replace('T', '');
    svg.append(lbl);
  }

  TRACKS.forEach((tr, i) => {
    const y = i * ROW_H + 5;
    const lbl = svgEl('text', { x: '0', y: `${y + 14}`, 'font-size': '12', fill: 'currentColor' });
    lbl.textContent = tr.label;
    svg.append(lbl);
    const x1 = Math.max(x(tr.startMs), 172);
    const x2 = Math.min(x(tr.endMs), W - 2);
    if (x2 > x1) {
      svg.append(
        svgEl('rect', {
          x: `${x1}`,
          y: `${y}`,
          width: `${x2 - x1}`,
          height: `${ROW_H - 12}`,
          rx: '4',
          fill: 'var(--accent)',
          'fill-opacity': '0.3',
          stroke: 'var(--accent)',
        }),
      );
    }
    if (x(tr.endMs) > W - 2) {
      const more = svgEl('text', { x: `${W - 4}`, y: `${y + 13}`, 'text-anchor': 'end', 'font-size': '11', fill: 'currentColor' });
      more.textContent = `→ ${fmtOffset(tr.endMs)}`;
      svg.append(more);
    }
  });

  // NOW cursor
  const nx = Math.min(Math.max(x(nowMs), 172), W - 2);
  svg.append(svgEl('line', { x1: `${nx}`, y1: '0', x2: `${nx}`, y2: `${H - AXIS_H + 4}`, stroke: 'var(--bad-text)', 'stroke-width': '2.5' }));
  const nowLbl = svgEl('text', {
    x: `${Math.min(nx + 5, W - 60)}`,
    y: '12',
    'font-size': '12',
    'font-weight': '700',
    fill: 'var(--bad-text)',
  });
  nowLbl.textContent = 'NOW';
  svg.append(nowLbl);
}

const STEP_BUTTONS: Array<{ label: string; aria: string; deltaMs: number }> = [
  { label: '−1 d', aria: 'move clock back one day', deltaMs: -24 * HOUR },
  { label: '−1 h', aria: 'move clock back one hour', deltaMs: -HOUR },
  { label: '−5 m', aria: 'move clock back five minutes', deltaMs: -5 * MIN },
  { label: '−30 s', aria: 'move clock back thirty seconds', deltaMs: -30 * SEC },
  { label: '+30 s', aria: 'move clock forward thirty seconds', deltaMs: 30 * SEC },
  { label: '+5 m', aria: 'move clock forward five minutes', deltaMs: 5 * MIN },
  { label: '+1 h', aria: 'move clock forward one hour', deltaMs: HOUR },
  { label: '+1 d', aria: 'move clock forward one day', deltaMs: 24 * HOUR },
];

const MOMENTS: Array<{ label: string; offsetMs: number }> = [
  { label: 'T+0 — everything fresh', offsetMs: 0 },
  { label: 'T+16 m — JWT expired', offsetMs: 16 * MIN },
  { label: 'T+21 m — URL expired', offsetMs: 21 * MIN },
  { label: 'T+31 m — token expired', offsetMs: 31 * MIN },
  { label: 'T+25 h — cert expired', offsetMs: 25 * HOUR },
  { label: 'T−90 m — cert not yet valid', offsetMs: -90 * MIN },
];

/** Scenario presets — each encodes a STORY: clock + per-panel controls + focus. */
const PRESETS: Preset[] = [
  {
    id: 'jwt-split',
    label: 'JWT split-brain',
    blurb: 'One token, two servers 90 s apart: valid here, expired there.',
    focus: 'jwt-panel',
    clockOffsetMs: 14 * MIN + 30 * SEC,
    panels: { jwt: { skew: 90, leeway: 0 } },
  },
  {
    id: 'url-resurrect',
    label: 'Resurrect an expired URL',
    blurb: 'Roll the server clock back an hour — the dead link works again.',
    focus: 'url-panel',
    clockOffsetMs: 21 * MIN,
    panels: { url: { serverSkew: -3600, clientSkew: 0 } },
  },
  {
    id: 'replay-slip',
    label: 'Replay slips through',
    blurb: 'Six minutes later, the slow server still calls the replay fresh.',
    focus: 'replay-panel',
    clockOffsetMs: 6 * MIN,
    panels: { replay: { skewA: -240, skewB: 0, skewC: 240 } },
  },
  {
    id: 'totp-wide',
    label: 'TOTP window too wide',
    blurb: '±2 windows and no used-code record — an intercepted code replays.',
    focus: 'totp-panel',
    clockOffsetMs: 0,
    panels: { totp: { tolerance: 2, usedRecord: false } },
  },
];

/** The guided tour: presets plus a pinned one-liner, walked one step at a time. */
interface TourStep {
  preset: Preset;
  pin: string;
}
const TOUR: TourStep[] = [
  { preset: PRESETS[0], pin: 'Same token bytes. Same valid signature. Opposite verdicts — only the clocks differ.' },
  { preset: PRESETS[1], pin: 'No forgery happened. The MAC is genuinely valid; the server clock lied about "now".' },
  { preset: PRESETS[2], pin: 'Nothing cryptographic tells the replay from the original. A slow clock re-opens the window.' },
  {
    preset: {
      id: 'cert-expiry',
      label: 'Certificate expiry',
      blurb: '',
      focus: 'cert-panel',
      clockOffsetMs: 25 * HOUR,
    },
    pin: 'The signature is byte-for-byte identical to when it was "valid". Only the date comparison flipped.',
  },
];

function applyPreset(clock: ClockControl, lab: Lab, preset: Preset): void {
  clock.set(DEMO_EPOCH_MS + preset.clockOffsetMs);
  for (const [id, opts] of Object.entries(preset.panels ?? {})) lab.setPanel(id, opts);
  lab.scrollTo(preset.focus);
  lab.flashAlarm(preset.focus);
}

export function renderClockPanel(clock: ClockControl, lab: Lab): void {
  const host = byId<HTMLElement>('clock-panel-body');
  clear(host);

  const nowLine = el('p', { class: 'clock-now' });
  const slider = el('input', {
    type: 'range',
    id: 'master-clock',
    min: String(CLOCK_MIN_OFFSET_MS / 1000),
    max: String(CLOCK_MAX_OFFSET_MS / 1000),
    step: '15',
    value: '0',
  });
  const sliderField = el(
    'div',
    { class: 'field' },
    el('label', { for: 'master-clock' }, 'True time (drag it — every verifier on this page re-runs as you do)'),
    slider,
  );

  const stepRow = el('div', { class: 'control-row' });
  for (const b of STEP_BUTTONS) {
    const btn = el('button', { type: 'button', 'aria-label': b.aria }, b.label);
    btn.addEventListener('click', () => clock.set(clock.get() + b.deltaMs));
    stepRow.append(btn);
  }
  const reset = el('button', { type: 'button', class: 'primary' }, 'Reset to T+0');
  reset.addEventListener('click', () => clock.set(DEMO_EPOCH_MS));
  stepRow.append(reset);

  const momentsRow = el('div', { class: 'control-row' });
  momentsRow.append(el('span', { class: 'readout' }, 'Jump to:'));
  for (const m of MOMENTS) {
    const btn = el('button', { type: 'button' }, m.label);
    btn.addEventListener('click', () => clock.set(DEMO_EPOCH_MS + m.offsetMs));
    momentsRow.append(btn);
  }

  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('aria-hidden', 'true');
  const zoomRow = el('div', { class: 'control-row' });
  let zoom: 'hours' | 'days' = 'hours';
  const zoomHours = el('button', { type: 'button', 'aria-pressed': 'true' }, 'Zoom: first hours');
  const zoomDays = el('button', { type: 'button', 'aria-pressed': 'false' }, 'Zoom: full two days');
  const setZoom = (z: 'hours' | 'days') => {
    zoom = z;
    zoomHours.setAttribute('aria-pressed', String(z === 'hours'));
    zoomDays.setAttribute('aria-pressed', String(z === 'days'));
    redraw(clock.get());
  };
  zoomHours.addEventListener('click', () => setZoom('hours'));
  zoomDays.addEventListener('click', () => setZoom('days'));
  zoomRow.append(zoomHours, zoomDays);

  const timelineWrap = el('div', { class: 'timeline-wrap' });
  timelineWrap.append(svg);
  const srSummary = el(
    'p',
    { class: 'visually-hidden' },
    'Timeline of the fixed validity windows: certificate valid from one hour before T zero until 24 hours after; JWT valid from T zero to T plus 15 minutes; signed URL until T plus 20 minutes; node token until T plus 30 minutes. The movable NOW cursor shows the current master clock.',
  );

  function redraw(ms: number): void {
    nowLine.textContent = '';
    nowLine.append(fmtUtc(ms), ' ', el('span', { class: 'clock-offset' }, `(${fmtOffset(ms)})`));
    const offSec = Math.round((ms - DEMO_EPOCH_MS) / 1000);
    slider.value = String(offSec);
    slider.setAttribute('aria-valuetext', `${fmtUtc(ms)} (${fmtOffset(ms)})`);
    const [vs, ve] =
      zoom === 'hours'
        ? [DEMO_EPOCH_MS - 2 * HOUR, DEMO_EPOCH_MS + 3 * HOUR]
        : [DEMO_EPOCH_MS + CLOCK_MIN_OFFSET_MS, DEMO_EPOCH_MS + CLOCK_MAX_OFFSET_MS];
    drawTimeline(svg, vs, ve, ms);
  }

  slider.addEventListener('input', () => clock.set(DEMO_EPOCH_MS + Number(slider.value) * 1000));
  clock.subscribe(redraw);

  // ---- guided tour ----
  const tourBanner = el('div', { class: 'tour-banner', role: 'status', 'aria-live': 'polite', hidden: 'hidden' });
  function showTourStep(i: number): void {
    if (i < 0 || i >= TOUR.length) {
      tourBanner.hidden = true;
      return;
    }
    const step = TOUR[i];
    applyPreset(clock, lab, step.preset);
    clear(tourBanner);
    const next = el('button', { type: 'button', class: 'primary' }, i === TOUR.length - 1 ? 'Finish tour' : 'Next →');
    next.addEventListener('click', () => showTourStep(i + 1));
    const stop = el('button', { type: 'button' }, 'Exit');
    stop.addEventListener('click', () => showTourStep(-1));
    tourBanner.append(
      el('span', { class: 'tour-step-n' }, `TOUR — STEP ${i + 1} OF ${TOUR.length}: ${step.preset.label}`),
      el('p', { class: 'tour-pin' }, step.pin),
      el('div', { class: 'control-row' }, next, stop),
    );
    tourBanner.hidden = false;
  }
  const tourCta = el('button', { type: 'button', class: 'tour-cta' }, '▶ Take the 30-second tour');
  tourCta.addEventListener('click', () => showTourStep(0));

  // ---- scenario presets ----
  const presetGrid = el('div', { class: 'preset-grid' });
  for (const p of PRESETS) {
    const btn = el(
      'button',
      { type: 'button', class: 'preset-btn' },
      el('span', { class: 'preset-title' }, p.label),
      el('span', { class: 'preset-blurb' }, p.blurb),
    );
    btn.addEventListener('click', () => applyPreset(clock, lab, p));
    presetGrid.append(btn);
  }

  // ---- event rail ("what just changed") ----
  const railList = el('ul', {});
  const rail = el(
    'div',
    { class: 'event-rail', role: 'log', 'aria-live': 'polite', 'aria-label': 'what just changed' },
    el('span', { class: 'rail-label' }, 'WHAT JUST CHANGED'),
    railList,
  );
  const events: LabEvent[] = [];
  lab.onEvent((e) => {
    events.unshift(e);
    if (events.length > 4) events.pop();
    clear(railList);
    for (const ev of events) {
      railList.append(el('li', {}, el('span', { class: 'ev-panel' }, `${ev.panel}: `), ev.text));
    }
  });

  host.append(
    nowLine,
    el('div', { class: 'control-row' }, tourCta),
    tourBanner,
    el('p', { class: 'readout' }, 'Or jump straight to a scenario:'),
    presetGrid,
    sliderField,
    stepRow,
    momentsRow,
    zoomRow,
    timelineWrap,
    srSummary,
    rail,
  );
  redraw(clock.get());
}
