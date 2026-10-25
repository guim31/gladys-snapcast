// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys
// in the tests) and returns the hub, so index.js stays a few lines and the
// tests drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Hub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'snapcast-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, connect (net.createConnection), timings,
 *   clientTimings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new Hub({ gladys, store: options.store ?? new Store(), ...options });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync();
        return;
      }
      // Started only once the configuration is read: a failure here is
      // retried at the next connection.
      const config = normalizeConfig(await gladys.getConfig());
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(
    whenReady(async () => {
      await hub.reload();
      await hub.publishDevices();
    }),
  );
  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));
  // The devices are published with should_poll: false (Snapserver pushes its
  // changes); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady(() => hub.reload()));
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  // "Update" in the Discovery tab: the SDK forgot the states, publish them again.
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));
  // Gladys 5.3 music box: the artwork of what a room plays (manifest `music`).
  gladys.onMusicGetArtwork(whenReady((key) => hub.artworkOf(key)));
  gladys.onConfigUpdated(whenReady((config) => hub.reconfigure(normalizeConfig(config))));

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields: fields ?? {} })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return { hub, ready, stop: () => hub.stop() };
}
