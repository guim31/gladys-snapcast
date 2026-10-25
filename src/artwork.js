// -----------------------------------------------------------------------------
// The artwork of what a stream plays, for the Gladys 5.3 music player.
//
// A Snapcast control script reports the cover in the stream metadata, two
// ways (snapserver 0.27+, checked in its code and on the bench):
//   - `artUrl`: an address on the network (Mopidy, MusicBrainz...);
//   - `artData`: the image itself, base64, with its extension (AirPlay, a
//     custom script). Snapserver then adds an `artUrl` of its own HTTP server
//     (`http://<http.host>:1780/__image_cache?name=<md5>.<ext>`), whose host
//     name the container may not resolve: the embedded bytes are served
//     instead, from memory.
// librespot sends the Spotify logo as an SVG: the core takes PNG, JPEG or
// WebP only, so no artwork rather than one the core refuses.
//
// The core never fetches a URL and accepts 300 KB at most; local sources
// often give the cover at its size on disk: read up to 10 MB, then made a
// JPEG of 400 px at most (artwork-resize.js, copied from gladys-mopidy).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { MAX_ARTWORK_DOWNLOAD, prepareArtwork, readLimited } from './artwork-resize.js';

// Formats the core accepts, by the extension Snapcast reports.
const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

// Embedded images kept in memory: the current ones and a few before.
const EMBEDDED_KEPT = 8;

// Base64 of the largest image read (4 characters for 3 bytes).
const MAX_EMBEDDED_LENGTH = Math.ceil(MAX_ARTWORK_DOWNLOAD / 3) * 4;

const FETCH_TIMEOUT_MS = 10_000;

const isHttp = (url) => /^https?:\/\//i.test(url);

export class Artwork {
  /** @param {{ fetch?: Function }} [options] */
  constructor({ fetch } = {}) {
    this.fetch = fetch ?? ((...args) => globalThis.fetch(...args));
    this.embedded = new Map(); // source url -> base64, oldest first
  }

  /**
   * The source of the cover of a stream, for publishNowPlaying (`artwork_url`,
   * turned into a key by the SDK), or null. An embedded image is remembered
   * under that source.
   * @param {object|null} stream see src/snapcast/model.js
   * @returns {string|null}
   */
  urlOf(stream) {
    if (!stream) {
      return null;
    }
    const art = stream.artData;
    if (art) {
      const data = art.data.replace(/^data:[^,]*,/, '');
      if (!ACCEPTED_EXTENSIONS.has(art.extension) || data.length > MAX_EMBEDDED_LENGTH) {
        return null;
      }
      // The URL Snapserver made for it is content-addressed (an md5): it
      // names the image well. Without one, a hash of the data does.
      const url =
        stream.artUrl ||
        `snapcast-art:${createHash('sha1').update(data).digest('hex').slice(0, 20)}.${art.extension}`;
      this.#remember(url, data);
      return url;
    }
    const url = stream.artUrl;
    if (!isHttp(url) || /\.svg(?:[?#]|$)/i.test(url)) {
      return null;
    }
    return url;
  }

  #remember(url, data) {
    this.embedded.delete(url);
    this.embedded.set(url, data);
    while (this.embedded.size > EMBEDDED_KEPT) {
      this.embedded.delete(this.embedded.keys().next().value);
    }
  }

  /**
   * The bytes the core accepts for a source given by urlOf.
   * @param {string} url
   * @returns {Promise<Buffer>}
   */
  async read(url) {
    const data = this.embedded.get(url);
    if (data !== undefined) {
      return prepareArtwork(Buffer.from(data, 'base64'));
    }
    if (!isHttp(url)) {
      throw new Error('Image no longer reported by the stream');
    }
    const response = await this.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    if (Number(response.headers.get('content-length')) > MAX_ARTWORK_DOWNLOAD) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Image larger than ${MAX_ARTWORK_DOWNLOAD / 1024 / 1024} MB`);
    }
    return prepareArtwork(await readLimited(response.body, MAX_ARTWORK_DOWNLOAD));
  }
}
