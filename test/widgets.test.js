// -----------------------------------------------------------------------------
// The "Snapcast rooms" widget: both views fit the core vocabulary and budget
// (validateWidgetContent), the buttons act on the server.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { KITCHEN, LIVING, MUSIC, RADIO } from './helpers/fakeSnapserver.js';
import { clientId, createAll, createWorld, until } from './helpers/world.js';
import { WIDGET_ACTIONS } from '../src/widgets.js';

async function world(t) {
  const w = await createWorld();
  t.after(() => w.stop());
  await createAll(w);
  return w;
}

const get = async (gladys, settings, language = 'en') => {
  const ack = await gladys.fake.widgetGet('rooms', { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'rendered as sent');
  return ack.data.content;
};

const buttons = (content) =>
  content.components.filter((c) => c.type === 'button').map((c) => c.action.key);

test('without a room: every client in a list, and "Mute all"', async (t) => {
  const { gladys, server } = await world(t);
  server.setVolume(KITCHEN, 30, true);
  await until(async () => (await get(gladys, {})).components[0].items[0].badge.text === 'Muted');
  const content = await get(gladys, {}, 'fr');
  const [list] = content.components;
  assert.deepEqual(
    list.items.map((i) => [i.title, i.subtitle, i.badge.text]),
    [
      ['kitchen-pi', 'Radio', 'Coupé'],
      ['livingroom-pi', 'Radio', '100 %'],
    ],
  );
  assert.deepEqual(buttons(content), ['mute_all']);

  const ack = await gladys.fake.widgetAction('rooms', 'mute_all', {}, { settings: {} });
  assert.equal(ack.data.message.fr, 'Son coupé.');
  assert.equal(server.client(LIVING).config.volume.muted, true);
  assert.deepEqual(buttons(await get(gladys, {})), ['unmute_all']);
});

test('one room: state, volume and its buttons', async (t) => {
  const { gladys, server } = await world(t);
  const settings = { device: clientId(LIVING) };
  let content = await get(gladys, settings);
  assert.deepEqual(content.components[0], {
    type: 'text',
    variant: 'heading',
    text: 'livingroom-pi',
  });
  assert.equal(content.components[1].text, 'Radio');
  assert.deepEqual(
    content.components[2].items.map((i) => i.value),
    ['Playing', '100 %'],
  );
  // Radio is a pipe: no play/pause.
  assert.deepEqual(buttons(content), ['volume_down', 'volume_up', 'mute', 'next_stream']);

  let ack = await gladys.fake.widgetAction('rooms', 'volume_down', {}, { settings });
  assert.equal(ack.data.message.en, 'Volume changed.');
  assert.equal(server.client(LIVING).config.volume.percent, 95);

  ack = await gladys.fake.widgetAction('rooms', 'next_stream', {}, { settings });
  assert.equal(ack.data.message.en, 'Next stream.');
  assert.equal(server.groupOf(LIVING).stream_id, MUSIC);
  content = await get(gladys, settings);
  assert.deepEqual(buttons(content), ['play_pause', 'volume_down', 'volume_up', 'mute']);
  assert.equal(content.components[1].text, 'Music · Idle');

  ack = await gladys.fake.widgetAction('rooms', 'play_pause', {}, { settings });
  assert.equal(ack.data.message.en, 'Done.');
  assert.deepEqual(server.calls.at(-1).params, { id: MUSIC, command: 'playPause' });

  await gladys.fake.widgetAction('rooms', 'next_stream', {}, { settings });
  assert.equal(server.groupOf(LIVING).stream_id, RADIO, 'round the list (an older widget)');

  await gladys.fake.widgetAction('rooms', 'mute', {}, { settings });
  assert.deepEqual(buttons(await get(gladys, settings)).at(2), 'unmute');
});

test('an unknown room, an offline server, and the error toasts', async (t) => {
  const { gladys, server } = await world(t);
  let content = await get(gladys, { device: 'ext:test-integration:client:gone' });
  assert.match(content.components[0].text, /not on the Snapcast server/);

  const settings = { device: clientId(LIVING) };
  const ack = await gladys.fake.widgetAction('rooms', 'play_pause', {}, { settings });
  assert.match(ack.data.message.en, /cannot be controlled/);

  await server.close();
  await until(() => gladys.fake.connectionStatus.connected === false, 2000, 'lost');
  content = await get(gladys, settings);
  assert.equal(content.components[2].items[0].value, 'Offline');
  assert.deepEqual(buttons(content), []);
  assert.deepEqual(buttons(await get(gladys, {})), []);
});

test('every widget button the code renders is a known action', () => {
  assert.deepEqual([...new Set(WIDGET_ACTIONS)].sort(), [
    'mute',
    'mute_all',
    'next_stream',
    'play_pause',
    'unmute',
    'unmute_all',
    'volume_down',
    'volume_up',
  ]);
});
