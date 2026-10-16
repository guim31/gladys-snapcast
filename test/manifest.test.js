// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES } from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { KITCHEN, LIVING, MUSIC } from './helpers/fakeSnapserver.js';
import { clientId, createAll, createWorld, streamId, until } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

test('identity: name, image, cover, local transport, multimedia category', () => {
  assert.equal(manifest.name, 'Snapcast');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-snapcast:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-snapcast/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['multimedia']);
  assert.equal(manifest.actions, undefined, 'no configuration action');
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`), manifest.docker_image);
});

test('scene triggers, scene actions and widgets: Gladys >= 5.1.0 (no widget form)', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('config_schema: the defaults and options of the code', () => {
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, `default of ${entry.key}`);
    }
  }
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(Object.keys(DEFAULT_CONFIG).sort(), keys.sort());
  assert.equal(field('port').default, 1705);
  assert.deepEqual(
    field('language').options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(field('language').default, 'fr');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('every scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    const ack = await world.gladys.fake.sceneAction(action.key, { device: 'unknown' });
    assert.doesNotMatch(ack.error ?? '', /not implemented/i, action.key);
  }
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
});

test('scene action fields and outputs are the ones the code reads and returns', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  await createAll(world);
  const fields = {
    device: clientId(LIVING),
    target: clientId(KITCHEN),
    stream: streamId(MUSIC),
    volume: 30,
    mode: 'mute',
    command: 'pause',
  };
  // leave_group last: join_group made a group to leave.
  for (const entry of manifest.scene_actions) {
    for (const declared of entry.fields) {
      assert.ok(declared.key in fields, `${entry.key}.${declared.key} is exercised`);
    }
    const ack = await world.gladys.fake.sceneAction(entry.key, fields);
    assert.equal(ack.success, true, `${entry.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data?.outputs ?? {}).sort(),
      keysOf(entry.outputs).sort(),
      entry.key,
    );
  }
  assert.deepEqual(keysOf(manifest.scene_actions).at(-1), 'leave_group');
  const volume = manifest.scene_actions.find((a) => a.key === 'set_volume').fields[1];
  assert.deepEqual([volume.min, volume.max], [0, 100]);
});

test('the scene triggers the hub fires are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.stop());
  await createAll(world);
  const count = () => world.gladys.fake.sceneEvents.length;
  world.server.setConnected(KITCHEN, false);
  world.server.setStreamStatus(MUSIC, 'playing');
  await until(() => count() === 2, 2000, 'disconnected, started');
  world.server.setConnected(KITCHEN, true);
  world.server.setStreamStatus(MUSIC, 'idle');
  await until(() => count() === 4, 2000, 'connected, stopped');
  const events = world.gladys.fake.sceneEvents;
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `${trigger.key} fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const variable of trigger.variables) {
      assert.equal(typeof event.data[variable.key], 'string', variable.key);
    }
    assert.equal(trigger.fields.find((f) => f.key === 'device').source, 'devices');
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `${field.key}.${key}`);
      }
    }
  }
});

test('scene actions: no secret field; a required field never relies on a default (#3155)', () => {
  for (const action of manifest.scene_actions) {
    for (const field of action.fields) {
      assert.notEqual(field.type, 'secret', `${action.key}.${field.key}`);
      assert.equal(field.default, undefined, `${action.key}.${field.key}`);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
