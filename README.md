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
  box drives a room (see below).
- **One device per stream**: playback state and what it plays, plus play / pause / previous / next
  when a control script drives it (librespot, MPD through `meta_mpd.py`, AirPlay...).
- **Gladys 5.3 Music player** (see below): title, artist, album, artwork, duration, position,
  shuffle and repeat of what a room hears.
- **Live**: one permanent connection, the server's notifications applied at once, a full read every
  minute and after each reconnection.
- **Dashboard widget "Snapcast rooms"**: every room with what it plays and its volume, and a "Mute
  all" button; or one room with its state, volume and buttons.
- **Scene triggers**: client disconnected, client connected, stream started, stream stopped.
- **Scene actions**: set the volume of a room, mute or unmute every room, play another stream in a
  room, control a stream, group two rooms, ungroup a room.
- Texts in English, French, German and Spanish.

## Gladys 5.3 Music player

Since Gladys 5.3 the core **Music** dashboard box is a full player, and each room (snapclient) is
one: it shows what the stream of the room's group plays, as reported by the stream's control script
(librespot, `meta_mopidy.py`, `meta_mpd.py`, AirPlay...), published through the SDK's
`publishNowPlaying` on Snapserver's notifications (never on a timer).

- **Now playing**: title, artist, album, duration and position from the stream properties
  (`Stream.OnProperties`); the position is a sample Snapserver keeps as the script sent it, so the
  integration remembers when it was taken and extrapolates it while playing. A stream without a
  control script (a plain pipe) shows its name as the title, live, with no progress bar; a room
  offline or hearing nothing is cleared (empty texts, playback state 2).
- **Commands** go to the stream the room plays (`Stream.Control`: play, pause, stop, setPosition;
  `Stream.SetProperty`: shuffle, loopStatus), confirmed by the script's next notification; volume
  and mute stay those of the room (`Client.SetVolume`). What is writable follows what the streams of
  the server have ever offered (`canControl`, `canSeek`, `shuffle`, `loopStatus`, remembered under
  `/data`), so a room switching streams does not change its device; a command the current stream
  cannot carry out is refused with a message.
- **Artwork**: the `artUrl` of the metadata, or the image embedded as `artData` (served from memory:
  the `__image_cache` address Snapserver makes for it names its own host, which the container may
  not resolve). Covers above the 300 KB the core accepts are made a 400 px JPEG in plain JavaScript
  (`src/artwork-resize.js`); librespot's SVG logo is skipped.
- **No catalog**: Snapcast has no library, search nor queue, so the manifest declares
  `"music": {}` (artwork only).
- **Upgrading from 1.0**: open the **Discovery** tab and **Update** each room. Its mute feature
  becomes `music/mute` in place (same external id, scenes kept). The playback state is now 2 (idle)
  when nothing plays, instead of 0. The "Now playing" text feature stays.

## Requirements

- Gladys Assistant **5.3** or later (1.0.x for Gladys 5.1 and 5.2).
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
- No library, search nor queue (Snapcast has none): pick the music in the app of the source.

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
