// -----------------------------------------------------------------------------
// The hub: one Snapcast server, its clients and streams, and everything Gladys
// sees of them (devices, states, scene events, widget, commands).
//
// Reading: one permanent JSON-RPC connection. The whole status is read on
// each connection (Server.GetStatus), then the pushed notifications keep the
// model up to date; a full read every minute catches anything missed and
// tells a dead link from a quiet one. Only the changes reach Gladys,
// debounced: the music features of a room through publishNowPlaying (diffed
// by the SDK, Gladys 5.3), the others through publishChangedStates, with a
// heartbeat.
//
// Snapserver does not send a notification back to the connection that made
// the change: the answer of each command is applied to the model instead.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { MUSIC_PLAYBACK_STATE } from '@gladysassistant/integration-sdk';
import { Artwork } from './artwork.js';
import {
  CLIENT_TYPE,
  LOOP_FROM_REPEAT,
  STREAM_TYPE,
  buildClientDevice,
  buildClientStates,
  buildStreamDevice,
  buildStreamStates,
  clientIds,
  clientNowPlaying,
  featureKeyOf,
  streamCapabilities,
  streamIds,
} from './devices.js';
import { SnapcastClient, SnapcastError } from './snapcast/client.js';
import {
  applyNotification,
  isStreamPlaying,
  nowPlaying,
  parseServer,
  streamOfClient,
} from './snapcast/model.js';
import { STATUS_TEXT, commandMessage } from './texts.js';

const logger = createLogger({ name: 'snapcast-hub' });

export const WIDGET_KEY = 'rooms';

export const TRIGGERS = {
  CLIENT_CONNECTED: 'client_connected',
  CLIENT_DISCONNECTED: 'client_disconnected',
  STREAM_STARTED: 'stream_started',
  STREAM_STOPPED: 'stream_stopped',
};

export const TIMINGS = {
  resyncMs: 60_000, // a full read: missed notifications, dead link
  debounceMs: 200, // a volume slider is a burst of notifications
  reloadMs: 100, // a notification the model cannot follow
};

// A stable value is re-published every 6 hours (the front greys out a value
// older than 48 h).
const HEARTBEAT_MS = 6 * 60 * 60_000;

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;

// Stream.Control commands, by the key of the scene action and the features.
export const STREAM_COMMANDS = {
  play: 'play',
  pause: 'pause',
  play_pause: 'playPause',
  next: 'next',
  previous: 'previous',
  stop: 'stop',
};

// playback_state written by the Gladys 5.3 music box -> Stream.Control.
const PLAYBACK_COMMANDS = {
  [MUSIC_PLAYBACK_STATE.PAUSED]: 'pause',
  [MUSIC_PLAYBACK_STATE.PLAYING]: 'play',
  [MUSIC_PLAYBACK_STATE.IDLE]: 'stop',
};

// What the streams have shown, remembered by stream id (src/store.js).
const CAPABILITY_KEYS = ['shuffle', 'repeat'];

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language = 'en') {
    const messages = commandMessage(code);
    super(messages[language] ?? messages.en);
    this.code = code;
    this.messages = messages;
  }
}

const emptyModel = () => ({
  version: '',
  clients: new Map(),
  groups: new Map(),
  streams: new Map(),
});

