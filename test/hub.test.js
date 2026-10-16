// -----------------------------------------------------------------------------
// The hub against the scripted Snapserver: discovery, states both ways,
// commands, scene events, the reconnection.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { FakeSnapserver, KITCHEN, LIVING, MUSIC, RADIO } from './helpers/fakeSnapserver.js';
import {
  MemoryStore,
  clientId,
  createAll,
  createWorld,
  deviceOf,
  featureOf,
  sleep,
  state,
  streamId,
  until,
} from './helpers/world.js';

const LIVING_ID = clientId(LIVING);
const KITCHEN_ID = clientId(KITCHEN);
const MUSIC_ID = streamId(MUSIC);
const RADIO_ID = streamId(RADIO);

async function ready(options) {
  const world = await createWorld(options);
  await createAll(world);
  await until(() => state(world.gladys, LIVING_ID, 'connected') === 1, 2000, 'states');
  return world;
}

const setValue = (world, id, key, value) =>
  world.gladys.fake.setValue(deviceOf(world.gladys, id), featureOf(world.gladys, id, key), value);

test('discovery: one device per client and per stream, buttons only on a controllable stream', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  await until(() => world.gladys.fake.discoveredDevices?.length === 4, 2000, 'four devices');
  const ids = world.gladys.fake.discoveredDevices.map((d) => d.external_id).sort();
  assert.deepEqual(ids, [KITCHEN_ID, LIVING_ID, MUSIC_ID, RADIO_ID].sort());

  const living = deviceOf(world.gladys, LIVING_ID);
  assert.equal(living.name, 'livingroom-pi', 'the host name while Snapweb gave none');
  assert.equal(living.should_poll, false);
  assert.deepEqual(
    featureOf(world.gladys, LIVING_ID, 'stream').supported_options.map((o) => o.value),
    [RADIO, MUSIC],
  );
  const keys = (id) =>
    deviceOf(world.gladys, id).features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys(RADIO_ID), ['playback_state', 'now_playing']);
  assert.deepEqual(keys(MUSIC_ID), [
    'playback_state',
    'now_playing',
    'play',
    'pause',
    'previous',
    'next',
  ]);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
});

test('states once the devices are added, then only what changes', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys } = world;
  assert.equal(state(gladys, LIVING_ID, 'volume'), 100);
  assert.equal(state(gladys, LIVING_ID, 'mute'), 0);
  assert.equal(state(gladys, LIVING_ID, 'stream'), RADIO);
  assert.equal(state(gladys, LIVING_ID, 'playback_state'), 1, 'Radio has audio');
  assert.equal(state(gladys, LIVING_ID, 'now_playing'), 'Radio');
  assert.equal(state(gladys, MUSIC_ID, 'playback_state'), 0, 'Music has no audio');
  assert.equal(state(gladys, MUSIC_ID, 'now_playing'), 'Music · Idle');

  const before = gladys.fake.states.length;
  world.server.setVolume(KITCHEN, 40, true);
  await until(() => state(gladys, KITCHEN_ID, 'volume') === 40, 2000, 'kitchen volume');
  assert.equal(state(gladys, KITCHEN_ID, 'mute'), 1);
  await sleep(50);
  assert.equal(gladys.fake.states.length - before, 2, 'volume and mute, nothing else');
});

test('commands from Gladys reach the server, and the answer updates Gladys', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;

  assert.equal((await setValue(world, LIVING_ID, 'volume', 35)).success, true);
  assert.equal(server.client(LIVING).config.volume.percent, 35);
  await until(() => state(gladys, LIVING_ID, 'volume') === 35, 2000, 'volume echo');

  assert.equal((await setValue(world, LIVING_ID, 'mute', 1)).success, true);
  assert.deepEqual(server.client(LIVING).config.volume, { muted: true, percent: 35 });
  await until(() => state(gladys, LIVING_ID, 'mute') === 1, 2000, 'mute echo');

  assert.equal((await setValue(world, LIVING_ID, 'stream', MUSIC)).success, true);
  assert.equal(server.groupOf(LIVING).stream_id, MUSIC);
  await until(() => state(gladys, LIVING_ID, 'stream') === MUSIC, 2000, 'stream echo');
  assert.equal(server.groupOf(KITCHEN).stream_id, RADIO, 'the other group keeps its stream');

  const unknown = await setValue(world, LIVING_ID, 'stream', 'Nope');
  assert.equal(unknown.success, false);
});

test('stream controls: on the stream, through a room, refused on a pipe', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;

  assert.equal((await setValue(world, MUSIC_ID, 'pause', 1)).success, true);
  assert.deepEqual(server.calls.at(-1), {
    method: 'Stream.Control',
    params: { id: MUSIC, command: 'pause' },
  });
  await until(() => state(gladys, MUSIC_ID, 'now_playing') === 'Music · Paused', 2000, 'paused');

  const refused = await setValue(world, LIVING_ID, 'next', 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /cannot be controlled/);

  await setValue(world, LIVING_ID, 'stream', MUSIC);
  assert.equal((await setValue(world, LIVING_ID, 'play', 1)).success, true);
  assert.deepEqual(server.calls.at(-1).params, { id: MUSIC, command: 'play' });
});

