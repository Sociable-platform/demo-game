import { afterEach, expect, it, vi } from "vitest";
import { mountClanWidget } from "./mountClanWidget.js";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const container = new EventTarget();
  const widget = { ready: Promise.resolve(), destroy: vi.fn() };
  const sdk = {
    mountExperience: vi.fn(() => widget),
    resetPlayerSession: vi.fn(),
  };
  const init = vi.fn(() => sdk);
  const options = {
    container,
    settings: {
      gameId: "game-1",
      platformUrl: "https://platform.test",
      socialUrl: "https://social.test",
      realtimeUrl: "https://realtime.test",
    },
    getPlayerToken: vi.fn(),
    onJoined: vi.fn(),
    onReady: vi.fn(),
    onError: vi.fn(),
  };
  vi.stubGlobal("window", { ClanSDK: { init } });
  return { options, init, sdk, widget };
}

it("mounts the script global with public settings and the game token callback", async () => {
  const { options, init, sdk } = fixture();
  const dispose = mountClanWidget(options);
  expect(init).toHaveBeenCalledWith({
    ...options.settings,
    getPlayerToken: options.getPlayerToken,
  });
  expect(sdk.mountExperience).toHaveBeenCalledWith({
    container: options.container,
    assets: {
      badges: {
        "custom-badge": "/badges/badge.png",
        "custom-badge2": "/badges/badge2.png",
        "custom-badge3": "/badges/badge3.png",
      },
    },
  });
  await Promise.resolve();
  expect(options.onReady).toHaveBeenCalledOnce();
  options.container.dispatchEvent(new Event("clan-sdk:joined"));
  expect(options.onJoined).toHaveBeenCalledOnce();
  dispose();
});

it("reports a missing or invalid script global without throwing into the game", () => {
  for (const value of [undefined, {}]) {
    const { options } = fixture();
    vi.stubGlobal("window", { ClanSDK: value });
    expect(() => mountClanWidget(options)()).not.toThrow();
    expect(options.onError).toHaveBeenCalledOnce();
    expect(options.onReady).not.toHaveBeenCalled();
  }
});

it("reports widget readiness failure in the panel", async () => {
  const { options, widget } = fixture();
  widget.ready = Promise.reject(new Error("Config unavailable"));
  const dispose = mountClanWidget(options);
  await Promise.resolve();
  expect(options.onError).toHaveBeenCalledOnce();
  dispose();
});

it("destroys once and ignores stale readiness and joined events after unmount", async () => {
  const { options, sdk, widget } = fixture();
  let resolve;
  widget.ready = new Promise((done) => {
    resolve = done;
  });
  const dispose = mountClanWidget(options);
  dispose();
  dispose();
  resolve();
  await Promise.resolve();
  options.container.dispatchEvent(new Event("clan-sdk:joined"));
  expect(widget.destroy).toHaveBeenCalledOnce();
  expect(sdk.resetPlayerSession).toHaveBeenCalledOnce();
  expect(options.onReady).not.toHaveBeenCalled();
  expect(options.onJoined).not.toHaveBeenCalled();
});
