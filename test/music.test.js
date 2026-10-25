// -----------------------------------------------------------------------------
// The Gladys 5.3 music player: the "now playing" of a room is what the stream
// of its group plays, published through publishNowPlaying; the commands of
// the music box go to that stream; the artwork is served from what the
// control script reported (a URL or embedded bytes).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import {
  MUSIC_PLAYBACK_STATE as PLAYBACK,
  MUSIC_REPEAT_MODE as REPEAT,
} from '@gladysassistant/integration-sdk';
import { Artwork } from '../src/artwork.js';
import { clientNowPlaying } from '../src/devices.js';
import { parseServer, positionNow } from '../src/snapcast/model.js';
import { FakeSnapserver, KITCHEN, LIVING, MUSIC, RADIO, STATUS } from './helpers/fakeSnapserver.js';
import {
  clientId,
  createAll,
  createWorld,
  deviceOf,
  featureOf,
  state,
  streamId,
  until,
} from './helpers/world.js';

const LIVING_ID = clientId(LIVING);
const KITCHEN_ID = clientId(KITCHEN);
const MUSIC_ID = streamId(MUSIC);

async function ready(options) {
  const world = await createWorld(options);
  await createAll(world);
  await until(() => state(world.gladys, LIVING_ID, 'connected') === 1, 2000, 'states');
  return world;
}

const setValue = (world, id, key, value) =>
  world.gladys.fake.setValue(deviceOf(world.gladys, id), featureOf(world.gladys, id, key), value);

/** A command Gladys sends: resolves the ack, throws its error. */
async function command(world, id, key, value) {
  const ack = await setValue(world, id, key, value);
  if (!ack.success) {
    throw new Error(ack.error);
  }
}

/** A PNG of random pixels, stored uncompressed: large on purpose. */
function noisePng(size) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // depth
  header[9] = 2; // RGB
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let i = 0; i < rows.length; i += 1) {
    rows[i] = i % (size * 3 + 1) === 0 ? 0 : (i * 7919) % 251;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('a room is a Gladys 5.3 player: music features, with feedback when writable', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  await until(() => world.gladys.fake.discoveredDevices?.length === 4, 2000, 'devices');
  const feature = (key) => featureOf(world.gladys, LIVING_ID, key);

  for (const key of ['title', 'artist', 'album', 'artwork', 'duration', 'position', 'mute']) {
    assert.equal(feature(key).category, 'music', key);
    assert.equal(feature(key).type, key, `${key}: the key is the type (publishNowPlaying ids)`);
  }
  assert.equal(feature('duration').unit, 'seconds');
  // Writable on every room: the core leaves read_only out of the structure
  // it compares, so it could never become writable later.
  assert.deepEqual(
    [feature('playback_state').read_only, feature('playback_state').max],
    [false, PLAYBACK.IDLE],
  );
  assert.equal(feature('playback_state').has_feedback, true);
  assert.equal(feature('position').read_only, false);
  // The Music stream has a control script and reports shuffle and loopStatus.
  assert.equal(feature('shuffle').read_only, false);
  assert.equal(feature('repeat').max, REPEAT.ONE);
  for (const f of deviceOf(world.gladys, LIVING_ID).features) {
    if (
      f.category === 'music' &&
      !f.read_only &&
      !['play', 'pause', 'previous', 'next'].includes(f.type)
    ) {
      assert.equal(f.has_feedback, true, `${f.type}: writable music feature with feedback`);
    }
  }
  // The stream device keeps its 1.0 features; idle is 2 now.
  assert.equal(featureOf(world.gladys, MUSIC_ID, 'playback_state').max, PLAYBACK.IDLE);
  assert.equal(featureOf(world.gladys, MUSIC_ID, 'title'), undefined);
});

test('a server whose streams have no control script: no shuffle nor repeat', async (t) => {
  const server = new FakeSnapserver();
  const music = server.stream(MUSIC);
  music.properties = { ...STATUS.server.streams[0].properties };
  await server.listen();
  const world = await createWorld({ server });
  t.after(() => world.stop());
  await until(() => world.gladys.fake.discoveredDevices?.length === 4, 2000, 'devices');
  const keys = deviceOf(world.gladys, LIVING_ID).features.map((f) =>
    f.external_id.split(':').at(-1),
  );
  assert.ok(!keys.includes('shuffle') && !keys.includes('repeat'), keys.join());
  assert.ok(keys.includes('playback_state') && keys.includes('position'));
});

