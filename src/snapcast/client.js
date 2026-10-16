// -----------------------------------------------------------------------------
// Snapserver's JSON-RPC 2.0 control API over raw TCP (port 1705): one JSON
// object per line, both ways. Requests carry an id; the server pushes
// notifications (Client.OnVolumeChanged, Group.OnStreamChanged,
// Stream.OnProperties, Server.OnUpdate...) to every control client.
//
// Checked on snapserver 0.31: no authentication by default, nothing is sent
// while nothing happens, a malformed or unknown call gets a JSON-RPC error.
//
// The connection is permanent and comes back by itself (backoff 2 s to 60 s);
// the hub reads the whole state again (Server.GetStatus) on each `open`.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';

export const DEFAULT_CLIENT_TIMINGS = {
  callTimeout: 5_000,
  connectTimeout: 5_000,
  reconnectMin: 2_000,
  reconnectMax: 60_000,
};

// A status of a big installation stays far below this; beyond, the line is
// garbage and the link is reset.
const MAX_LINE = 4 * 1024 * 1024;

/** An error with a stable code: unreachable | rpc | protocol. */
export class SnapcastError extends Error {
  constructor(code, message, { rpcCode } = {}) {
    super(message);
    this.code = code;
    this.rpcCode = rpcCode;
  }
}

/**
 * Emits `open`, `close` (reason) and `notification` (method, params).
 * Reconnects by itself until stop().
 */
export class SnapcastClient extends EventEmitter {
  /**
   * @param {{ host: string, port: number, connect?: Function, timings?: object }} options
   */
  constructor({ host, port, connect = net.createConnection, timings = {} }) {
    super();
    this.host = host;
    this.port = port;
    this.connectFn = connect;
    this.timings = { ...DEFAULT_CLIENT_TIMINGS, ...timings };
    this.socket = null;
    this.live = false;
    this.running = false;
    this.failures = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.retryTimer = null;
    this.connectTimer = null;
  }

  get address() {
    return this.host.includes(':') ? `[${this.host}]:${this.port}` : `${this.host}:${this.port}`;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.#open();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.#drop('stopped');
  }

  /** Drops the link and reconnects at once (the server stopped answering). */
  reset(reason) {
    if (!this.running || !this.socket) {
      return;
    }
    this.#drop(reason);
    this.#scheduleRetry(reason, 0);
  }

  /**
   * One JSON-RPC call. Rejects with a SnapcastError: `unreachable` when the
   * link is down or the server does not answer in time, `rpc` when the server
   * answers with an error.
   */
  call(method, params) {
    const socket = this.socket;
    if (!this.live || !socket) {
      return Promise.reject(new SnapcastError('unreachable', `${method}: not connected`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SnapcastError('unreachable', `${method}: no answer`));
      }, this.timings.callTimeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      const body = { id, jsonrpc: '2.0', method, ...(params ? { params } : {}) };
      socket.write(`${JSON.stringify(body)}\r\n`);
    });
  }

  #open() {
    let socket;
    try {
      socket = this.connectFn({ host: this.host, port: this.port });
    } catch (err) {
      this.#scheduleRetry(err.message);
      return;
    }
    this.socket = socket;
    let buffer = '';
    socket.setEncoding?.('utf8');
    socket.setNoDelay?.(true);
    // Snapserver is silent at rest: let the kernel notice a dead peer.
    socket.setKeepAlive?.(true, 30_000);
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && !this.live) {
        this.#drop('connection timeout');
        this.#scheduleRetry('connection timeout');
      }
    }, this.timings.connectTimeout);
    this.connectTimer.unref?.();
    socket.on('connect', () => {
      if (this.socket !== socket) {
        return;
      }
      clearTimeout(this.connectTimer);
      this.failures = 0;
      this.live = true;
      this.emit('open');
    });
    socket.on('data', (chunk) => {
      if (this.socket !== socket) {
        return;
      }
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line !== '') {
          this.#receive(line);
        }
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > MAX_LINE) {
        this.reset('line too long');
      }
    });
    socket.on('error', (err) => {
      socket.lastError = err.code || err.message;
    });
    socket.on('close', () => {
      if (this.socket !== socket) {
        return;
      }
      const reason = socket.lastError ?? 'connection closed';
      this.#drop(reason);
      this.#scheduleRetry(reason);
    });
  }

  #receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // A batch answer is an array; this client never sends batches.
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const detail = message.error.data ?? message.error.message ?? 'error';
        pending.reject(
          new SnapcastError('rpc', `${pending.method}: ${detail}`, { rpcCode: message.error.code }),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === 'string') {
      this.emit('notification', message.method, message.params ?? {});
    }
  }

  #drop(reason) {
    clearTimeout(this.connectTimer);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners('data');
      socket.removeAllListeners('connect');
      socket.on('error', () => {});
      socket.destroy();
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new SnapcastError('unreachable', `${pending.method}: ${reason}`));
      this.pending.delete(id);
    }
    if (this.live) {
      this.live = false;
      this.emit('close', reason);
    } else if (reason !== 'stopped') {
      this.emit('failed', reason);
    }
  }

  #scheduleRetry(reason, forcedDelay) {
    if (!this.running) {
      return;
    }
    this.failures += 1;
    const delay =
      forcedDelay ??
      Math.min(
        this.timings.reconnectMax,
        this.timings.reconnectMin * 2 ** Math.min(this.failures - 1, 10),
      );
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running && !this.socket) {
        this.#open();
      }
    }, delay);
    this.retryTimer.unref?.();
  }
}
