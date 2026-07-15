/**
 * Shared lab context: lets the master-clock panel drive per-panel controls
 * (scenario presets, guided tour) and lets panels announce threshold crossings
 * ("JWT just crossed exp") to a single event rail. Panels register a small
 * imperative handle; nothing here touches cryptography.
 */

export interface PanelControl {
  /** stable id, matches the panel's section for scroll-into-view */
  sectionId: string;
  /** human label for the tour/log */
  title: string;
  /** apply named per-panel control values (skew, leeway, tolerance, …) */
  set?: (opts: Record<string, number | boolean>) => void;
}

export interface LabEvent {
  panel: string;
  text: string;
}

export class Lab {
  private controls = new Map<string, PanelControl>();
  private listeners: Array<(e: LabEvent) => void> = [];

  register(id: string, ctrl: PanelControl): void {
    this.controls.set(id, ctrl);
  }

  setPanel(id: string, opts: Record<string, number | boolean>): void {
    this.controls.get(id)?.set?.(opts);
  }

  control(id: string): PanelControl | undefined {
    return this.controls.get(id);
  }

  onEvent(fn: (e: LabEvent) => void): void {
    this.listeners.push(fn);
  }

  emit(panel: string, text: string): void {
    for (const fn of this.listeners) fn({ panel, text });
  }

  scrollTo(sectionId: string): void {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  flashAlarm(sectionId: string): void {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.classList.remove('panel-flash');
    // force reflow so the animation restarts even on repeat triggers
    void el.offsetWidth;
    el.classList.add('panel-flash');
  }
}

/**
 * A scenario preset encodes a STORY, not just a time: the master clock plus the
 * per-panel control values that make the moment happen, plus which panel to
 * reveal.
 */
export interface Preset {
  id: string;
  label: string;
  blurb: string;
  focus: string; // sectionId to scroll to
  clockOffsetMs: number;
  panels?: Record<string, Record<string, number | boolean>>;
}
