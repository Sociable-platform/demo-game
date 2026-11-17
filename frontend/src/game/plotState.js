// Pure helpers that turn server state (plantedAt / readyAt timestamps) into what the UI shows.
// They are display-only: whether a harvest is allowed is always decided by the server.

export function plotProgress(plot, now) {
  if (!plot.cropId) return 0;
  const total = plot.readyAt - plot.plantedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - plot.plantedAt) / total));
}

/** empty -> planted (just in the ground) -> growing -> ready */
export function plotPhase(plot, now) {
  if (!plot.cropId) return 'empty';
  if (now >= plot.readyAt) return 'ready';
  return plotProgress(plot, now) < 0.3 ? 'planted' : 'growing';
}

export function remainingSeconds(plot, now) {
  if (!plot.cropId) return 0;
  return Math.max(0, Math.ceil((plot.readyAt - now) / 1000));
}

export function formatSeconds(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Offset between the server clock and this browser's clock, so timers follow server time. */
export const clockOffset = (serverTime, clientNow = Date.now()) => serverTime - clientNow;

/** One short sentence telling a new player what to do next. */
export function nextHint(state, now) {
  const { plots } = state.farm;
  // A crop is also what you plant (like a carrot in Minecraft), so one inventory count covers planting and selling.
  const crops = Object.values(state.inventory.crops).reduce((a, b) => a + b, 0);
  const phases = plots.map((p) => plotPhase(p, now));
  if (phases.includes('ready')) return 'Something is ripe! Tap a glowing plot to harvest it.';
  if (crops > 0 && phases.includes('empty')) return 'Pick a crop, then tap an empty plot to plant it. Keep some to plant again!';
  if (phases.some((p) => p !== 'empty')) {
    return crops > 0 ? 'Your crops are growing. Sell extras in the Barn for coins.' : 'Your crops are growing. The timers count down to harvest time.';
  }
  return 'Out of crops? Buy one in the Shop and plant it.';
}
