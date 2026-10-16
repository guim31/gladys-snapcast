// -----------------------------------------------------------------------------
// The JSON-RPC client over TCP: calls, errors, notifications, lines split
// across packets, and the reconnection.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { SnapcastClient, SnapcastError } from '../src/snapcast/client.js';
import { FakeSnapserver, until } from './helpers/fakeSnapserver.js';
import { FAST_CLIENT } from './helpers/world.js';

async function open(t, server) {
  const client = new SnapcastClient({ host: '127.0.0.1', port: server.port, timings: FAST_CLIENT });
  t.after(() => client.stop());
  client.start();
  await until(() => client.live, 2000, 'open');
  return client;
}

test('a call resolves with the result, an error answer rejects with its detail', async (t) => {
  const server = await new FakeSnapserver().listen();
  t.after(() => server.close());
  const client = await open(t, server);
  const status = await client.call('Server.GetStatus');
  assert.equal(status.server.server.snapserver.version, '0.31.0');
  await assert.rejects(
    client.call('Group.SetStream', { id: 'nope', stream_id: 'Radio' }),
    (err) =>
      err instanceof SnapcastError && err.code === 'rpc' && /Group not found/.test(err.message),
  );
  await assert.rejects(client.call('Nope.Nope'), /Method not found/);
});

test('notifications are emitted, even split across packets or glued together', async (t) => {
  const sockets = [];
  const tcp = net.createServer((socket) => sockets.push(socket));
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => tcp.close(resolve)));
  const client = new SnapcastClient({
    host: '127.0.0.1',
    port: tcp.address().port,
    timings: FAST_CLIENT,
  });
  t.after(() => client.stop());
  const seen = [];
  client.on('notification', (method, params) => seen.push([method, params.id]));
  client.start();
  await until(() => sockets.length === 1 && client.live, 2000, 'open');
  const a = JSON.stringify({
    jsonrpc: '2.0',
    method: 'Group.OnMute',
    params: { id: 'g', mute: true },
  });
  const b = JSON.stringify({ jsonrpc: '2.0', method: 'Client.OnNameChanged', params: { id: 'c' } });
  sockets[0].write(a.slice(0, 10));
  await new Promise((resolve) => setTimeout(resolve, 20));
  sockets[0].write(`${a.slice(10)}\r\n${b}\nnot json\n[1,2]\n`);
  await until(() => seen.length === 2, 2000, 'two notifications');
  assert.deepEqual(seen, [
    ['Group.OnMute', 'g'],
    ['Client.OnNameChanged', 'c'],
  ]);
  for (const socket of sockets) {
    socket.destroy();
  }
});

test('no answer in time: the call rejects as unreachable', async (t) => {
  const server = await new FakeSnapserver().listen();
  t.after(() => server.close());
  const client = await open(t, server);
  server.silent = true;
  await assert.rejects(
    client.call('Server.GetStatus'),
    (err) => err.code === 'unreachable' && /no answer/.test(err.message),
  );
});

test('a lost connection comes back by itself; calls meanwhile fail fast', async (t) => {
  const server = await new FakeSnapserver().listen();
  t.after(() => server.close());
  const client = await open(t, server);
  const events = [];
  client.on('close', () => events.push('close'));
  client.on('open', () => events.push('open'));
  await server.close();
  await until(() => !client.live, 2000, 'closed');
  await assert.rejects(client.call('Server.GetStatus'), /not connected/);
  await new Promise((resolve) => setTimeout(resolve, 100)); // failed attempts
  await server.restart();
  await until(() => client.live, 2000, 'reopened');
  assert.deepEqual(events, ['close', 'open']);
});

test('stop() closes for good', async (t) => {
  const server = await new FakeSnapserver().listen();
  t.after(() => server.close());
  const client = await open(t, server);
  client.stop();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(client.live, false);
  assert.equal(server.sessions.size, 0);
});
