// Tiny event bus: the game hook reports server-confirmed plant/harvest results, the 3D scene animates them.
// Nothing here touches game state, and emitting never triggers a React render.

export function createFarmEvents() {
  const listeners = new Set();
  return {
    emit(event) {
      listeners.forEach((fn) => fn(event));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