test('now playing: what the stream of the room plays, cleared when nothing is', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  const now = (id = LIVING_ID) =>
    Object.fromEntries(
      [
        'playback_state',
        'title',
        'artist',
        'album',
        'artwork',
        'duration',
        'position',
        'volume',
        'mute',
      ].map((key) => [key, state(gladys, id, key)]),
    );

  // The living room hears Radio: a pipe with audio and no metadata.
  assert.deepEqual(now(), {
    playback_state: PLAYBACK.PLAYING,
    title: 'Radio',
    artist: '',
    album: '',
    artwork: '',
    duration: 0,
    position: undefined, // unknown: never published as a 0 that drifts
    volume: 100,
    mute: 0,
  });

  // Music: no audio, but the control script still reports a track.
  server.setGroupStream(LIVING, MUSIC);
  await until(() => state(gladys, LIVING_ID, 'title') === 'Track 1', 2000, 'Music');
  assert.equal(state(gladys, LIVING_ID, 'playback_state'), PLAYBACK.IDLE);
  assert.equal(state(gladys, LIVING_ID, 'artist'), 'Test Artist');
  assert.equal(state(gladys, LIVING_ID, 'album'), 'Test Album');
  assert.equal(state(gladys, LIVING_ID, 'shuffle'), 0);
  assert.equal(state(gladys, LIVING_ID, 'repeat'), REPEAT.OFF);

  // It plays a track with a cover, 42 s in.
  const cover = 'http://mopidy.local:6680/local/abc-500x500.jpeg';
  server.setStreamStatus(MUSIC, 'playing');
  server.setStreamProperties(MUSIC, {
    playbackStatus: 'playing',
    position: 42,
    shuffle: true,
    loopStatus: 'track',
    metadata: {
      title: 'So What',
      artist: ['Miles Davis'],
      album: 'Kind of Blue',
      duration: 562.4,
      artUrl: cover,
    },
  });
  await until(() => state(gladys, LIVING_ID, 'title') === 'So What', 2000, 'track');
  assert.equal(state(gladys, LIVING_ID, 'playback_state'), PLAYBACK.PLAYING);
  assert.equal(state(gladys, LIVING_ID, 'duration'), 562);
  assert.equal(state(gladys, LIVING_ID, 'position'), 42);
  assert.equal(state(gladys, LIVING_ID, 'artwork'), gladys.artworkKey(cover));
  assert.equal(state(gladys, LIVING_ID, 'shuffle'), 1);
  assert.equal(state(gladys, LIVING_ID, 'repeat'), REPEAT.ONE);

  // A volume change sends the volume alone (the SDK diffs the snapshot).
  const before = gladys.fake.states.length;
  server.setVolume(LIVING, 30);
  await until(() => state(gladys, LIVING_ID, 'volume') === 30, 2000, 'volume');
  const sent = gladys.fake.states
    .slice(before)
    .map((s) => s.device_feature_external_id.split(':').at(-1));
  assert.ok(!sent.includes('position') && !sent.includes('title'), sent.join());

  // The room goes offline: nothing plays there any more.
  server.setConnected(LIVING, false);
  await until(() => state(gladys, LIVING_ID, 'title') === '', 2000, 'cleared');
  assert.deepEqual(
    ['playback_state', 'artist', 'album', 'artwork'].map((key) => state(gladys, LIVING_ID, key)),
    [PLAYBACK.IDLE, '', '', ''],
  );
  assert.equal(
    state(gladys, KITCHEN_ID, 'playback_state'),
    PLAYBACK.PLAYING,
    'the kitchen still hears Radio',
  );
});

test('the position is a sample: extrapolated while playing, kept across a full read', () => {
  const status = structuredClone(STATUS.server);
  const music = status.streams.find((s) => s.id === MUSIC);
  music.status = 'playing';
  Object.assign(music.properties, { position: 10, metadata: { title: 'A', duration: 60 } });
  // A sample that arrives while the integration runs (not a first read).
  const first = parseServer(status, { streams: new Map() }, 1_000_000);
  // A minute later, the server reports the same sample: still 10 s at the
  // first instant, so 70 s now (bounded by the duration: 60).
  const later = parseServer(status, first, 1_030_000);
  assert.equal(positionNow(later.streams.get(MUSIC), 1_030_000), 40);
  assert.equal(positionNow(later.streams.get(MUSIC), 1_090_000), 60);
  // A new sample (a seek) starts again from its own instant.
  music.properties.position = 5;
  const seeked = parseServer(status, later, 1_040_000);
  assert.equal(positionNow(seeked.streams.get(MUSIC), 1_041_000), 6);
  // Paused: frozen.
  music.properties.playbackStatus = 'paused';
  const paused = parseServer(status, seeked, 1_050_000);
  assert.equal(positionNow(paused.streams.get(MUSIC), 1_090_000), 5);
  // No position reported: unknown, not 0.
  assert.equal(positionNow(paused.streams.get(RADIO)), null);
  // The audio stops while the script still says playing: a new sample.
  music.properties.playbackStatus = 'playing';
  const playing = parseServer(status, paused, 1_060_000);
  music.status = 'idle';
  const gap = parseServer(status, playing, 1_070_000);
  assert.equal(gap.streams.get(MUSIC).positionAt, 1_070_000);
});

