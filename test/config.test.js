import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHost } from '../src/config.js';

test('the server address: IP, host name, port, IPv6, tcp://', () => {
  assert.deepEqual(parseHost('192.0.2.10'), { host: '192.0.2.10', port: null });
  assert.deepEqual(parseHost(' snapserver.lan:1800 '), { host: 'snapserver.lan', port: 1800 });
  assert.deepEqual(parseHost('[2001:db8::1]:1705'), { host: '2001:db8::1', port: 1705 });
  assert.deepEqual(parseHost('tcp://192.0.2.10'), { host: '192.0.2.10', port: null });
  for (const wrong of ['', 'http://192.0.2.10/x', 'user@host', 'a b', '192.0.2.10:99999']) {
    assert.equal(parseHost(wrong), null, wrong);
  }
});

test('normalized configuration: defaults, port field, language', () => {
  assert.deepEqual(normalizeConfig({}), {
    configured: false,
    valid: false,
    host: '',
    port: 1705,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig({ host: '192.0.2.10', port: '1800', language: 'de' }), {
    configured: true,
    valid: true,
    host: '192.0.2.10',
    port: 1800,
    language: 'de',
  });
  assert.equal(normalizeConfig({ host: '192.0.2.10:1900', port: 1800 }).port, 1900);
  assert.equal(normalizeConfig({ host: '192.0.2.10', port: 0 }).port, 1705);
  assert.equal(normalizeConfig({ host: 'x', language: 'it' }).language, 'fr');
});
