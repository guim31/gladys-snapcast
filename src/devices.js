// -----------------------------------------------------------------------------
// Snapcast clients and streams -> Gladys devices, and the model -> states.
//
// A client (a room, a snapclient) is the device users act on, and the player
// of the Gladys "Music" dashboard box. Couples chosen among those the Gladys
// front knows (test/gladys-rules.test.js):
// - the `music` category: volume and mute of the room; play, pause,
//   previous, next (one-shot commands kept for the scenes and dashboards made
//   before Gladys 5.3); playback_state (0 paused, 1 playing, 2 idle); and the
//   "now playing" of Gladys 5.3: title, artist, album, artwork (an image key
//   served by src/artwork.js), duration, position, shuffle and repeat. What
//   plays in a room is what the stream of its group plays: these features
//   follow that stream, and the commands go to it (Stream.Control,
//   Stream.SetProperty). They are published through publishNowPlaying
//   (src/hub.js);
// - connected: presence-sensor/binary, read only;
// - stream: text/select, the streams of the server (changes the stream of the
//   client's group: Snapcast plays a stream per group);
// - now_playing: text/text, read only ("Artist – Title", kept from 1.0).
//
// Which music features a room can write depends on the streams, and a room
// can switch streams at any time: the structure follows what the server's
// streams have ever offered (remembered in /data), not the current stream,
// so it does not change each time a room changes streams. playback_state is
// writable once a stream was seen driven by a control script, position once
// one could seek; shuffle and repeat exist once such a stream reported them.
// A command a stream cannot carry out fails with a clear message.
// Before 1.1.0, mute was switch/binary: same external id, the "Update" of the
// Discover tab converts it in place (same 0/1 values).
//
// A stream (a source) is a device too: its state and what it plays, and,
// when a control script drives it, play/pause/previous/next as television
// keys (push buttons in the device box).
//
// No device per group: Snapserver deletes a group once emptied and gives a
// new id to a new one (checked on 0.31), while a Gladys external id is
// forever. The group is reached through its clients.
//
// External ids come from the Snapcast ids (client MAC or --hostID, stream id),
// never from names. Feature keys are forever, and the keys of the music
// features equal their type: the default ids of publishNowPlaying.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
} from '@gladysassistant/integration-sdk';
import { nowPlaying, positionNow, streamOfClient } from './snapcast/model.js';
import { CLIENT_NAMES, STATE_LABELS, STREAM_NAMES, pick } from './texts.js';

export const CLIENT_TYPE = 'client';
export const STREAM_TYPE = 'stream';

const MAX_TEXT = 200;

// Bound of duration and position (a day: a live stream reports none).
export const MAX_SECONDS = 86_400;

const IDLE = MUSIC_PLAYBACK_STATE.IDLE;
const SECONDS = DEVICE_FEATURE_UNITS.SECONDS;

// key -> [category, type, read_only, min, max, has_feedback, unit]. The
// entries marked below change with the capabilities (clientFeatureKeys).
export const CLIENT_FEATURES = {
  volume: [CAT.MUSIC, TYPE.MUSIC.VOLUME, false, 0, 100, true],
  mute: [CAT.MUSIC, TYPE.MUSIC.MUTE, false, 0, 1, true],
  connected: [CAT.PRESENCE_SENSOR, TYPE.SENSOR.BINARY, true, 0, 1, false],
  stream: [CAT.TEXT, TYPE.TEXT.SELECT, false, 0, 0, true],
  playback_state: [CAT.MUSIC, TYPE.MUSIC.PLAYBACK_STATE, true, 0, IDLE, false], // control
  play: [CAT.MUSIC, TYPE.MUSIC.PLAY, false, 0, 1, false],
  pause: [CAT.MUSIC, TYPE.MUSIC.PAUSE, false, 0, 1, false],
  previous: [CAT.MUSIC, TYPE.MUSIC.PREVIOUS, false, 0, 1, false],
  next: [CAT.MUSIC, TYPE.MUSIC.NEXT, false, 0, 1, false],
  now_playing: [CAT.TEXT, TYPE.TEXT.TEXT, true, 0, 0, false],
  title: [CAT.MUSIC, TYPE.MUSIC.TITLE, true, 0, 0, false],
  artist: [CAT.MUSIC, TYPE.MUSIC.ARTIST, true, 0, 0, false],
  album: [CAT.MUSIC, TYPE.MUSIC.ALBUM, true, 0, 0, false],
  artwork: [CAT.MUSIC, TYPE.MUSIC.ARTWORK, true, 0, 0, false],
  duration: [CAT.MUSIC, TYPE.MUSIC.DURATION, true, 0, MAX_SECONDS, false, SECONDS],
  position: [CAT.MUSIC, TYPE.MUSIC.POSITION, true, 0, MAX_SECONDS, false, SECONDS], // seek
  shuffle: [CAT.MUSIC, TYPE.MUSIC.SHUFFLE, false, 0, 1, true], // shuffle
  repeat: [CAT.MUSIC, TYPE.MUSIC.REPEAT, false, 0, MUSIC_REPEAT_MODE.ONE, true], // repeat
};