export class Hub {
  /**
   * @param {{ gladys: object, store?: object, connect?: Function,
   *   timings?: object, clientTimings?: object, now?: () => number,
   *   fetch?: Function }} options
   */
  constructor({ gladys, store, connect, timings, clientTimings, now, fetch }) {
    this.gladys = gladys;
    this.store = store ?? null;
    this.connect = connect;
    this.timings = { ...TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now ?? Date.now;
    this.config = null;
    this.client = null;
    this.model = emptyModel();
    this.online = false; // the model reflects a live server
    this.serverError = undefined; // undefined: never tried; null: fine; else the reason
    this.lastStatus = null;
    this.controllable = new Set(); // stream ids seen driven by a control script
    // stream ids seen reporting shuffle / repeat
    this.capable = { shuffle: new Set(), repeat: new Set() };
    this.artwork = new Artwork({ fetch });
    this.devicesFingerprint = null;
    this.widgetFingerprint = null;
    this.seen = null; // { clients: Map<id, connected>, streams: Map<id, playing> }
    this.publishFailing = false;
    this.resyncTimer = null;
    this.changeTimer = null;
    this.reloadTimer = null;
    this.reloading = null;
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.stopped = false;
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  // --- Lifecycle -----------------------------------------------------------

  async start(config) {
    // A configuration update may have set a client up before a failed start.
    this.#teardown();
    this.config = config;
    const saved = (await this.store?.load()) ?? {};
    const remembered = (list, set) => {
      for (const id of Array.isArray(list) ? list : []) {
        if (typeof id === 'string') {
          set.add(id);
        }
      }
    };
    remembered(saved.controllable, this.controllable);
    for (const key of CAPABILITY_KEYS) {
      remembered(saved[key], this.capable[key]);
    }
    this.#setup();
  }

  /** The configuration changed: new server or language. */
  async reconfigure(config) {
    const sameServer =
      this.config && this.config.host === config.host && this.config.port === config.port;
    this.config = config;
    if (sameServer && this.client) {
      // The language only: the feature names and the texts follow it.
      this.devicesFingerprint = null;
      this.#changed();
      return;
    }
    this.#teardown();
    // The rooms of the old server go offline in Gladys, rather than keep
    // "playing" forever.
    await this.publishStates();
    this.model = emptyModel();
    this.seen = null;
    this.serverError = undefined;
    this.devicesFingerprint = null;
    this.#setup();
  }

  /** Gladys came back: it may have lost the discovered devices and states. */
  async resync() {
    this.gladys.forgetPublishedStates?.();
    this.devicesFingerprint = null;
    if (this.online) {
      await this.reload();
    }
    await this.publishDevices();
  }

  async stop() {
    this.stopped = true;
    this.#teardown();
    clearTimeout(this.widgetTimer);
    await this.store?.flush();
  }

  #teardown() {
    clearTimeout(this.resyncTimer);
    clearTimeout(this.changeTimer);
    clearTimeout(this.reloadTimer);
    this.resyncTimer = null;
    this.changeTimer = null;
    this.reloadTimer = null;
    // Listeners off first: a deliberate stop is not a lost server.
    this.client?.removeAllListeners();
    this.client?.stop();
    this.client = null;
    this.online = false;
  }

  #setup() {
    const config = this.config;
    if (!config.configured || !config.valid) {
      this.#setStatus(false, config.configured ? 'invalid_host' : 'not_configured');
      if (config.configured) {
        logger.warn('The server address is not valid');
      }
      return;
    }
    const client = new SnapcastClient({
      host: config.host,
      port: config.port,
      connect: this.connect,
      timings: this.clientTimings,
    });
    client.on('open', () => this.#onOpen(client));
    client.on('close', (reason) => this.#onLost(client, reason));
    client.on('failed', (reason) => this.#onFailed(client, reason));
    client.on('notification', (method, params) => this.#onNotification(client, method, params));
    this.client = client;
    client.start();
  }

  // --- Server side ---------------------------------------------------------

  async #onOpen(client) {
    const ok = await this.reload();
    if (client !== this.client) {
      return;
    }
    // Even after a failed first read: the next one is a minute away.
    this.#scheduleResync();
    if (!ok) {
      return;
    }
    const { clients, streams, version } = this.model;
    logger.info(
      `Connected to Snapserver ${version || ''} at ${client.address} (${clients.size} clients, ${streams.size} streams)`.replace(
        /\s+/g,
        ' ',
      ),
    );
  }

  #onLost(client, reason) {
    if (client !== this.client) {
      return;
    }
    clearTimeout(this.resyncTimer);
    const wasOnline = this.online;
    this.online = false;
    this.serverError = reason;
    // One line when a working server goes, not one per failed attempt.
    if (wasOnline) {
      logger.warn(`Connection to the Snapcast server lost (${reason}), reconnecting`);
    } else {
      logger.debug(`Connection to the Snapcast server closed again (${reason})`);
    }
    this.#setStatus(false, 'unreachable');
    // The reference of the next read: no scene event for what changed while
    // the server was away.
    this.seen = null;
    this.#changed();
  }

  #onFailed(client, reason) {
    if (client !== this.client) {
      return;
    }
    if (this.serverError === undefined || this.serverError === null) {
      logger.warn(`Snapcast server unreachable at ${client.address} (${reason})`);
    } else {
      logger.debug(`Snapcast server still unreachable (${reason})`);
    }
    this.serverError = reason;
    this.#setStatus(false, 'unreachable');
  }

  #onNotification(client, method, params) {
    if (client !== this.client || !this.online) {
      return;
    }
    logger.debug(`Notification ${method}`);
    if (applyNotification(this.model, method, params, this.now()) === 'reload') {
      this.#reloadSoon();
      return;
    }
    this.#changed();
  }

