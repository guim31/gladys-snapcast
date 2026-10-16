// -----------------------------------------------------------------------------
// Snapserver status -> plain model, and the pushed notifications applied to
// it. Shapes recorded on snapserver 0.31 (test/fixtures/snapcast/).
//
// - a client is a snapclient instance (`id`: its MAC, or --hostID, with
//   `#2`... for a second instance on the same host); its name is the one set
//   in Snapweb (`config.name`), or else its host name;
// - a group holds clients and plays one stream; groups come and go when
//   clients are moved (an emptied group is deleted, a new one gets a new id);
// - a stream is a source (`pipe`, `librespot`, `airplay`, `meta`...); its
//   `status` says whether audio flows, its `properties` (0.26+) what a control
//   script reports: playback status, metadata, what can be controlled.
// -----------------------------------------------------------------------------

const str = (value) => (typeof value === 'string' ? value : '');

function volumeOf(volume) {
  const percent = Number(volume?.percent);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : null;
}

function parseClient(raw, groupId) {
  const config = raw?.config ?? {};
  return {
    id: str(raw?.id),
    name: str(config.name).trim() || str(raw?.host?.name).trim() || str(raw?.id),
    connected: raw?.connected === true,
    volume: volumeOf(config.volume),
    muted: config.volume?.muted === true,
    groupId,
    version: str(raw?.snapclient?.version),
  };
}

function artistsOf(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim() !== '').join(', ');
  }
  return str(value);
}

function parseProperties(stream, properties) {
  const props = properties && typeof properties === 'object' ? properties : {};
  const metadata = props.metadata && typeof props.metadata === 'object' ? props.metadata : {};
  stream.canControl = props.canControl === true;
  stream.canPlay = props.canPlay === true;
  stream.canPause = props.canPause === true;
  stream.canGoNext = props.canGoNext === true;
  stream.canGoPrevious = props.canGoPrevious === true;
  stream.playbackStatus = str(props.playbackStatus) || null;
  stream.title = str(metadata.title).trim() || str(metadata.name).trim();
  stream.artist = artistsOf(metadata.artist).trim();
  stream.album = str(metadata.album).trim();
}

function parseStream(raw) {
  const stream = {
    id: str(raw?.id),
    name: str(raw?.uri?.query?.name).trim() || str(raw?.id),
    scheme: str(raw?.uri?.scheme),
    status: str(raw?.status) || 'unknown',
  };
  parseProperties(stream, raw?.properties);
  return stream;
}

/**
 * The `server` object of Server.GetStatus (or of Server.OnUpdate) -> model.
 * @returns {{ version: string, clients: Map<string, object>, groups: Map<string, object>, streams: Map<string, object> }}
 */
export function parseServer(server) {
  const model = {
    version: str(server?.server?.snapserver?.version),
    clients: new Map(),
    groups: new Map(),
    streams: new Map(),
  };
  for (const rawGroup of Array.isArray(server?.groups) ? server.groups : []) {
    const id = str(rawGroup?.id);
    if (id === '') {
      continue;
    }
    const clients = (Array.isArray(rawGroup.clients) ? rawGroup.clients : [])
      .map((raw) => parseClient(raw, id))
      .filter((client) => client.id !== '');
    for (const client of clients) {
      model.clients.set(client.id, client);
    }
    model.groups.set(id, {
      id,
      name: str(rawGroup.name).trim(),
      muted: rawGroup.muted === true,
      streamId: str(rawGroup.stream_id),
      clientIds: clients.map((client) => client.id),
    });
  }
  for (const raw of Array.isArray(server?.streams) ? server.streams : []) {
    const stream = parseStream(raw);
    if (stream.id !== '') {
      model.streams.set(stream.id, stream);
    }
  }
  return model;
}

/**
 * Applies one notification to the model, in place.
 * @returns {'changed' | 'unchanged' | 'reload'} `reload` when the model cannot
 *   follow (a client or group it does not know): read the whole status again.
 */
export function applyNotification(model, method, params = {}) {
  const client = model.clients.get(params.id);
  const group = model.groups.get(params.id);
  const stream = model.streams.get(params.id);
  switch (method) {
    case 'Client.OnVolumeChanged': {
      if (!client) {
        return 'reload';
      }
      client.volume = volumeOf(params.volume) ?? client.volume;
      client.muted = params.volume?.muted === true;
      return 'changed';
    }
    case 'Client.OnNameChanged':
      if (!client) {
        return 'reload';
      }
      client.name = str(params.name).trim() || client.name;
      return 'changed';
    case 'Client.OnLatencyChanged':
      return client ? 'unchanged' : 'reload';
    case 'Client.OnConnect':
    case 'Client.OnDisconnect': {
      if (!client) {
        // A new client: the server put it in a new group.
        return 'reload';
      }
      Object.assign(client, parseClient(params.client, client.groupId));
      // The notification of 0.31 says it, older ones may not.
      client.connected = method === 'Client.OnConnect';
      return 'changed';
    }
    case 'Group.OnMute':
      if (!group) {
        return 'reload';
      }
      group.muted = params.mute === true;
      return 'changed';
    case 'Group.OnStreamChanged':
      if (!group || !model.streams.has(params.stream_id)) {
        return 'reload';
      }
      group.streamId = params.stream_id;
      return 'changed';
    case 'Group.OnNameChanged':
      if (!group) {
        return 'reload';
      }
      group.name = str(params.name).trim();
      return 'changed';
    case 'Stream.OnUpdate': {
      const next = parseStream(params.stream);
      if (next.id === '') {
        return 'reload';
      }
      model.streams.set(next.id, next);
      return 'changed';
    }
    case 'Stream.OnProperties':
      if (!stream) {
        return 'reload';
      }
      parseProperties(stream, params.properties);
      return 'changed';
    case 'Server.OnUpdate': {
      const next = parseServer(params.server);
      model.clients = next.clients;
      model.groups = next.groups;
      model.streams = next.streams;
      model.version = next.version || model.version;
      return 'changed';
    }
    default:
      return 'unchanged';
  }
}

/** Audio flows and the player behind the stream (if any) does not say paused. */
export function isStreamPlaying(stream) {
  return Boolean(
    stream &&
    stream.status === 'playing' &&
    !['paused', 'stopped'].includes(stream.playbackStatus ?? ''),
  );
}

/** "Artist – Title", the title alone, or '' when the stream reports nothing. */
export function nowPlaying(stream) {
  if (!stream?.title) {
    return '';
  }
  return stream.artist ? `${stream.artist} – ${stream.title}` : stream.title;
}

/** The stream a client hears (through its group), or null. */
export function streamOfClient(model, client) {
  const group = client ? model.groups.get(client.groupId) : null;
  return group ? (model.streams.get(group.streamId) ?? null) : null;
}