export const STREAM_FEATURES = {
  playback_state: [CAT.MUSIC, TYPE.MUSIC.PLAYBACK_STATE, true, 0, IDLE, false],
  now_playing: [CAT.TEXT, TYPE.TEXT.TEXT, true, 0, 0, false],
  play: [CAT.TELEVISION, TYPE.TELEVISION.PLAY, false, 0, 1, false],
  pause: [CAT.TELEVISION, TYPE.TELEVISION.PAUSE, false, 0, 1, false],
  previous: [CAT.TELEVISION, TYPE.TELEVISION.PREVIOUS, false, 0, 1, false],
  next: [CAT.TELEVISION, TYPE.TELEVISION.NEXT, false, 0, 1, false],
};

/**
 * What the streams of the server have ever offered (src/hub.js remembers it):
 * `control` (a control script), `seek`, `shuffle`, `repeat`.
 * @typedef {{ control: boolean, seek: boolean, shuffle: boolean, repeat: boolean }} Capabilities
 */
export const NO_CAPABILITIES = Object.freeze({
  control: false,
  seek: false,
  shuffle: false,
  repeat: false,
});

/** The capabilities a stream shows now. */
export function streamCapabilities(stream) {
  const control = stream?.canControl === true;
  return {
    control,
    seek: stream?.canSeek === true,
    shuffle: control && stream.shuffle !== null,
    repeat: control && stream.loopStatus !== null,
  };
}

// Published only for a stream that a control script drives.
export const STREAM_CONTROLS = ['play', 'pause', 'previous', 'next'];

/**
 * The platform id of a Snapcast id. Kept as is when already lower case
 * letters, digits and dashes (`client-1`); a client MAC becomes dashed
 * (`00:21:6a:7d:74:fc#2` -> `00-21-6a-7d-74-fc-2`, one way only). Anything else
 * (a stream name chosen by the user: `Radio FIP`, `radio fip`) gets a short
 * hash of the exact id, so two ids never share a device.
 */