test('a sample found by the first read has no known instant: the position is left unchanged', () => {
  const status = structuredClone(STATUS.server);
  const music = status.streams.find((s) => s.id === MUSIC);
  music.status = 'playing';
  Object.assign(music.properties, { position: 10, metadata: { title: 'A', duration: 60 } });
  const first = parseServer(status, null, 1_000_000);
  assert.equal(first.streams.get(MUSIC).positionAt, null);
  assert.equal(positionNow(first.streams.get(MUSIC), 1_030_000), null);
  // Still unknown at the next full read, known once the script sends one.
  const again = parseServer(status, first, 1_010_000);
  assert.equal(again.streams.get(MUSIC).positionAt, null);
  music.properties.position = 12;
  const fresh = parseServer(status, again, 1_020_000);
  assert.equal(positionNow(fresh.streams.get(MUSIC), 1_021_000), 13);
  const client = { connected: true, volume: 50, muted: false };
  const now = clientNowPlaying(client, again.streams.get(MUSIC), { now: 1_030_000 });
  assert.equal(now.position, undefined, 'unchanged in Gladys, where it was right');
  assert.equal(now.duration, 60);
});

test('a source with a duration but never a position (librespot): live, no progress bar', () => {
  const stream = {
    name: 'Spotify',
    status: 'playing',
    playbackStatus: null,
    title: 'Song',
    artist: 'Band',
    album: '',
    duration: 215,
    position: null,
    positionAt: 1,
    shuffle: null,
    loopStatus: null,
  };
  const now = clientNowPlaying({ connected: true, volume: 50, muted: false }, stream);
  assert.equal(now.playback_state, PLAYBACK.PLAYING);
  assert.equal(now.duration, 0);
  assert.equal(now.position, undefined);
});

test('clientNowPlaying: a stopped stream that still reports a track keeps it, without position', () => {
  const stream = {
    name: 'MPD',
    status: 'idle',
    playbackStatus: 'stopped',
    title: 'Blue in Green',
    artist: 'Miles Davis',
    album: '',
    duration: 337,
    position: 120,
    positionAt: 0,
    shuffle: null,
    loopStatus: null,
  };
  const client = { connected: true, volume: 50, muted: true };
  assert.deepEqual(clientNowPlaying(client, stream, { artworkUrl: null }), {
    playback_state: PLAYBACK.IDLE,
    title: 'Blue in Green',
    artist: 'Miles Davis',
    album: '',
    artwork_url: null,
    duration: 337,
    position: 0,
    volume: 50,
    mute: true,
  });
  // No stream at all (a group without one): idle, cleared.
  assert.equal(clientNowPlaying(client, null).title, '');
});

test('music box commands go to the stream of the room', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { server } = world;
  const calls = () =>
    server.calls.filter((c) => c.method.startsWith('Stream.')).map((c) => c.params);

  // On Radio (a pipe), nothing can be controlled.
  await assert.rejects(command(world, LIVING_ID, 'playback_state', 0), /cannot be controlled/);

  server.setGroupStream(LIVING, MUSIC);
  await until(() => state(world.gladys, LIVING_ID, 'title') === 'Track 1', 2000, 'Music');
  await command(world, LIVING_ID, 'playback_state', PLAYBACK.PAUSED);
  await command(world, LIVING_ID, 'playback_state', PLAYBACK.PLAYING);
  await command(world, LIVING_ID, 'playback_state', PLAYBACK.IDLE);
  await assert.rejects(command(world, LIVING_ID, 'playback_state', 3), /Unknown command/);
  await command(world, LIVING_ID, 'shuffle', 1);
  await command(world, LIVING_ID, 'repeat', REPEAT.ALL);
  await command(world, LIVING_ID, 'repeat', REPEAT.ONE);
  await command(world, LIVING_ID, 'repeat', REPEAT.OFF);
  await assert.rejects(command(world, LIVING_ID, 'position', 30), /cannot jump/);
  server.setStreamProperties(MUSIC, { canSeek: true });
  await until(() => world.hub.model.streams.get(MUSIC).canSeek, 2000, 'seekable');
  await command(world, LIVING_ID, 'position', 30.4);
  // The legacy mute switch and the music/mute of 5.3 send the same 0/1.
  await command(world, LIVING_ID, 'mute', 1);

  assert.deepEqual(calls(), [
    { id: MUSIC, command: 'pause' },
    { id: MUSIC, command: 'play' },
    { id: MUSIC, command: 'stop' },
    { id: MUSIC, property: 'shuffle', value: true },
    { id: MUSIC, property: 'loopStatus', value: 'playlist' },
    { id: MUSIC, property: 'loopStatus', value: 'track' },
    { id: MUSIC, property: 'loopStatus', value: 'none' },
    { id: MUSIC, command: 'setPosition', params: { position: 30 } },
  ]);
  // Confirmed by the control script (Stream.OnProperties), not assumed.
  await until(() => state(world.gladys, LIVING_ID, 'shuffle') === 1, 2000, 'shuffle confirmed');
  await until(() => state(world.gladys, LIVING_ID, 'mute') === 1, 2000, 'muted');
});

