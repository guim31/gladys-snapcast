# Snapcast for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that drives a
[Snapcast](https://github.com/badaix/snapcast) multiroom audio server: the volume and mute of each
room, which stream each room plays, the groups of rooms, and scenes when a speaker goes offline or a
stream starts. It talks to `snapserver` over the local network, through its JSON-RPC control API
(TCP 1705). No cloud, no account.

It does not play music itself: the music comes from the sources of the Snapcast server (MPD,
Spotify through librespot, AirPlay...).

> **Tested against a real snapserver and two snapclients 0.31, in Docker, without speakers:
> feedback welcome.** Volume and mute both ways, stream changes, stream control through a control
> script, groups, client disconnection and server restart were exercised for real. Please report
> what works and what does not in the [issues](https://github.com/guim31/gladys-snapcast/issues).

## Features

- **One device per snapclient (a room)**, keyed on its Snapcast client id (MAC address or
  `--hostID`): volume, mute, connected, the stream it plays (a select of the server's streams),
  playback state, what it plays, and play / pause / previous / next on its stream. The volume,
  playback buttons and state belong to the Gladys **Music** category, so the core Music dashboard
  box drives a room.
- **One device per stream**: playback state and what it plays, plus play / pause / previous / next
  when a control script drives it (librespot, MPD through `meta_mpd.py`, AirPlay...).
- **Live**: one permanent connection, the server's notifications applied at once, a full read every
  minute and after each reconnection.
- **Dashboard widget "Snapcast rooms"**: every room with what it plays and its volume, and a "Mute
  all" button; or one room with its state, volume and buttons.
- **Scene triggers**: client disconnected, client connected, stream started, stream stopped.
- **Scene actions**: set the volume of a room, mute or unmute every room, play another stream in a
  room, control a stream, group two rooms, ungroup a room.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1** or later.
- A Snapcast server (snapserver 0.26 or later) reachable from Gladys on its TCP control port, 1705 by
  default.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and type
   `https://github.com/guim31/gladys-snapcast`.
2. Type the address of the Snapcast server.
3. Open the **Discovery** tab and add the rooms and streams.

The user documentation is in [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## Limitations

- One server per integration, typed by hand (the Gladys sandbox carries no mDNS of its own).
- No authentication on the control port (Snapcast's default).
- No device per group: Snapcast deletes an emptied group and gives a new one a new id, while a
  Gladys device id is forever. Groups are handled through their clients.
- The music features have no row in the "devices in a room" box of Gladys (only the Music box and
  the widget show them).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and a scripted Snapserver on the loopback
(`test/helpers/fakeSnapserver.js`), built on the status and notifications recorded on snapserver
0.31 (`test/fixtures/snapcast/`, anonymized).

## Credits

- [Snapcast](https://github.com/badaix/snapcast) (GPL-3.0) by Johannes Pohl (badaix) and
  contributors, and its JSON-RPC control API documentation.
- The Home Assistant `snapcast` integration and the
  [python `snapcast` library](https://github.com/happyleavesaoc/python-snapcast) (MIT), for the list
  of methods and notifications.
- The [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and template.

## Disclaimer

This project is not affiliated with, endorsed by or sponsored by the Snapcast project.

## License

[Apache-2.0](LICENSE).
