import './style.css';
import { buildScenario } from './scenario';
import { renderCertPanel } from './ui/certPanel';
import { createClock, renderClockPanel } from './ui/clockPanel';
import { byId } from './ui/dom';
import { Lab } from './ui/lab';
import { renderJwtPanel } from './ui/jwtPanel';
import { renderNodesPanel } from './ui/nodesPanel';
import { renderReplayPanel } from './ui/replayPanel';
import { renderTotpPanel } from './ui/totpPanel';
import { renderUrlPanel } from './ui/urlPanel';

async function main(): Promise<void> {
  const scenario = await buildScenario();
  const clock = createClock();
  const lab = new Lab();
  // panels register their controls before the clock panel wires presets/tour
  renderCertPanel(clock, scenario, lab);
  renderJwtPanel(clock, scenario, lab);
  renderTotpPanel(clock, scenario, lab);
  renderUrlPanel(clock, scenario, lab);
  renderReplayPanel(clock, scenario, lab);
  renderNodesPanel(clock, scenario, lab);
  renderClockPanel(clock, lab);
}

void main().catch((err) => {
  byId('clock-panel-body').textContent = `Failed to initialize the lab: ${String(err)}`;
});
