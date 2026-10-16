// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Snapserver's JSON-RPC control port over raw TCP (one JSON object per line).
export const DEFAULT_PORT = 1705;

export const DEFAULT_CONFIG = {
  host: '',
  port: DEFAULT_PORT,
  language: 'fr',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function portOf(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(number) && number >= 1 && number <= 65535 ? number : null;
}

/**
 * The server address the user typed: `192.0.2.10`, `snapserver.lan`,
 * `192.0.2.10:1705` or `[2001:db8::1]:1705`. A `tcp://` prefix is accepted.
 * Returns null when it is not usable.
 * @returns {{ host: string, port: number|null } | null}
 */
export function parseHost(raw) {
  const typed = text(raw).replace(/^tcp:\/\//i, '');
  if (typed === '' || /[\s/@?#]/.test(typed)) {
    return null;
  }
  let url;
  try {
    url = new URL(`tcp://${typed}`);
  } catch {
    return null;
  }
  if (url.hostname === '') {
    return null;
  }
  // net.connect wants an IPv6 address without its brackets.
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : null };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const parsed = parseHost(source.host);
  return {
    configured: text(source.host) !== '',
    valid: parsed !== null,
    host: parsed?.host ?? '',
    port: parsed?.port ?? portOf(source.port) ?? DEFAULT_PORT,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