test('metadata of a playing stream is the "now playing" of its rooms', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  server.setGroupStream(LIVING, MUSIC);
  server.setStreamStatus(MUSIC, 'playing');
  server.setStreamProperties(MUSIC, {
    metadata: { title: 'So What', artist: ['Miles Davis'], album: 'Kind of Blue' },
  });
  await until(
    () => state(gladys, LIVING_ID, 'now_playing') === 'Miles Davis – So What',
    2000,
    'title',
  );
  assert.equal(state(gladys, MUSIC_ID, 'now_playing'), 'Miles Davis – So What');
  assert.equal(state(gladys, MUSIC_ID, 'playback_state'), 1);
  assert.equal(state(gladys, LIVING_ID, 'playback_state'), 1);
});

test('scene events: a client goes and comes back, a stream starts and stops', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  const keys = () => gladys.fake.sceneEvents.map((e) => e.key);

  server.setConnected(KITCHEN, false);
  await until(() => keys().includes('client_disconnected'), 2000, 'disconnected');
  assert.equal(state(gladys, KITCHEN_ID, 'connected'), 0);
  assert.equal(state(gladys, KITCHEN_ID, 'now_playing'), 'Offline');
  server.setConnected(KITCHEN, true);
  await until(() => keys().includes('client_connected'), 2000, 'connected');

  server.setStreamStatus(MUSIC, 'playing');
  await until(() => keys().includes('stream_started'), 2000, 'started');
  server.setStreamStatus(MUSIC, 'idle');
  await until(() => keys().includes('stream_stopped'), 2000, 'stopped');

  const [gone, back, started] = gladys.fake.sceneEvents;
  assert.deepEqual(gone.data, { device: KITCHEN_ID, client: 'kitchen-pi' });
  assert.equal(back.data.device, KITCHEN_ID);
  assert.deepEqual(started.data, {
    device: MUSIC_ID,
    stream: 'Music',
    title: 'Track 1',
    artist: 'Test Artist',
  });
  assert.equal(gladys.fake.sceneEvents.length, 4, 'nothing else');
});

test('a new client: the whole status is read again, the device is published', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  world.server.addClient('00:11:22:33:44:55#2', 'bedroom-pi');
  await until(() => world.gladys.fake.discoveredDevices.length === 5, 2000, 'five devices');
  assert.ok(deviceOf(world.gladys, 'ext:test-integration:client:00-11-22-33-44-55-2'));
});

test('groups: join, leave, and the stream follows the group', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  let ack = await gladys.fake.sceneAction('join_group', { device: KITCHEN_ID, target: LIVING_ID });
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.groupOf(KITCHEN), server.groupOf(LIVING));
  assert.equal(world.hub.model.clients.get(KITCHEN).groupId, server.groupOf(LIVING).id);

  await setValue(world, LIVING_ID, 'stream', MUSIC);
  await until(() => state(gladys, KITCHEN_ID, 'stream') === MUSIC, 2000, 'kitchen follows');

  ack = await gladys.fake.sceneAction('leave_group', { device: KITCHEN_ID });
  assert.equal(ack.success, true, ack.error);
  assert.notEqual(server.groupOf(KITCHEN), server.groupOf(LIVING));
  assert.equal(server.server.groups.length, 2);

  ack = await gladys.fake.sceneAction('join_group', { device: KITCHEN_ID, target: KITCHEN_ID });
  assert.equal(ack.success, false);
});

test('mute_all, set_volume, set_stream, control_stream', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  let ack = await gladys.fake.sceneAction('mute_all', { mode: 'mute' });
  assert.deepEqual(ack.data, { outputs: { count: 2 } });
  assert.equal(server.client(LIVING).config.volume.muted, true);
  assert.equal(server.client(KITCHEN).config.volume.muted, true);
  ack = await gladys.fake.sceneAction('mute_all', { mode: 'mute' });
  assert.deepEqual(ack.data, { outputs: { count: 0 } }, 'already muted');

  ack = await gladys.fake.sceneAction('set_volume', { device: LIVING_ID, volume: 20 });
  assert.equal(ack.success, true);
  assert.deepEqual(server.client(LIVING).config.volume, { muted: true, percent: 20 });
  ack = await gladys.fake.sceneAction('set_volume', { device: LIVING_ID, volume: 120 });
  assert.equal(ack.success, false);
  ack = await gladys.fake.sceneAction('set_volume', { device: MUSIC_ID, volume: 20 });
  assert.match(ack.error, /not a stream/);

  ack = await gladys.fake.sceneAction('set_stream', { device: KITCHEN_ID, stream: MUSIC_ID });
  assert.equal(ack.success, true);
  assert.equal(server.groupOf(KITCHEN).stream_id, MUSIC);
  ack = await gladys.fake.sceneAction('set_stream', { device: KITCHEN_ID, stream: LIVING_ID });
  assert.match(ack.error, /not a client/);

  ack = await gladys.fake.sceneAction('control_stream', { device: KITCHEN_ID, command: 'pause' });
  assert.equal(ack.success, true, 'the stream the kitchen hears');
  assert.deepEqual(server.calls.at(-1).params, { id: MUSIC, command: 'pause' });
});

