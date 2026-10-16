// -----------------------------------------------------------------------------
// Snapcast clients and streams -> Gladys devices, and the model -> states.
//
// A client (a room, a snapclient) is the device users act on. Couples chosen
// among those the Gladys front knows (test/gladys-rules.test.js):
// - volume, play, pause, previous, next, playback_state: the `music` category,
//   the one the core "Music" dashboard box reads and drives (it needs all of
//   them on one device). The buttons act on the stream the client's group
//   plays (Stream.Control): an error when that stream cannot be controlled;
// - mute: switch/binary, on = muted (a toggle that shows its state);
// - connected: presence-sensor/binary, read only;
// - stream: text/select, the streams of the server (changes the stream of the
//   client's group: Snapcast plays a stream per group);
// - now_playing: text/text, read only.
//
// A stream (a source) is a device too: its state and what it plays, and,
// when a control script drives it, play/pause/previous/next as television
// keys (push buttons in the device box; music keys without a music volume
// would break the core Music box, which lists every device with music/play).
//
// No device per group: Snapserver deletes a group once emptied and gives a
// new id to a new one (checked on 0.31), while a Gladys external id is
// forever. The group is reached through its clients.
//
// External ids come from the Snapcast ids (client MAC or --hostID, stream id),
// never from names. Feature keys are forever.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
} from '@gladysassistant/integration-sdk';
import { isStreamPlaying, nowPlaying, streamOfClient } from './snapcast/model.js';
import { CLIENT_NAMES, STATE_LABELS, STREAM_NAMES, pick } from './texts.js';

export const CLIENT_TYPE = 'client';
export const STREAM_TYPE = 'stream';

const MAX_TEXT = 200;

// key -> [category, type, read_only, min, max, has_feedback]
export const CLIENT_FEATURES = {
  volume: [CAT.MUSIC, TYPE.MUSIC.VOLUME, false, 0, 100, true],
  mute: [CAT.SWITCH, TYPE.SWITCH.BINARY, false, 0, 1, true],
  connected: [CAT.PRESENCE_SENSOR, TYPE.SENSOR.BINARY, true, 0, 1, false],
  stream: [CAT.TEXT, TYPE.TEXT.SELECT, false, 0, 0, true],
  playback_state: [CAT.MUSIC, TYPE.MUSIC.PLAYBACK_STATE, true, 0, 1, false],
  play: [CAT.MUSIC, TYPE.MUSIC.PLAY, false, 0, 1, false],
  pause: [CAT.MUSIC, TYPE.MUSIC.PAUSE, false, 0, 1, false],
  previous: [CAT.MUSIC, TYPE.MUSIC.PREVIOUS, false, 0, 1, false],
  next: [CAT.MUSIC, TYPE.MUSIC.NEXT, false, 0, 1, false],
  now_playing: [CAT.TEXT, TYPE.TEXT.TEXT, true, 0, 0, false],
};

export const STREAM_FEATURES = {
  playback_state: [CAT.MUSIC, TYPE.MUSIC.PLAYBACK_STATE, true, 0, 1, false],
  now_playing: [CAT.TEXT, TYPE.TEXT.TEXT, true, 0, 0, false],
  play: [CAT.TELEVISION, TYPE.TELEVISION.PLAY, false, 0, 1, false],
  pause: [CAT.TELEVISION, TYPE.TELEVISION.PAUSE, false, 0, 1, false],
  previous: [CAT.TELEVISION, TYPE.TELEVISION.PREVIOUS, false, 0, 1, false],
  next: [CAT.TELEVISION, TYPE.TELEVISION.NEXT, false, 0, 1, false],
};

// Published only for a stream that a control script drives.
export const STREAM_CONTROLS = ['play', 'pause', 'previous', 'next'];

/**
 * The platform id of a Snapcast id: lower case, separators as dashes
 * (`00:21:6a:7d:74:fc#2` -> `00-21-6a-7d-74-fc-2`), plus a short hash when
 * characters were dropped that could tell two ids apart (accents, symbols).
 */