  /** Reads the whole status; resolves false when the server did not answer. */
  reload() {
    if (this.reloading) {
      return this.reloading;
    }
    const client = this.client;
    this.reloading = (async () => {
      if (!client?.live) {
        return false;
      }
      try {
        const result = await client.call('Server.GetStatus');
        if (client !== this.client) {
          return false;
        }
        // A first read (start, new server): the position samples it finds
        // have no known instant.
        const previous = this.model.streams.size > 0 ? this.model : null;
        const model = parseServer(result?.server, previous, this.now());
        client.healthy();
        this.model = model;
        this.online = true;
        if (this.serverError !== null && this.serverError !== undefined) {
          logger.debug('Snapcast server back');
        }
        this.serverError = null;
        this.#setStatus(true);
        this.#changed({ now: true });
        return true;
      } catch (err) {
        if (client === this.client && err instanceof SnapcastError && err.code === 'unreachable') {
          // A connection that does not answer is a dead one.
          client.reset('no answer');
        } else if (client === this.client) {
          logger.warn(`Cannot read the Snapcast server: ${err.message}`);
        }
        return false;
      }
    })().finally(() => {
      this.reloading = null;
    });
    return this.reloading;
  }

  #reloadSoon() {
    if (this.reloadTimer) {
      return;
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.reload();
    }, this.timings.reloadMs);
    this.reloadTimer.unref?.();
  }

  #scheduleResync() {
    clearTimeout(this.resyncTimer);
    if (this.stopped || !this.client) {
      return;
    }
    const client = this.client;
    this.resyncTimer = setTimeout(async () => {
      await this.reload();
      if (client === this.client && client.live) {
        this.#scheduleResync();
      }
    }, this.timings.resyncMs);
    this.resyncTimer.unref?.();
  }

  async #setStatus(connected, code = null) {
    const fingerprint = `${connected}:${code}`;
    if (this.lastStatus === fingerprint) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, code ? STATUS_TEXT[code] : undefined);
    } catch (err) {
      this.lastStatus = null;
      logger.debug(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Changes -> Gladys -----------------------------------------------------

  /** Something changed: devices, states, scene events, widget (debounced). */
  #changed({ now = false } = {}) {
    clearTimeout(this.changeTimer);
    this.changeTimer = null;
    if (now) {
      this.#flush();
      return;
    }
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.#flush();
    }, this.timings.debounceMs);
    this.changeTimer.unref?.();
  }

  #flush() {
    if (this.stopped) {
      return;
    }
    this.#rememberCapabilities();
    this.#fireTriggers();
    const fingerprint = JSON.stringify(this.buildDevices());
    if (fingerprint !== this.devicesFingerprint) {
      this.devicesFingerprint = fingerprint;
      this.publishDevices();
    }
    this.publishStates();
    const visible = this.#widgetFingerprint();
    if (visible !== this.widgetFingerprint) {
      this.widgetFingerprint = visible;
      this.refreshWidget();
    }
  }

  #rememberCapabilities() {
    let added = false;
    const add = (set, id) => {
      if (!set.has(id)) {
        set.add(id);
        added = true;
      }
    };
    for (const stream of this.model.streams.values()) {
      const shown = streamCapabilities(stream);
      if (stream.canControl) {
        add(this.controllable, stream.id);
      }
      for (const key of CAPABILITY_KEYS) {
        if (shown[key]) {
          add(this.capable[key], stream.id);
        }
      }
    }
    if (added) {
      const data = { controllable: [...this.controllable] };
      for (const key of CAPABILITY_KEYS) {
        data[key] = [...this.capable[key]];
      }
      this.store?.save(data);
    }
  }

  /**
   * What the streams of the server have ever offered (the ones still there):
   * the structure of the room devices follows it, not the current stream.
   */
  capabilities() {
    const ids = [...this.model.streams.keys()];
    const any = (set) => ids.some((id) => set.has(id));
    return { shuffle: any(this.capable.shuffle), repeat: any(this.capable.repeat) };
  }

  /** Scene events: a client (dis)connects, a stream starts or stops. */
  #fireTriggers() {
    if (!this.online) {
      return;
    }
    const now = {
      clients: new Map([...this.model.clients.values()].map((c) => [c.id, c.connected])),
      streams: new Map([...this.model.streams.values()].map((s) => [s.id, isStreamPlaying(s)])),
    };
    const before = this.seen;
    this.seen = now;
    if (!before) {
      return; // first read after a connection: the reference
    }
    for (const client of this.model.clients.values()) {
      const was = before.clients.get(client.id);
      if (was === undefined || was === client.connected) {
        continue;
      }
      logger.info(`Client ${client.name} ${client.connected ? 'connected' : 'disconnected'}`);
      this.#fire(
        client.connected ? TRIGGERS.CLIENT_CONNECTED : TRIGGERS.CLIENT_DISCONNECTED,
        clientIds(this.gladys, client.id).device,
        { client: this.clientName(client) },
      );
    }
    for (const stream of this.model.streams.values()) {
      const was = before.streams.get(stream.id);
      const playing = now.streams.get(stream.id);
      if (was === undefined || was === playing) {
        continue;
      }
      this.#fire(
        playing ? TRIGGERS.STREAM_STARTED : TRIGGERS.STREAM_STOPPED,
        streamIds(this.gladys, stream.id).device,
        {
          stream: this.streamName(stream).slice(0, 200),
          title: (stream.title || '').slice(0, 200),
          artist: (stream.artist || '').slice(0, 200),
        },
      );
    }
  }

  #fire(key, device, data) {
    logger.debug(`Scene event ${key}`);
    Promise.resolve(this.gladys.publishSceneEvent(key, { device, ...data })).catch((err) => {
      logger.warn(`Cannot fire ${key}: ${err.message}`);
    });
  }

  #created(externalId) {
    return (this.gladys.devices ?? []).find((device) => device.external_id === externalId);
  }

  /** The name of the client in Gladys (the user may have renamed it). */
  clientName(client) {
    return this.#created(clientIds(this.gladys, client.id).device)?.name ?? client.name;
  }

  streamName(stream) {
    return this.#created(streamIds(this.gladys, stream.id).device)?.name ?? stream.name;
  }

  buildDevices() {
    const { clients, streams } = this.model;
    const capabilities = this.capabilities();
    return [
      ...[...clients.values()].map((client) =>
        buildClientDevice(this.gladys, client, this.model, this.language, capabilities),
      ),
      ...[...streams.values()].map((stream) =>
        buildStreamDevice(this.gladys, stream, this.controllable.has(stream.id), this.language),
      ),
    ];
  }

  async publishDevices() {
    if (!this.client || this.model.clients.size + this.model.streams.size === 0) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      this.devicesFingerprint = null;
      logger.error('Cannot publish the devices', err);
    }
  }

  /** States of the devices added in Gladys, only what changed. */
  async publishStates() {
    const created = new Set((this.gladys.devices ?? []).map((device) => device.external_id));
    const states = [];
    const players = [];
    const capabilities = this.capabilities();
    const now = this.now();
    for (const client of this.model.clients.values()) {
      const device = clientIds(this.gladys, client.id).device;
      if (created.has(device)) {
        const offline = this.online ? client : { ...client, connected: false };
        states.push(...buildClientStates(this.gladys, offline, this.model, this.language));
        const stream = offline.connected ? streamOfClient(this.model, offline) : null;
        players.push([
          device,
          clientNowPlaying(offline, stream, {
            capabilities,
            artworkUrl: this.artwork.urlOf(stream),
            now,
          }),
        ]);
      }
    }
    if (this.online) {
      for (const stream of this.model.streams.values()) {
        if (created.has(streamIds(this.gladys, stream.id).device)) {
          states.push(...buildStreamStates(this.gladys, stream, this.language));
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      for (const [device, nowPlaying] of players) {
        await this.gladys.publishNowPlaying(device, nowPlaying);
      }
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      if (this.publishFailing) {
        this.publishFailing = false;
        logger.info('States published again');
      }
    } catch (err) {
      const log = this.publishFailing ? logger.debug : logger.warn;
      this.publishFailing = true;
      log(`Cannot publish the states: ${err.message}`);
    }
  }

  /**
   * onMusicGetArtwork: the bytes of an artwork whose source publishNowPlaying
   * recorded (artworkKey), made small enough for the core.
   * @param {string} key
   * @returns {Promise<string>} raw base64
   */
  async artworkOf(key) {
    const url = this.gladys.artworkUrls?.get(key);
    if (url === undefined) {
      throw new Error(`Unknown artwork ${key}`);
    }
    try {
      return (await this.artwork.read(url)).toString('base64');
    } catch (err) {
      logger.debug(`Artwork ${key}: ${err.message}`);
      throw new Error(`Artwork ${key}: ${err.message}`, { cause: err });
    }
  }

  /** A device was added in Gladys: its states, now that its features exist. */
  async onDeviceCreated() {
    await this.publishStates();
    this.refreshWidget(true);
  }

  #widgetFingerprint() {
    const clients = [...this.model.clients.values()].map((client) => {
      const stream = streamOfClient(this.model, client);
      return [client.name, client.connected, client.volume, client.muted, client.groupId].concat(
        stream ? [stream.id, isStreamPlaying(stream), nowPlaying(stream), stream.canControl] : [],
      );
    });
    return JSON.stringify([this.online, clients]);
  }

  refreshWidget(force = false) {
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0 || force) {
      clearTimeout(this.widgetTimer);
      this.widgetTimer = null;
      this.widgetRefreshAt = this.now();
      Promise.resolve(this.gladys.requestWidgetRefresh(WIDGET_KEY)).catch(() => {});
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- Commands --------------------------------------------------------------

  /** `{ kind: 'client'|'stream', item }` of a device external id, or null. */
  find(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    for (const client of this.model.clients.values()) {
      if (clientIds(this.gladys, client.id).device === externalId) {
        return { kind: CLIENT_TYPE, item: client };
      }
    }
    for (const stream of this.model.streams.values()) {
      if (streamIds(this.gladys, stream.id).device === externalId) {
        return { kind: STREAM_TYPE, item: stream };
      }
    }
    return null;
  }

  #ready() {
    if (!this.client) {
      throw new CommandError('not_configured', this.language);
    }
    if (!this.online) {
      throw new CommandError('unreachable', this.language);
    }
  }

  /** The client of a device external id, or a CommandError. */
  clientOf(externalId) {
    this.#ready();
    const found = this.find(externalId);
    if (!found) {
      throw new CommandError('unknown_device', this.language);
    }
    if (found.kind !== CLIENT_TYPE) {
      throw new CommandError('not_client', this.language);
    }
    return found.item;
  }

  /** The stream of a stream device, or the stream a client hears. */
  streamOf(externalId) {
    this.#ready();
    const found = this.find(externalId);
    if (!found) {
      throw new CommandError('unknown_device', this.language);
    }
    if (found.kind === STREAM_TYPE) {
      return found.item;
    }
    const stream = streamOfClient(this.model, found.item);
    if (!stream) {
      throw new CommandError('no_stream', this.language);
    }
    return stream;
  }

  /** One call, errors turned into coded messages, the answer applied. */
  async call(method, params) {
    this.#ready();
    let result;
    try {
      result = await this.client.call(method, params);
    } catch (err) {
      if (err instanceof SnapcastError) {
        logger.warn(`${method} failed: ${err.message}`);
        throw new CommandError(err.code === 'rpc' ? 'rpc' : 'unreachable', this.language);
      }
      throw err;
    }
    // The server does not notify the connection that made the change.
    const echo = {
      'Client.SetVolume': () => ['Client.OnVolumeChanged', { id: params.id, ...result }],
      'Group.SetStream': () => ['Group.OnStreamChanged', { id: params.id, ...result }],
      'Group.SetClients': () => ['Server.OnUpdate', result],
    }[method];
    if (echo) {
      const [notification, data] = echo();
      if (applyNotification(this.model, notification, data, this.now()) === 'reload') {
        this.#reloadSoon();
      } else {
        this.#changed();
      }
    }
    return result;
  }

  async setVolume(client, volume) {
    const value = Number(volume);
    if (volume === null || volume === '' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new CommandError('bad_volume', this.language);
    }
    const percent = Math.round(value);
    await this.call('Client.SetVolume', {
      id: client.id,
      volume: { percent, muted: client.muted },
    });
    logger.info(`${client.name}: volume ${percent}`);
  }

  async setMute(client, muted) {
    const volume = { muted: Boolean(muted) };
    if (client.volume !== null) {
      volume.percent = client.volume;
    }
    await this.call('Client.SetVolume', { id: client.id, volume });
    logger.info(`${client.name}: ${muted ? 'muted' : 'unmuted'}`);
  }

  /** Mutes or unmutes every client; returns how many changed. */
  async muteAll(muted) {
    this.#ready();
    muted = Boolean(muted);
    const targets = [...this.model.clients.values()].filter((c) => c.muted !== muted);
    for (const client of targets) {
      await this.call('Client.SetVolume', {
        id: client.id,
        volume: client.volume === null ? { muted } : { muted, percent: client.volume },
      });
    }
    logger.info(`${muted ? 'Muted' : 'Unmuted'} ${targets.length} clients`);
    return targets.length;
  }

  /** The client's group plays another stream (the whole group follows). */
  async setStream(client, streamId) {
    const stream = this.model.streams.get(streamId);
    if (!stream) {
      throw new CommandError('unknown_device', this.language);
    }
    await this.call('Group.SetStream', { id: client.groupId, stream_id: stream.id });
    logger.info(`${client.name}: stream ${stream.name}`);
  }

  /** The next stream of the server, in its order (the widget button). */
  async nextStream(client) {
    const ids = [...this.model.streams.keys()];
    const current = streamOfClient(this.model, client)?.id;
    if (ids.length === 0) {
      throw new CommandError('no_stream', this.language);
    }
    await this.setStream(client, ids[(ids.indexOf(current) + 1) % ids.length]);
  }

  async controlStream(stream, command) {
    const order = STREAM_COMMANDS[command];
    if (!order) {
      throw new CommandError('bad_command', this.language);
    }
    if (!stream.canControl) {
      throw new CommandError('not_controllable', this.language);
    }
    await this.call('Stream.Control', { id: stream.id, command: order });
    logger.info(`${stream.name}: ${command}`);
  }

  /** playback_state written: 0 pause, 1 play, 2 stop (3, buffering, is reported only). */
  async setPlayback(stream, value) {
    const command = PLAYBACK_COMMANDS[Number(value)];
    if (!command) {
      throw new CommandError('bad_command', this.language);
    }
    return this.controlStream(stream, command);
  }

  /** position written: a seek, in seconds from the start of the track. */
  async seek(stream, value) {
    const position = Number(value);
    if (value === null || value === '' || !Number.isFinite(position) || position < 0) {
      throw new CommandError('bad_command', this.language);
    }
    if (!stream.canSeek) {
      throw new CommandError('not_seekable', this.language);
    }
    await this.call('Stream.Control', {
      id: stream.id,
      command: 'setPosition',
      params: { position: Math.round(position) },
    });
    logger.info(`${stream.name}: seek to ${Math.round(position)} s`);
  }

  /** shuffle or repeat written: Stream.SetProperty (shuffle, loopStatus). */
  async setStreamProperty(stream, key, value) {
    if (!stream.canControl) {
      throw new CommandError('not_controllable', this.language);
    }
    let property;
    let wanted;
    if (key === 'shuffle') {
      property = 'shuffle';
      wanted = Number(value) === 1;
    } else {
      property = 'loopStatus';
      wanted = LOOP_FROM_REPEAT[Number(value)];
      if (!wanted) {
        throw new CommandError('bad_command', this.language);
      }
    }
    await this.call('Stream.SetProperty', { id: stream.id, property, value: wanted });
    logger.info(`${stream.name}: ${property} ${wanted}`);
  }

  /** `client` joins the group of `target`. */
  async join(client, target) {
    if (client.id === target.id) {
      throw new CommandError('same_client', this.language);
    }
    const group = this.model.groups.get(target.groupId);
    if (!group || group.clientIds.includes(client.id)) {
      return;
    }
    await this.call('Group.SetClients', { id: group.id, clients: [...group.clientIds, client.id] });
    logger.info(`${client.name} joins ${target.name}`);
  }

  /** `client` leaves its group: Snapserver puts it in a group of its own. */
  async leave(client) {
    const group = this.model.groups.get(client.groupId);
    if (!group || group.clientIds.length <= 1) {
      return;
    }
    await this.call('Group.SetClients', {
      id: group.id,
      clients: group.clientIds.filter((id) => id !== client.id),
    });
    logger.info(`${client.name} leaves its group`);
  }

  /** onSetValue: a control of a device box, or of the core Music box. */
  async setValue(device, feature, value) {
    const found = this.find(device?.external_id);
    const key = featureKeyOf(feature?.external_id);
    if (found?.kind === STREAM_TYPE) {
      return this.controlStream(this.streamOf(device.external_id), key);
    }
    const client = this.clientOf(device?.external_id);
    switch (key) {
      case 'volume':
        return this.setVolume(client, value);
      // music/mute since 1.1.0, switch/binary before the "Update": 0/1 both.
      case 'mute':
        return this.setMute(client, Number(value) === 1);
      case 'playback_state':
        return this.setPlayback(this.streamOf(device.external_id), value);
      case 'position':
        return this.seek(this.streamOf(device.external_id), value);
      case 'shuffle':
      case 'repeat':
        return this.setStreamProperty(this.streamOf(device.external_id), key, value);
      case 'stream':
        return this.setStream(client, String(value));
      case 'play':
      case 'pause':
      case 'previous':
      case 'next':
        return this.controlStream(this.streamOf(device.external_id), key);
      default:
        throw new Error(`Unknown feature ${key}`);
    }
  }
}
