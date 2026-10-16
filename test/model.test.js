// -----------------------------------------------------------------------------
// The model, from the status and the notifications recorded on snapserver
// 0.31 (test/fixtures/snapcast/).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformIdOf, streamState, streamText } from '../src/devices.js';
import {
  applyNotification,
  isStreamPlaying,
  nowPlaying,
  parseServer,
  streamOfClient,
} from '../src/snapcast/model.js';
import { NOTIFICATIONS, STATUS } from './helpers/fakeSnapserver.js';

const fresh = () => parseServer(structuredClone(STATUS.server));

test('the recorded status: clients, groups, streams', () => {
  const model = fresh();
  assert.equal(model.version, '0.31.0');
  assert.deepEqual([...model.clients.keys()].sort(), ['client-1', 'client-2']);
  const living = model.clients.get('client-1');
  assert.deepEqual(
    { ...living, groupId: typeof living.groupId },
    {
      id: 'client-1',
      name: 'livingroom-pi',
      connected: true,
      volume: 100,
      muted: false,
      groupId: 'string',
      version: '0.31.0',
    },
  );
  assert.equal(model.groups.size, 2);
  const radio = model.streams.get('Radio');
  assert.equal(radio.canControl, false);
  assert.equal(isStreamPlaying(radio), true);
  const music = model.streams.get('Music');
  assert.equal(music.canControl, true);
  assert.equal(music.status, 'idle');
  assert.equal(nowPlaying(music), 'Test Artist – Track 1');
  assert.equal(isStreamPlaying(music), false, 'the player says playing, no audio flows');
  assert.equal(streamOfClient(model, living).id, 'Radio');
});

test('the recorded notifications apply, the unknown ones ask for a full read', () => {
  const model = fresh();
  const results = [];
  for (const { method, params } of NOTIFICATIONS) {
    results.push([method, applyNotification(model, method, structuredClone(params))]);
  }
  // Recorded in another session: its group ids differ from the status.
  assert.deepEqual(results, [
    ['Client.OnVolumeChanged', 'changed'],
    ['Group.OnMute', 'reload'],
    ['Group.OnStreamChanged', 'reload'],
    ['Client.OnNameChanged', 'changed'],
    ['Client.OnDisconnect', 'changed'],
    ['Client.OnConnect', 'changed'],
    ['Stream.OnProperties', 'changed'],
    ['Stream.OnProperties', 'changed'],
    ['Server.OnUpdate', 'changed'],
  ]);
  // After the last one (Server.OnUpdate): both clients in one group, renamed.
  assert.equal(model.groups.size, 1);
  assert.equal(model.clients.get('client-1').name, 'Salon');
  assert.equal(model.clients.get('client-1').muted, true);
  assert.equal(model.clients.get('client-1').volume, 42);
});

test('a client notification on a known client', () => {
  const model = fresh();
  applyNotification(model, 'Client.OnVolumeChanged', {
    id: 'client-2',
    volume: { muted: true, percent: 33.6 },
  });
  assert.deepEqual(
    [model.clients.get('client-2').volume, model.clients.get('client-2').muted],
    [34, true],
  );
  const disconnect = NOTIFICATIONS.find((n) => n.method === 'Client.OnDisconnect');
  applyNotification(model, disconnect.method, structuredClone(disconnect.params));
  assert.equal(model.clients.get('client-2').connected, false);
  assert.equal(applyNotification(model, 'Client.OnVolumeChanged', { id: 'x' }), 'reload');
  assert.equal(applyNotification(model, 'Something.New', {}), 'unchanged');
});

test('stream states and texts', () => {
  const stream = (status, playbackStatus = null, title = '') => ({
    id: 'S',
    name: 'Spotify',
    status,
    playbackStatus,
    title,
    artist: '',
  });
  assert.equal(streamState(stream('playing')), 'playing');
  assert.equal(streamState(stream('playing', 'paused')), 'paused');
  assert.equal(streamState(stream('idle', 'paused')), 'paused');
  assert.equal(streamState(stream('idle', 'playing')), 'idle');
  assert.equal(streamState(stream('disabled')), 'disabled');
  assert.equal(streamState(stream('weird')), 'unknown');
  assert.equal(streamText(stream('playing', null, 'Song'), 'en'), 'Song');
  assert.equal(streamText(stream('playing'), 'en'), 'Spotify');
  assert.equal(streamText(stream('idle'), 'fr'), 'Spotify · Inactif');
  assert.equal(streamText(null, 'de'), 'Inaktiv');
});

test('platform ids: stable, readable, distinct', () => {
  assert.equal(platformIdOf('00:21:6a:7d:74:fc'), '00-21-6a-7d-74-fc');
  assert.equal(platformIdOf('00:21:6a:7d:74:fc#2'), '00-21-6a-7d-74-fc-2');
  assert.equal(platformIdOf('client-1'), 'client-1');
  assert.match(platformIdOf('Radio FIP'), /^radio-fip-[0-9a-f]{8}$/);
  const names = ['Radio FIP', 'radio fip', 'radio-fip', 'radio_fip', 'Radio.FIP'];
  assert.equal(new Set(names.map(platformIdOf)).size, names.length, 'no collision');
  assert.match(platformIdOf('Radio é'), /^radio-[0-9a-f]{8}$/);
  assert.notEqual(platformIdOf('Radio é'), platformIdOf('Radio è'));
  assert.match(platformIdOf('ラジオ'), /^[0-9a-f]{8}$/);
});