export function platformIdOf(id) {
  const base = String(id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base !== '' && /^[A-Za-z0-9:._# -]+$/.test(String(id))) {
    return base;
  }
  const hash = createHash('sha1').update(String(id)).digest('hex').slice(0, 8);
  return base === '' ? hash : `${base}-${hash}`;
}

export const clientIds = (gladys, id) => gladys.externalIds(CLIENT_TYPE, platformIdOf(id));
export const streamIds = (gladys, id) => gladys.externalIds(STREAM_TYPE, platformIdOf(id));

function features(ids, table, names, keys = Object.keys(table)) {
  return keys.map((key) => {
    const [category, type, readOnly, min, max, hasFeedback] = table[key];
    return {
      name: names[key],
      external_id: ids.feature(key),
      category,
      type,
      read_only: readOnly,
      has_feedback: hasFeedback,
      // A select or a text has no history worth keeping.
      keep_history: category !== CAT.TEXT,
      min,
      max,
    };
  });
}

/**
 * @param {object} gladys
 * @param {object} client see src/snapcast/model.js
 * @param {object} model the whole model (for the stream options)
 * @param {string} language
 */
export function buildClientDevice(gladys, client, model, language) {
  const ids = clientIds(gladys, client.id);
  const list = features(ids, CLIENT_FEATURES, pick(CLIENT_NAMES, language));
  const options = [...model.streams.values()].map((stream, index) => ({
    value: stream.id,
    label: stream.name.slice(0, 60),
    sort_order: index,
  }));
  if (options.length > 0) {
    list.find((feature) => feature.external_id === ids.feature('stream')).supported_options =
      options;
  }
  return {
    name: client.name.slice(0, 60),
    external_id: ids.device,
    model: 'Snapclient',
    should_poll: false,
    features: list,
    params: [{ name: 'SNAPCAST_CLIENT_ID', value: client.id }],
  };
}

/**
 * @param {object} gladys
 * @param {object} stream see src/snapcast/model.js
 * @param {boolean} controllable a control script drives it (now or before)
 * @param {string} language
 */
export function buildStreamDevice(gladys, stream, controllable, language) {
  const ids = streamIds(gladys, stream.id);
  const keys = Object.keys(STREAM_FEATURES).filter(
    (key) => controllable || !STREAM_CONTROLS.includes(key),
  );
  return {
    name: stream.name.slice(0, 60),
    external_id: ids.device,
    model: stream.scheme ? `Snapcast stream (${stream.scheme})` : 'Snapcast stream',
    should_poll: false,
    features: features(ids, STREAM_FEATURES, pick(STREAM_NAMES, language), keys),
    params: [{ name: 'SNAPCAST_STREAM_ID', value: stream.id }],
  };
}

/** playing | paused | idle | disabled | unknown */
export function streamState(stream) {
  if (!stream) {
    return 'idle';
  }
  if (stream.status === 'playing') {
    if (stream.playbackStatus === 'paused') {
      return 'paused';
    }
    return stream.playbackStatus === 'stopped' ? 'idle' : 'playing';
  }
  if (stream.status === 'idle') {
    return stream.playbackStatus === 'paused' ? 'paused' : 'idle';
  }
  return stream.status === 'disabled' ? 'disabled' : 'unknown';
}

/** What a stream plays, for a text feature or the widget (never empty). */
export function streamText(stream, language) {
  const labels = pick(STATE_LABELS, language);
  if (!stream) {
    return labels.idle;
  }
  const state = streamState(stream);
  if (state === 'playing') {
    return (nowPlaying(stream) || stream.name).slice(0, MAX_TEXT);
  }
  return `${stream.name} · ${labels[state]}`.slice(0, MAX_TEXT);
}

export function clientText(client, model, language) {
  if (!client.connected) {
    return pick(STATE_LABELS, language).offline;
  }
  return streamText(streamOfClient(model, client), language);
}

/** The states of a client, in the publishStates format. */
export function buildClientStates(gladys, client, model, language) {
  const ids = clientIds(gladys, client.id);
  const stream = streamOfClient(model, client);
  const states = [
    { device_feature_external_id: ids.feature('mute'), state: client.muted ? 1 : 0 },
    { device_feature_external_id: ids.feature('connected'), state: client.connected ? 1 : 0 },
    {
      device_feature_external_id: ids.feature('playback_state'),
      state: client.connected && isStreamPlaying(stream) ? 1 : 0,
    },
    {
      device_feature_external_id: ids.feature('now_playing'),
      text: clientText(client, model, language),
    },
  ];
  if (client.volume !== null) {
    states.push({ device_feature_external_id: ids.feature('volume'), state: client.volume });
  }
  if (stream) {
    states.push({ device_feature_external_id: ids.feature('stream'), text: stream.id });
  }
  return states;
}

/** The states of a stream. */
export function buildStreamStates(gladys, stream, language) {
  const ids = streamIds(gladys, stream.id);
  return [
    {
      device_feature_external_id: ids.feature('playback_state'),
      state: isStreamPlaying(stream) ? 1 : 0,
    },
    { device_feature_external_id: ids.feature('now_playing'), text: streamText(stream, language) },
  ];
}

/** The feature key of a feature external id (`...:client:x:volume` -> `volume`). */
export function featureKeyOf(externalId) {
  return typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
}
