# Snapcast

[Snapcast](https://github.com/badaix/snapcast) spielt denselben Ton synchron in allen Räumen: ein
`snapserver` empfängt die Streams (Spotify über librespot, AirPlay, MPD, ein Radio, eine Pipe…) und
schickt sie an die `snapclient`s, einen pro Raum. Diese Integration bringt den Server in Gladys: die
Lautstärke und Stummschaltung jedes Raums, welcher Stream in welchem Raum läuft, die Raumgruppen und
Szenen, wenn ein Lautsprecher offline geht oder ein Stream startet.

Die Integration spielt selbst keine Musik: Die Musik kommt aus den Quellen deines Snapcast-Servers (MPD,
Spotify…). Getestet mit snapserver und snapclient 0.31 in Docker, ohne Lautsprecher: Rückmeldungen
sind willkommen.

## Voraussetzungen

- Ein Snapcast-Server (snapserver 0.26 oder neuer; 0.31 getestet), den Gladys im lokalen Netzwerk
  erreicht.
- Sein JSON-RPC-Steuerport über TCP, standardmäßig **1705**, aktiviert (das ist er, außer der
  Abschnitt `[tcp]` von `snapserver.conf` sagt `enabled = false`).
- Gladys 5.1 oder neuer.

## Konfiguration

1. Öffne in Gladys **Integrationen**, suche **Snapcast** und installiere sie.
2. **Serveradresse**: die IP-Adresse oder der Hostname des Rechners, auf dem snapserver läuft, zum
   Beispiel `192.168.1.20`. Ergänze `:Port` oder fülle **Steuerport** aus, wenn es nicht 1705 ist
   (nicht der HTTP-Port 1780 von Snapweb).
3. **Sprache**: die Sprache der Funktionsnamen und der Texte, die die Integration erzeugt. Die Namen
   werden beim Hinzufügen eines Geräts festgelegt: wähle sie, bevor du die Geräte hinzufügst.
4. Speichere. Die Integration verbindet sich und zeigt dann jeden Client und jeden Stream im Tab
   **Erkennung** der Integration: füge die gewünschten hinzu.

Die Integration hält eine Verbindung zum Server offen und folgt jeder Änderung live: Eine in Snapweb
oder einer anderen App geänderte Lautstärke erscheint sofort in Gladys. Die Integration liest den ganzen Zustand
jede Minute und nach jeder Wiederverbindung neu.

## Geräte

### Clients (Räume)

Jeder snapclient ist ein Gerät, mit dem Namen, den du ihm in Snapweb gegeben hast (sonst dem Namen
seines Rechners).

| Funktion                         | Was sie tut                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Lautstärke                       | 0 bis 100, in beide Richtungen                                                     |
| Stumm                            | Ein = Ton aus, in beide Richtungen                                                 |
| Verbunden                        | Ob der snapclient mit dem Server verbunden ist                                     |
| Stream                           | Der Stream des Raums; ein anderer schaltet **seine ganze Gruppe** um               |
| Wiedergabestatus                 | Wiedergabe, wenn sein Stream Ton hat                                               |
| Aktuelle Wiedergabe              | Interpret und Titel, wenn der Stream sie meldet, sonst Name und Status des Streams |
| Wiedergabe, Pause                | Wirken auf den Stream des Raums, wenn ein Steuerskript ihn steuert (siehe Streams) |
| Vorheriger Titel, Nächster Titel | Ebenso                                                                             |

Ein Client hat Lautstärke, Wiedergabe, Pause und Wiedergabestatus, die die Gladys-Box **Musik**
erwartet: Füge die Box einem Dashboard hinzu und wähle den Raum.

### Streams

Jeder Stream des Servers ist auch ein Gerät: sein **Wiedergabestatus** und was er spielt
(**aktuelle Wiedergabe**). Ein Stream mit Steuerskript (librespot, MPD über `meta_mpd.py`, AirPlay,
Plexamp… siehe Snapcast-Dokumentation) hat außerdem die Tasten **Wiedergabe**, **Pause**,
**Vorheriger Titel** und **Nächster Titel**. Eine einfache Pipe hat keine: Snapcast kann nicht
pausieren, was es nicht steuert.

Es gibt kein Gerät pro Gruppe: Snapcast löscht eine geleerte Gruppe und gibt einer neuen eine neue
Kennung, was verwaiste Geräte in Gladys hinterlassen würde. Gruppen werden über ihre Clients
gesteuert (Stream-Wahl, Aktionen unten).

## Dashboard-Widget

**Snapcast-Räume**:

- ohne gewählten Raum: jeder Client mit dem, was er spielt, und seiner Lautstärke (oder „Stumm“,
  „Offline“), dazu eine Taste **Alle stumm** / **Alle Ton an**;
- mit gewähltem Raum: sein Status und seine Lautstärke, die Tasten **Leiser**, **Lauter**,
  **Stumm** / **Ton an**, und **Abspielen** / **Pause**, wenn sich sein Stream steuern lässt, sonst
  **Nächster Stream**.

## Szenen-Auslöser

| Auslöser         | Wann                                                                | Variablen                |
| ---------------- | ------------------------------------------------------------------- | ------------------------ |
| Client getrennt  | Ein snapclient verlässt den Server (Lautsprecher aus, Netzwerk weg) | Client-Name              |
| Client verbunden | Ein snapclient verbindet sich wieder mit dem Server                 | Client-Name              |
| Stream gestartet | Auf einem Stream kommt Ton an (jemand spielt über Spotify…)         | Stream, Titel, Interpret |
| Stream gestoppt  | Ein Stream hört auf zu spielen (pausiert, kein Ton mehr)            | Stream, Titel, Interpret |

Jeder Auslöser lässt sich auf einen Client oder einen Stream beschränken. Nichts wird ausgelöst für
das, was passiert, während der Server selbst nicht erreichbar ist.

## Szenen-Aktionen

| Aktion                               | Was sie tut                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Lautstärke eines Raums einstellen    | Lautstärke eines Clients, 0 bis 100                                                      |
| Überall stumm schalten oder Ton an   | Alle Clients des Servers; gibt zurück, wie viele geändert wurden                         |
| Anderen Stream in einem Raum spielen | Die Gruppe des Clients wechselt auf den gewählten Stream                                 |
| Stream steuern                       | Abspielen, Pause, Abspielen/Pause, weiter, zurück, bei einem Stream oder dem eines Raums |
| Zwei Räume gruppieren                | Der erste Client tritt der Gruppe des zweiten bei, synchron                              |
| Raum aus der Gruppe lösen            | Der Client bildet eine eigene Gruppe, gleicher Stream                                    |

Lautstärke, Stummschaltung und Stream eines Raums lassen sich auch mit der Standardaktion
„Gerätewert setzen“ von Gladys einstellen.

## Szenen-Beispiele

- **Ruhige Nacht**: um 23 Uhr „Überall stumm schalten oder Ton an“ → Stumm. Um 7 Uhr Ton an.
- **Morgenradio**: werktags um 7 Uhr „Anderen Stream in einem Raum spielen“ → Küche, Stream Radio,
  dann „Lautstärke eines Raums einstellen“ → Küche, 30.
- **Die Musik folgt dir**: bei „Stream gestartet“ von Spotify „Zwei Räume gruppieren“ → das
  Wohnzimmer tritt der Küche bei.
- **Lautsprecher ausgesteckt**: bei „Client getrennt“ im Bad eine Nachricht senden.

## Fehlerbehebung

- **„Der Snapcast-Server antwortet nicht“**: Prüfe die Adresse, ob snapserver läuft und ob der Port
  der TCP-Steuerport ist (standardmäßig 1705), weder der Stream-Port 1704 noch der HTTP-Port 1780.
  Eine Firewall muss Gladys durchlassen.
- **Ein Raum zeigt „Offline“**: Sein snapclient ist nicht mit dem Server verbunden (Rechner aus,
  falsche Serveradresse auf dem Client).
- **„Dieser Stream lässt sich nicht steuern“**: Der Stream hat kein Steuerskript. Nutze eine Quelle,
  die ihren Player meldet (librespot, MPD mit `meta_mpd.py`…), oder steuere den Player selbst.
- **Ein Stream zeigt „Inaktiv“, obwohl sein Player spielt**: Bei snapserver kommt kein Ton an;
  Snapcast meldet, was es empfängt.
- Mehr Details: Setze den `LOG_LEVEL` der Integration auf `debug`.

## Einschränkungen

- Ein Snapcast-Server pro Integration.
- Keine Authentifizierung: Der Steuerport von snapserver hat standardmäßig keine. Ein Server, der eine
  verlangt (Option neuerer Versionen), wird nicht unterstützt.
- Kein Gerät pro Gruppe (siehe Streams); die Latenz eines Clients und die Namen stellst du in Snapweb
  ein.
- Der Aufbau eines Stream-Geräts hängt von seinem Steuerskript ab: Wird ein Stream später steuerbar,
  bietet Gladys im Tab Erkennung **Aktualisieren** an.
- Getestet mit snapserver und snapclient 0.31 in Docker, mit einem Pipe-Stream und einem geskripteten
  Player, ohne Lautsprecher. Rückmeldungen im Forum sind willkommen.
