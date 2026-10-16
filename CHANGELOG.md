# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-snapcast/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-snapcast/releases/tag/v1.0.0