test('the server restarts: devices offline, then everything read again', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  await server.close();
  await until(() => gladys.fake.connectionStatus.connected === false, 2000, 'lost');
  await until(() => state(gladys, LIVING_ID, 'connected') === 0, 2000, 'offline');
  assert.equal(state(gladys, LIVING_ID, 'now_playing'), 'Offline');
  const ack = await setValue(world, LIVING_ID, 'volume', 10);
  assert.match(ack.error, /unreachable/);

  server.server.groups[0].clients[0].config.volume.percent = 12; // changed meanwhile
  await server.restart();
  await until(() => gladys.fake.connectionStatus.connected === true, 2000, 'back');
  await until(() => state(gladys, LIVING_ID, 'connected') === 1, 2000, 'online');
  const changed = server.server.groups[0].clients[0].id;
  assert.equal(state(gladys, clientId(changed), 'volume'), 12);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'no scene event for what the restart did');
});

test('a server that stops answering is dropped and reconnected', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  world.server.silent = true;
  await until(() => world.gladys.fake.connectionStatus.connected === false, 3000, 'lost');
  world.server.silent = false;
  await until(() => world.gladys.fake.connectionStatus.connected === true, 3000, 'back');
});

test('not configured, or an address that is not one', async (t) => {
  const empty = await createWorld({ config: { host: '' } });
  t.after(() => empty.stop());
  assert.equal(empty.gladys.fake.connectionStatus.connected, false);
  assert.match(empty.gladys.fake.connectionStatus.message.en, /Type the address/);
  const ack = await empty.gladys.fake.sceneAction('mute_all', { mode: 'mute' });
  assert.match(ack.error, /Type the address/);

  const wrong = await createWorld({ config: { host: 'http://192.0.2.1/x' } });
  t.after(() => wrong.stop());
  assert.match(wrong.gladys.fake.connectionStatus.message.en, /not valid/);
});

test('a stream seen controllable keeps its buttons after a restart', async (t) => {
  const store = new MemoryStore();
  const world = await createWorld({ store });
  t.after(() => world.stop());
  await until(() => store.data.controllable?.includes(MUSIC), 2000, 'remembered');

  const server = new FakeSnapserver();
  server.stream(MUSIC).properties = { canControl: false }; // script not ready yet
  await server.listen();
  const again = await createWorld({ server, store });
  t.after(() => again.stop());
  await until(() => again.gladys.fake.discoveredDevices?.length === 4, 2000, 'devices');
  assert.ok(featureOf(again.gladys, MUSIC_ID, 'next'));
});

test('the language changes: the names follow, the connection stays', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const connections = world.server.sessions.size;
  await world.gladys.fake.configUpdated({ ...world.gladys.fake.config, language: 'fr' });
  await until(
    () => featureOf(world.gladys, LIVING_ID, 'mute').name === 'Sourdine',
    2000,
    'French names',
  );
  assert.equal(world.server.sessions.size, connections);
  await until(() => state(world.gladys, MUSIC_ID, 'now_playing') === 'Music · Inactif', 2000, 'fr');
});

test('another server, or none: the rooms of the old one go offline', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  await world.gladys.fake.configUpdated({ ...world.gladys.fake.config, host: '' });
  await until(() => state(world.gladys, LIVING_ID, 'connected') === 0, 2000, 'offline');
  assert.equal(state(world.gladys, LIVING_ID, 'playback_state'), 0);
  await until(() => world.server.sessions.size === 0, 2000, 'the old connection closed');
});

test('a first read refused by the server is tried again', async (t) => {
  const server = new FakeSnapserver();
  const answer = server.server;
  server.server = null; // Server.GetStatus answers garbage: { server: null }
  await server.listen();
  const world = await createWorld({ server });
  t.after(() => world.stop());
  await sleep(50);
  assert.equal(world.gladys.fake.discoveredDevices?.length ?? 0, 0);
  server.server = answer;
  await until(() => world.gladys.fake.discoveredDevices?.length === 4, 3000, 'read again');
});

test('a start after a configuration update does not leave a second connection', async (t) => {
  const world = await createWorld({ connect: false });
  t.after(() => world.stop());
  await world.hub.start(normalizeConfig(world.gladys.fake.config));
  await world.hub.start(normalizeConfig(world.gladys.fake.config));
  await until(() => world.hub.online, 2000, 'online');
  await sleep(50);
  assert.equal(world.server.sessions.size, 1);
});
