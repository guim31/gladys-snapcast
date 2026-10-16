// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`). They receive the resolved fields
// and no language: errors follow the configured `language`.
// The core already sets a client's volume, mute and stream through its device
// features; these actions add what it cannot: every room at once, a stream
// picked as a device, the groups, and the stream commands of a room.
// -----------------------------------------------------------------------------

import { CommandError } from './hub.js';

export const SCENE_ACTIONS = {
  async set_volume(hub, { fields }) {
    await hub.setVolume(hub.clientOf(fields.device), fields.volume);
    return undefined;
  },

  async mute_all(hub, { fields }) {
    if (!['mute', 'unmute'].includes(fields.mode)) {
      throw new CommandError('bad_command', hub.language);
    }
    return { count: await hub.muteAll(fields.mode === 'mute') };
  },

  async set_stream(hub, { fields }) {
    const client = hub.clientOf(fields.device);
    const found = hub.find(fields.stream);
    if (found && found.kind !== 'stream') {
      throw new CommandError('not_stream', hub.language);
    }
    await hub.setStream(client, found?.item.id);
    return undefined;
  },

  async control_stream(hub, { fields }) {
    await hub.controlStream(hub.streamOf(fields.device), fields.command);
    return undefined;
  },

  async join_group(hub, { fields }) {
    await hub.join(hub.clientOf(fields.device), hub.clientOf(fields.target));
    return undefined;
  },

  async leave_group(hub, { fields }) {
    await hub.leave(hub.clientOf(fields.device));
    return undefined;
  },
};