export function platformIdOf(id) {
  const text = String(id);
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(text)) {
    return text;
  }
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}(#\d+)?$/.test(text)) {
    return text.replace(/[:#]/g, '-');
  }
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const hash = createHash('sha1').update(String(id)).digest('hex').slice(0, 8);
  return base === '' ? hash : `${base}-${hash}`;
}

export const clientIds = (gladys, id) => gladys.externalIds(CLIENT_TYPE, platformIdOf(id));
export const streamIds = (gladys, id) => gladys.externalIds(STREAM_TYPE, platformIdOf(id));

function features(ids, table, names, keys = Object.keys(table)) {
  return keys.map((key) => {
    const [category, type, readOnly, min, max, hasFeedback, unit] = table[key];
    const feature = {
      name: names[key],
      external_id: ids.feature(key),
      category,
      type,
      read_only: readOnly,
      has_feedback: hasFeedback,
      // A select or a text has no history worth keeping; the core forces
      // false on the music category.
      keep_history: category !== CAT.TEXT && category !== CAT.MUSIC,
      min,
      max,
    };
    if (unit) {
      feature.unit = unit;
    }
    return feature;
  });
}

/** The music features of a client, by the capabilities of the server. */
export function clientFeatureKeys(capabilities = NO_CAPABILITIES) {
  return Object.keys(CLIENT_FEATURES).filter(
    (key) =>
      (key !== 'shuffle' || capabilities.shuffle) && (key !== 'repeat' || capabilities.repeat),
  );
}

/**
 * @param {object} gladys
 * @param {object} client see src/snapcast/model.js
 * @param {object} model the whole model (for the stream options)
 * @param {string} language
 * @param {Capabilities} [capabilities]
 */
export function buildClientDevice(gladys, client, model, language, capabilities = NO_CAPABILITIES) {
  const ids = clientIds(gladys, client.id);
  const list = features(
    ids,
    CLIENT_FEATURES,
    pick(CLIENT_NAMES, language),
    clientFeatureKeys(capabilities),
  );
  const byKey = (key) => list.find((feature) => feature.external_id === ids.feature(key));
  // Writable: the player confirms every change (has_feedback).
  if (capabilities.control) {
    Object.assign(byKey('playback_state'), { read_only: false, has_feedback: true });
  }
  if (capabilities.seek) {
    Object.assign(byKey('position'), { read_only: false, has_feedback: true });
  }
  const options = [...model.streams.values()].map((stream, index) => ({
    value: stream.id,
    label: stream.name.slice(0, 60),
    sort_order: index,
  }));
  if (options.length > 0) {
    byKey('stream').supported_options = options;
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

/** The Gladys playback state of a stream (MUSIC_PLAYBACK_STATE). */
export function playbackState(stream) {
  const state = streamState(stream);
  if (state === 'playing') {
    return MUSIC_PLAYBACK_STATE.PLAYING;
  }
  return state === 'paused' ? MUSIC_PLAYBACK_STATE.PAUSED : IDLE;
}

// MPRIS loopStatus <-> MUSIC_REPEAT_MODE.
const REPEAT_FROM_LOOP = {
  none: MUSIC_REPEAT_MODE.OFF,
  playlist: MUSIC_REPEAT_MODE.ALL,
  track: MUSIC_REPEAT_MODE.ONE,
};
export const LOOP_FROM_REPEAT = {
  [MUSIC_REPEAT_MODE.OFF]: 'none',
  [MUSIC_REPEAT_MODE.ALL]: 'playlist',
  [MUSIC_REPEAT_MODE.ONE]: 'track',
};

/**
 * The snapshot given to publishNowPlaying for a client (Gladys 5.3): what the
 * stream of its group plays. Nothing loaded (a stream without audio nor
 * metadata, a client offline): the texts are cleared explicitly (an absent
 * key means "unchanged"). A stream with audio but no metadata (a plain pipe)
 * shows its name as the title, as a radio shows its station, with no
 * duration (live). A stream stopped with a track still reported keeps it on
 * screen, idle.
 * @param {object} client
 * @param {object|null} stream the stream of its group
 * @param {object} options
 * @param {Capabilities} [options.capabilities] the features the device has
 * @param {string|null} [options.artworkUrl] see src/artwork.js
 * @param {number} [options.now] ms
 */
export function clientNowPlaying(client, stream, options = {}) {
  const { capabilities = NO_CAPABILITIES, artworkUrl = null, now = Date.now() } = options;
  const heard = client.connected && stream ? stream : null;
  const state = heard ? playbackState(heard) : IDLE;
  const result = {
    playback_state: state,
    title: '',
    artist: '',
    album: '',
    artwork_url: null,
    duration: 0,
    position: 0,
  };
  if (heard && (heard.title || state !== IDLE)) {
    result.title = heard.title || heard.name;
    result.artist = heard.artist;
    result.album = heard.album;
    result.artwork_url = artworkUrl;
    result.duration = Math.min(MAX_SECONDS, Math.round(heard.duration));
    if (state !== IDLE) {
      // Unknown (no control script): left unchanged rather than a 0 the SDK
      // would see drift from its extrapolation and send again at each call.
      const position = positionNow(heard, now);
      if (position === null) {
        delete result.position;
      } else {
        result.position = position;
      }
    }
  }
  if (capabilities.shuffle) {
    result.shuffle = heard?.shuffle === true;
  }
  if (capabilities.repeat) {
    result.repeat = REPEAT_FROM_LOOP[heard?.loopStatus] ?? MUSIC_REPEAT_MODE.OFF;
  }
  if (client.volume !== null) {
    result.volume = client.volume;
  }
  result.mute = client.muted;
  return result;
}

/**
 * The states of a client outside the music category, in the publishStates
 * format (the music ones go through clientNowPlaying).
 */
export function buildClientStates(gladys, client, model, language) {
  const ids = clientIds(gladys, client.id);
  const stream = streamOfClient(model, client);
  const states = [
    { device_feature_external_id: ids.feature('connected'), state: client.connected ? 1 : 0 },
    {
      device_feature_external_id: ids.feature('now_playing'),
      text: clientText(client, model, language),
    },
  ];
  if (stream) {
    states.push({ device_feature_external_id: ids.feature('stream'), text: stream.id });
  }
  return states;
}

/** The states of a stream. */
export function buildStreamStates(gladys, stream, language) {
  const ids = streamIds(gladys, stream.id);
  return [
    { device_feature_external_id: ids.feature('playback_state'), state: playbackState(stream) },
    { device_feature_external_id: ids.feature('now_playing'), text: streamText(stream, language) },
  ];
}

/** The feature key of a feature external id (`...:client:x:volume` -> `volume`). */
export function featureKeyOf(externalId) {
  return typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
}
