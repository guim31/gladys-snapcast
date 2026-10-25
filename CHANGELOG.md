# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.0] - 2026-10-25

### Added

- Gladys 5.3 Music player: each room shows what the stream of its group plays (title, artist,
  album, artwork, duration and position, shuffle and repeat), from the stream's control script,
  and the Music box drives it: play, pause and stop, seek, shuffle and repeat go to that stream,
  as far as it allows. A stream without a control script shows its name, live. Artworks sent by
  URL or embedded in the stream (AirPlay) are served, made smaller when above 300 KB. Open the
  **Discovery** tab and **Update** each room and stream already added.

### Changed

- Requires Gladys 5.3 or later (1.0.x stays for Gladys 5.1 and 5.2).
- The playback state of rooms and streams is now 2 (stopped) when nothing plays, instead of 0: a
  scene on "playback state = 0" now only runs on a pause.
- The mute of a room becomes the mute of the Music player (`music/mute`, same feature) once the
  room is updated from the Discovery tab: scenes that set or watch it keep working, but a scene that
  toggled it with the "turn on / off a switch" action must be redone with "control a device".
- The "Now playing" text feature stays, next to the new title and artist.

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-16

### Added

- First version: a Snapcast server in Gladys, followed live over its JSON-RPC control API.
- One device per snapclient (a room): volume, mute, connected, stream (a select of the server's
  streams, applied to the client's group), playback state, now playing, and play / pause / previous /
  next on its stream. The volume, playback buttons and state drive the core Music dashboard box.
- One device per stream: playback state and now playing, plus play / pause / previous / next when a
  control script drives the stream.
- Dashboard widget "Snapcast rooms": every room with what it plays and its volume, and "Mute all";
  or one room with its state, volume and buttons.
- Scene triggers: client disconnected, client connected, stream started, stream stopped.
- Scene actions: set the volume of a room, mute or unmute every room, play another stream in a room,
  control a stream, group two rooms, ungroup a room.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-snapcast/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/guim31/gladys-snapcast/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/guim31/gladys-snapcast/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-snapcast/releases/tag/v1.0.0
