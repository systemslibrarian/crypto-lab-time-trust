import './style.css';
import { buildScenario } from './scenario';
import { renderCertPanel } from './ui/certPanel';
import { createClock, renderClockPanel } from './ui/clockPanel';
import { byId } from './ui/dom';
import { renderJwtPanel } from './ui/jwtPanel';
import { renderNodesPanel } from './ui/nodesPanel';
import { renderReplayPanel } from './ui/replayPanel';
import { renderTotpPanel } from './ui/totpPanel';
import { renderUrlPanel } from './ui/urlPanel';

async function main(): Promise<void> {
  const scenario = await buildScenario();
  const clock = createClock();
  renderClockPanel(clock);
  renderCertPanel(clock, scenario);
  renderJwtPanel(clock, scenario);
  renderTotpPanel(clock, scenario);
  renderUrlPanel(clock, scenario);
  renderReplayPanel(clock, scenario);
  renderNodesPanel(clock, scenario);
}

void main().catch((err) => {
  byId('clock-panel-body').textContent = `Failed to initialize the lab: ${String(err)}`;
});
