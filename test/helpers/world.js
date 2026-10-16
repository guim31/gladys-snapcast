// -----------------------------------------------------------------------------
// A world for the tests: the SDK's fake Gladys, the real wiring (src/app.js)
// and a scripted Snapserver on the loopback, with short timings.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { platformIdOf } from '../../src/devices.js';
import { FakeSnapserver, sleep, until } from './fakeSnapserver.js';

export const FAST = { resyncMs: 400, debounceMs: 5, reloadMs: 5 };
export const FAST_CLIENT = {
  callTimeout: 200,
  connectTimeout: 200,
  reconnectMin: 20,
  reconnectMax: 100,
};

/** A store that keeps everything in memory. */
export class MemoryStore {
  constructor(data = {}) {
    this.data = data;
  }

  async load() {
    return structuredClone(this.data);
  }

  async save(data) {
    this.data = structuredClone(data);
  }

  async flush() {}
}

export const clientId = (id) => `ext:test-integration:client:${platformIdOf(id)}`;
export const streamId = (id) => `ext:test-integration:stream:${platformIdOf(id)}`;

export async function createWorld({
  server,
  config = {},
  timings = {},
  store = new MemoryStore(),
  connect = true,
} = {}) {
  const snapserver = server ?? (await new FakeSnapserver().listen());
  const gladys = createFakeGladys({
    config: { host: '127.0.0.1', port: snapserver.port, language: 'en', ...config },
  });
  const app = registerHandlers(gladys, {
    store,
    timings: { ...FAST, ...timings },
    clientTimings: FAST_CLIENT,
  });
  if (connect) {
    await gladys.connect();
  }
  const world = {
    gladys,
    app,
    hub: app.hub,
    server: snapserver,
    store,
    async stop() {
      await app.stop();
      await snapserver.close();
    },
  };
  return world;
}

/** Waits for the first read, then "Add to Gladys" every discovered device. */
export async function createAll(world) {
  await until(() => world.gladys.fake.discoveredDevices?.length > 0, 2000, 'discovery');
  for (const device of world.gladys.fake.discoveredDevices) {
    await world.gladys.fake.deviceCreated(device);
  }
  await sleep(20);
}

export const deviceOf = (gladys, externalId) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);

export const featureOf = (gladys, externalId, key) =>
  deviceOf(gladys, externalId).features.find((f) => f.external_id === `${externalId}:${key}`);

export const state = (gladys, externalId, key) => gladys.fake.lastState(`${externalId}:${key}`);

export { sleep, until };
