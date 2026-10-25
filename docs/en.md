# Snapcast

[Snapcast](https://github.com/badaix/snapcast) plays the same audio in sync in every room: a
`snapserver` receives the streams (Spotify through librespot, AirPlay, MPD, a radio, a pipe...) and
sends them to `snapclient`s, one per room. This integration brings the server into Gladys: the volume
and mute of each room, which stream each room plays, the groups of rooms, and scenes when a speaker
goes offline or a stream starts.

It does not play music itself: the music comes from the sources of your Snapcast server (MPD,
Spotify...). Tested against snapserver and snapclient 0.31 in Docker, without speakers: feedback
welcome.

## Requirements

- A Snapcast server (snapserver 0.26 or later; 0.31 tested) that Gladys can reach on the local
  network.
- Its JSON-RPC control port over TCP, **1705** by default, enabled (it is, unless the `[tcp]`
  section of `snapserver.conf` says `enabled = false`).
- Gladys 5.3 or later (Music player; version 1.0 of the integration stays for Gladys 5.1 and 5.2).

## Configuration

1. In Gladys, open **Integrations**, find **Snapcast** and install it.
2. **Server address**: the IP address or host name of the machine that runs snapserver, for
   example `192.168.1.20`. Add `:port`, or fill in **Control port**, if it is not 1705 (not the
   HTTP port 1780 of Snapweb).
3. **Language**: the language of the feature names and of the texts the integration creates. Feature
   names are set when a device is added: choose it before adding the devices.
4. Save. The integration connects, then shows each client and each stream in the **Discovery** tab
   of the integration: add the ones you want.

The integration keeps one connection open to the server and follows every change live: a volume
changed in Snapweb or another app shows up in Gladys at once. It reads the whole state again every
minute and after each reconnection.

## Devices

### Clients (rooms)

Each snapclient is a device, named after the name you gave it in Snapweb (or else its host name).

| Feature                       | What it does                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Volume                        | 0 to 100, in both directions                                                                                         |
| Mute                          | On = sound off, in both directions (the mute of the Music player)                                                    |
| Connected                     | Whether the snapclient is connected to the server                                                                    |
| Stream                        | The stream the room plays; choosing another one switches **its whole group**                                         |
| Playback state                | Playing (1), paused (0) or stopped (2), from the stream of the room; controllable when a stream has a control script |
| Now playing                   | Artist and title when the stream reports them, else the stream name and state                                        |
| Play, Pause                   | Act on the stream of the room, when a control script drives it (see Streams)                                         |
| Previous, Next                | Same                                                                                                                 |
| Title, Artist, Album, Artwork | What the stream of the room plays (see Music player)                                                                 |
| Duration, Position            | Of the current track; the position can be set when the stream can seek                                               |
| Shuffle, Repeat               | When a stream of the server reports them; act on the stream of the room                                              |

A client is a player for the Gladys **Music** box: add the box to a dashboard and choose the room
(see Gladys 5.3 Music player).

### Streams

Each stream of the server is a device too: its **playback state** (1 playing, 0 paused, 2 stopped)
and what it plays (**now playing**). A stream driven by a control script (librespot, MPD through `meta_mpd.py`, AirPlay,
Plexamp... see the Snapcast documentation) also has **Play**, **Pause**, **Previous** and **Next**
buttons. A plain pipe has no buttons: Snapcast cannot pause what it does not control.

There is no device per group: Snapcast deletes a group when it is emptied and gives a new one a new
identity, which would leave orphan devices in Gladys. Groups are handled through their clients
(stream choice, actions below).

## Gladys 5.3 Music player

Since Gladys 5.3, the dashboard **Music** box is a real player. Choose a room (a client): it shows what
the stream of its group plays (artwork, title, artist, album, progress bar), with play / pause,
previous / next, shuffle, repeat, and the volume and mute of the room.

- Title, artist, album, duration, position and artwork come from the **control script** of the
  stream (librespot, Mopidy through `meta_mopidy.py`, MPD through `meta_mpd.py`, AirPlay...). A plain
  pipe reports none: the box shows the stream name as the title, live, without a progress bar.
- Playback, position, shuffle and repeat commands act on the stream the room plays, so on **every
  room of its group**; volume and mute stay those of the room.
- What can be controlled depends on your streams: the playback state as soon as a stream of the
  server has a control script, the position as soon as a stream can seek, shuffle and repeat as soon
  as a stream reports them. A command the stream of the room cannot carry out is refused with a
  message.
- The artwork is the address given by the script, or the image sent within the stream (AirPlay). A
  heavy image is made smaller; the SVG logo librespot sends is not shown (a format Gladys refuses).
- No library, search or queue: Snapcast has none. Pick the music in the app of your source.

**Devices already added**: in the **Discovery** tab of the integration, click **Update** for each room.
It gets the new features, and its **Mute** becomes the mute of the Music player (same feature, scenes
kept). The offer comes back if a stream becomes controllable later. The **playback state** is now
**2** when nothing plays, instead of 0: a scene on "playback state = 0" now only runs on a pause.
**Now playing** stays available.

## Dashboard widget

**Snapcast rooms**:

- without a room chosen: every client with what it plays and its volume (or "Muted", "Offline"),
  and a **Mute all** / **Unmute all** button;
- with a room chosen: its state and volume, the buttons **Volume −**, **Volume +**, **Mute** /
  **Unmute**, and **Play** / **Pause** when its stream can be controlled, else **Next stream**.

## Scene triggers

| Trigger             | When                                                         | Variables             |
| ------------------- | ------------------------------------------------------------ | --------------------- |
| Client disconnected | A snapclient leaves the server (speaker off, network lost)   | client name           |
| Client connected    | A snapclient joins the server again                          | client name           |
| Stream started      | Audio starts flowing on a stream (someone casts to Spotify…) | stream, title, artist |
| Stream stopped      | A stream stops playing (paused, no more audio)               | stream, title, artist |

Each trigger can be limited to one client or one stream. Nothing fires for what happens while the
server itself is unreachable.

## Scene actions

| Action                        | What it does                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Set the volume of a room      | Volume of a client, 0 to 100                                                 |
| Mute or unmute every room     | Every client of the server; returns how many changed                         |
| Play another stream in a room | The client's group switches to the chosen stream                             |
| Control a stream              | Play, pause, play/pause, next, previous, on a stream or on what a room hears |
| Group two rooms               | The first client joins the group of the second, in sync                      |
| Ungroup a room                | The client gets a group of its own, same stream                              |

The volume, the mute and the stream of a room can also be set with the standard "Set device value"
action of Gladys.

## Scene examples

- **Quiet night**: at 11 pm, "Mute or unmute every room" → Mute. At 7 am, Unmute.
- **Morning radio**: at 7 am on weekdays, "Play another stream in a room" → Kitchen, stream Radio,
  then "Set the volume of a room" → Kitchen, 30.
- **Music follows you**: when "Stream started" on Spotify, "Group two rooms" → Living room joins
  Kitchen.
- **Speaker unplugged**: when "Client disconnected" on Bathroom, send a message.

## Troubleshooting

- **"The Snapcast server does not answer"**: check the address, that snapserver runs, and that the
  port is the TCP control port (1705 by default), not the stream port 1704 nor the HTTP port 1780.
  A firewall must let Gladys reach it.
- **A room shows "Offline"**: its snapclient is not connected to the server (machine off, wrong
  server address on the client).
- **"This stream cannot be controlled"**: the stream has no control script. Use a source that
  reports its player (librespot, MPD with `meta_mpd.py`…) or control the player itself.
- **A stream shows "Idle" while its player says playing**: no audio reaches snapserver; Snapcast
  reports what it receives.
- More detail: set the `LOG_LEVEL` of the integration to `debug`.

## Limits

- One Snapcast server per integration.
- No authentication: snapserver's control port has none by default. A server that requires one
  (optional in recent versions) is not supported.
- No device per group (see Streams); the latency of a client and the names are changed in Snapweb.
- The structure of a room device depends on what the streams of the server can do (see Music
  player): Gladys offers to **Update** it when a stream becomes controllable.
- The structure of a stream device depends on its control script: if a stream becomes controllable
  later, Gladys offers to **Update** it in the Discovery tab.
- Tested against snapserver and snapclient 0.31 in Docker, with a pipe stream and a scripted player,
  without speakers. Feedback welcome on the forum.
