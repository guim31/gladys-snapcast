// -----------------------------------------------------------------------------
// A scripted Snapserver for the tests: a TCP server on the loopback speaking
// the JSON-RPC control protocol, one JSON object per line, starting from the
// status recorded on snapserver 0.31 (fixtures/snapcast/server-get-status.json).
//
// Like the real one, it answers the caller and notifies every OTHER control
// connection of a change it made; changes made "on the server" (another app,
// Snapweb) are notified to everyone.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { readFile } from 'node:fs/promises';

const fixture = (name) =>
  readFile(new URL(`../fixtures/snapcast/${name}`, import.meta.url), 'utf8').then(JSON.parse);

export const STATUS = (await fixture('server-get-status.json')).result;
export const NOTIFICATIONS = await fixture('notifications.json');

// The ids of the recorded status.
export const LIVING = 'client-1';
export const KITCHEN = 'client-2';
export const RADIO = 'Radio';
export const MUSIC = 'Music';

export const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Waits until `fn()` is truthy. */
export async function until(fn, ms = 2000, label = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) {
      return;
    }
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export class FakeSnapserver {
  constructor() {
    this.server = structuredClone(STATUS.server);
    this.sessions = new Set();
    this.calls = [];
    this.silent = false; // accepts connections but never answers
    this.tcp = null;
    this.port = null;
  }

  async listen(port = 0) {
    this.tcp = net.createServer((socket) => this.#session(socket));
    await new Promise((resolve) => this.tcp.listen(port, '127.0.0.1', resolve));
    this.port = this.tcp.address().port;
    return this;
  }

  /** Stops listening and drops every connection (a server restart, first half). */
  async close() {
    for (const socket of this.sessions) {
      socket.destroy();
    }
    this.sessions.clear();
    await new Promise((resolve) => (this.tcp ? this.tcp.close(() => resolve()) : resolve()));
    this.tcp = null;
  }

  /** Comes back on the same port. */
  restart() {
    return this.listen(this.port);
  }

  #session(socket) {
    this.sessions.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          this.#request(socket, line);
        }
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => this.sessions.delete(socket));
  }

  #send(socket, message) {
    if (!socket.destroyed) {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\r\n`);
    }
  }

  /** A notification to every control connection but `except`. */
  notify(method, params, except = null) {
    for (const socket of this.sessions) {
      if (socket !== except) {
        this.#send(socket, { method, params });
      }
    }
  }

  // --- Model helpers --------------------------------------------------------

  client(id) {
    for (const group of this.server.groups) {
      const found = group.clients.find((client) => client.id === id);
      if (found) {
        return found;
      }
    }
    return null;
  }

  groupOf(id) {
    return this.server.groups.find((group) => group.clients.some((client) => client.id === id));
  }

  stream(id) {
    return this.server.streams.find((stream) => stream.id === id);
  }

  // --- Changes made on the server side (Snapweb, another app) -----------------

  setVolume(id, percent, muted = false) {
    this.client(id).config.volume = { muted, percent };
    this.notify('Client.OnVolumeChanged', { id, volume: { muted, percent } });
  }

  setGroupStream(clientId, streamId) {
    const group = this.groupOf(clientId);
    group.stream_id = streamId;
    this.notify('Group.OnStreamChanged', { id: group.id, stream_id: streamId });
  }

  setConnected(id, connected) {
    const client = this.client(id);
    client.connected = connected;
    this.notify(connected ? 'Client.OnConnect' : 'Client.OnDisconnect', {
      id,
      client: structuredClone(client),
    });
  }

  setStreamStatus(id, status) {
    const stream = this.stream(id);
    stream.status = status;
    this.notify('Stream.OnUpdate', { id, stream: structuredClone(stream) });
  }

  setStreamProperties(id, properties) {
    const stream = this.stream(id);
    stream.properties = { ...stream.properties, ...properties };
    this.notify('Stream.OnProperties', { id, properties: structuredClone(stream.properties) });
  }

  /** A client the model does not know yet, in a new group. */
  addClient(id, name) {
    const template = structuredClone(this.client(LIVING));
    template.id = id;
    template.host.name = name;
    template.config.name = '';
    this.server.groups.push({
      clients: [template],
      id: `group-${id}`,
      muted: false,
      name: '',
      stream_id: RADIO,
    });
    this.notify('Client.OnConnect', { id, client: structuredClone(template) });
  }

  // --- Requests --------------------------------------------------------------

  #request(socket, line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      this.#send(socket, { id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    this.calls.push({ method: request.method, params: request.params });
    if (this.silent) {
      return;
    }
    const { id, method, params = {} } = request;
    const answer = (result) => this.#send(socket, { id, result });
    const fail = (code, message, data) =>
      this.#send(socket, { id, error: { code, message, ...(data ? { data } : {}) } });

    switch (method) {
      case 'Server.GetStatus':
        return answer({ server: this.server });
      case 'Client.SetVolume': {
        const client = this.client(params.id);
        if (!client) {
          return fail(-32603, 'Internal error', 'Client not found');
        }
        client.config.volume = { ...client.config.volume, ...params.volume };
        this.notify(
          'Client.OnVolumeChanged',
          { id: params.id, volume: client.config.volume },
          socket,
        );
        return answer({ volume: client.config.volume });
      }
      case 'Group.SetStream': {
        const group = this.server.groups.find((g) => g.id === params.id);
        if (!group) {
          return fail(-32603, 'Internal error', 'Group not found');
        }
        group.stream_id = params.stream_id;
        this.notify('Group.OnStreamChanged', { id: group.id, stream_id: params.stream_id }, socket);
        return answer({ stream_id: params.stream_id });
      }
      case 'Group.SetClients': {
        const group = this.server.groups.find((g) => g.id === params.id);
        if (!group) {
          return fail(-32603, 'Internal error', 'Group not found');
        }
        const all = this.server.groups.flatMap((g) => g.clients);
        const removed = group.clients.filter((c) => !params.clients.includes(c.id));
        for (const g of this.server.groups) {
          g.clients = g.clients.filter((c) => !params.clients.includes(c.id));
        }
        group.clients = params.clients.map((cid) => all.find((c) => c.id === cid));
        for (const client of removed) {
          this.server.groups.push({
            clients: [client],
            id: `group-${client.id}-${this.calls.length}`,
            muted: false,
            name: '',
            stream_id: group.stream_id,
          });
        }
        this.server.groups = this.server.groups.filter((g) => g.clients.length > 0);
        this.notify('Server.OnUpdate', { server: this.server }, socket);
        return answer({ server: this.server });
      }
      case 'Stream.Control': {
        const stream = this.stream(params.id);
        if (!stream) {
          return fail(-32603, 'Internal error', 'Stream not found');
        }
        // Like Snapserver: a seek needs canSeek only, the others canControl.
        if (params.command === 'setPosition') {
          if (!stream.properties.canSeek) {
            return fail(-32603, 'Internal error', 'Stream property canSeek is false');
          }
          stream.properties.position = params.params.position;
          answer('ok');
          return this.notify('Stream.OnProperties', {
            id: stream.id,
            properties: stream.properties,
          });
        }
        if (!stream.properties.canControl) {
          return fail(2, 'Stream property canControl is false');
        }
        const status = { play: 'playing', pause: 'paused', stop: 'stopped', playPause: null }[
          params.command
        ];
        if (params.command === 'playPause') {
          stream.properties.playbackStatus =
            stream.properties.playbackStatus === 'playing' ? 'paused' : 'playing';
        } else if (status) {
          stream.properties.playbackStatus = status;
        }
        answer('ok');
        // The control script reports its new state to everyone, the caller too.
        return this.notify('Stream.OnProperties', { id: stream.id, properties: stream.properties });
      }
      case 'Stream.SetProperty': {
        const stream = this.stream(params.id);
        if (!stream) {
          return fail(-32603, 'Internal error', 'Stream not found');
        }
        if (!stream.properties.canControl) {
          return fail(2, 'Stream property canControl is false');
        }
        stream.properties[params.property] = params.value;
        answer('ok');
        return this.notify('Stream.OnProperties', { id: stream.id, properties: stream.properties });
      }
      default:
        return fail(-32601, 'Method not found');
    }
  }
}