test('artwork: embedded bytes served from memory, large covers made smaller, SVG skipped', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  server.setGroupStream(LIVING, MUSIC);
  const small = noisePng(16);
  const large = noisePng(700);
  assert.ok(large.length > 300 * 1024);

  const play = (metadata) => {
    server.setStreamStatus(MUSIC, 'playing');
    server.setStreamProperties(MUSIC, { playbackStatus: 'playing', metadata });
  };
  // Snapserver adds an artUrl on its own HTTP server, whose host name the
  // container may not resolve: the embedded bytes are served, under a key
  // made from their content.
  const cacheUrl = 'http://snapserver-host:1780/__image_cache?name=0123abcd.png';
  play({
    title: 'Small',
    artData: { data: small.toString('base64'), extension: 'png' },
    artUrl: cacheUrl,
  });
  await until(() => state(gladys, LIVING_ID, 'title') === 'Small', 2000, 'small');
  const smallKey = state(gladys, LIVING_ID, 'artwork');
  assert.notEqual(smallKey, gladys.artworkKey(cacheUrl));
  assert.match(gladys.artworkUrls.get(smallKey), /^snapcast-art:[0-9a-f]{20}\.png$/);
  world.hub.artwork.fetch = () => {
    throw new Error('no network in the tests');
  };
  let ack = await gladys.fake.musicGetArtwork(smallKey);
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.image, small.toString('base64'), 'an image that fits is sent as it is');

  play({ title: 'Large', artData: { data: large.toString('base64'), extension: 'png' } });
  await until(() => state(gladys, LIVING_ID, 'title') === 'Large', 2000, 'large');
  ack = await gladys.fake.musicGetArtwork(state(gladys, LIVING_ID, 'artwork'));
  assert.equal(ack.success, true, ack.error);
  const image = Buffer.from(ack.data.image, 'base64');
  assert.ok(image.length <= 300 * 1024, `${image.length} bytes`);
  assert.deepEqual([...image.subarray(0, 2)], [0xff, 0xd8], 'a JPEG');

  // librespot: the Spotify logo, as an SVG the core refuses.
  play({
    title: 'Spotify',
    artData: { data: 'PHN2Zz48L3N2Zz4=', extension: 'svg' },
    artUrl: 'http://h:1780/__image_cache?name=x.svg',
  });
  await until(() => state(gladys, LIVING_ID, 'title') === 'Spotify', 2000, 'svg');
  assert.equal(state(gladys, LIVING_ID, 'artwork'), '');

  // A URL: read through fetch, bounded.
  const url = 'http://mopidy.local:6680/local/cover.png';
  world.hub.artwork.fetch = async (target) => {
    assert.equal(target, url);
    return new Response(large, { headers: { 'content-type': 'image/png' } });
  };
  play({ title: 'Remote', artUrl: url });
  await until(() => state(gladys, LIVING_ID, 'title') === 'Remote', 2000, 'remote');
  ack = await gladys.fake.musicGetArtwork(state(gladys, LIVING_ID, 'artwork'));
  assert.equal(ack.success, true, ack.error);
  assert.ok(Buffer.from(ack.data.image, 'base64').length <= 300 * 1024);
  world.hub.artwork.fetch = async () => new Response('nope', { status: 404 });
  ack = await gladys.fake.musicGetArtwork(gladys.artworkKey(url));
  assert.equal(ack.success, false);
  assert.match(ack.error, /HTTP 404/);
  ack = await gladys.fake.musicGetArtwork('art-000000000000');
  assert.equal(ack.success, false, 'a key never recorded');
});

test('Artwork.urlOf: only an http(s) image, never a data URI prefix kept', () => {
  const artwork = new Artwork();
  assert.equal(artwork.urlOf({ artUrl: 'file:///music/cover.jpg', artData: null }), null);
  assert.equal(artwork.urlOf({ artUrl: 'https://x/logo.svg', artData: null }), null);
  assert.equal(artwork.urlOf({ artUrl: '', artData: null }), null);
  const url = artwork.urlOf({
    artUrl: '',
    artData: { data: 'data:image/png;base64,QUJD', extension: 'png' },
  });
  assert.match(url, /^snapcast-art:[0-9a-f]{20}\.png$/);
  assert.equal(artwork.embedded.get(url), 'QUJD');
});
