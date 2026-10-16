// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `rooms`, "Snapcast
// rooms".
//
// Without a chosen client: every client in a list (name, what it hears, a
// badge: volume, muted or offline) and a "Mute all" or "Unmute all" button.
// With a chosen client: its name, what it hears, a status list (state,
// volume) and four buttons — volume down and up, mute or unmute, and
// play/pause when the stream can be controlled, else "next stream".
// Budget: at most 2 texts, 1 status, 4 buttons (the core drops a fifth).
// No button opens a form: Gladys 5.1 is enough.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { clientIds, clientText, streamState } from './devices.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { nowPlaying, streamOfClient } from './snapcast/model.js';
import { DONE_TEXT, STATE_LABELS, pick } from './texts.js';

export { WIDGET_KEY };

export const VOLUME_STEP = 5;

export const TEXT = {
  empty: {
    en: 'No client on the Snapcast server yet.',
    fr: 'Aucun client sur le serveur Snapcast pour le moment.',
    de: 'Noch kein Client auf dem Snapcast-Server.',
    es: 'Todavía no hay clientes en el servidor Snapcast.',
  },
  unknown: {
    en: 'This client is not on the Snapcast server anymore.',
    fr: "Ce client n'est plus sur le serveur Snapcast.",
    de: 'Dieser Client ist nicht mehr auf dem Snapcast-Server.',
    es: 'Este cliente ya no está en el servidor Snapcast.',
  },
  unavailable: {
    en: 'The Snapcast server is unavailable.',
    fr: 'Le serveur Snapcast est indisponible.',
    de: 'Der Snapcast-Server ist nicht erreichbar.',
    es: 'El servidor Snapcast no está disponible.',
  },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  muted: { en: 'Muted', fr: 'Coupé', de: 'Stumm', es: 'Silenciado' },
  stream: { en: 'Stream', fr: 'Flux', de: 'Stream', es: 'Fuente' },
  play: { en: 'Play', fr: 'Lire', de: 'Abspielen', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  volume_down: { en: 'Volume −', fr: 'Volume −', de: 'Leiser', es: 'Volumen −' },
  volume_up: { en: 'Volume +', fr: 'Volume +', de: 'Lauter', es: 'Volumen +' },
  mute: { en: 'Mute', fr: 'Couper', de: 'Stumm', es: 'Silenciar' },
  unmute: { en: 'Unmute', fr: 'Rétablir', de: 'Ton an', es: 'Activar' },
  next_stream: { en: 'Next stream', fr: 'Flux suivant', de: 'Nächster Stream', es: 'Otra fuente' },
  mute_all: { en: 'Mute all', fr: 'Tout couper', de: 'Alle stumm', es: 'Silenciar todo' },
  unmute_all: {
    en: 'Unmute all',
    fr: 'Tout rétablir',
    de: 'Alle Ton an',
    es: 'Activar todo',
  },
};

export const WIDGET_ACTIONS = [
  'play_pause',
  'volume_down',
  'volume_up',
  'mute',
  'unmute',
  'next_stream',
  'mute_all',
  'unmute_all',
];

const COLORS = {
  playing: WIDGET_COLORS.SUCCESS,
  paused: WIDGET_COLORS.WARNING,
  idle: WIDGET_COLORS.NEUTRAL,
  disabled: WIDGET_COLORS.NEUTRAL,
  unknown: WIDGET_COLORS.NEUTRAL,
  offline: WIDGET_COLORS.DANGER,
};

const textOnly = (text, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text }],
});

const button = (lang, key, icon, label = key) => ({
  type: 'button',
  label: pick(TEXT[label], lang),
  icon,
  action: { key },
});

/** playing | paused | idle | disabled | unknown | offline */
function stateOf(hub, client) {
  if (!hub.online || !client.connected) {
    return 'offline';
  }
  return streamState(streamOfClient(hub.model, client));
}

function volumeText(client, lang) {
  if (client.muted) {
    return pick(TEXT.muted, lang);
  }
  return client.volume === null ? '–' : `${client.volume} %`;
}

function listContent(hub, lang) {
  // A card list holds 8 rows: beyond, pick a client in the widget settings.
  const clients = [...hub.model.clients.values()].slice(0, 8);
  if (clients.length === 0) {
    return textOnly(pick(hub.online ? TEXT.empty : TEXT.unavailable, lang));
  }
  const components = [
    {
      type: 'card-list',
      display: 'list',
      items: clients.map((client) => {
        const state = stateOf(hub, client);
        return {
          title: hub.clientName(client).slice(0, 60),
          subtitle: clientText(client, hub.model, lang).slice(0, 120),
          badge: {
            text: (state === 'offline'
              ? pick(STATE_LABELS, lang).offline
              : volumeText(client, lang)
            ).slice(0, 16),
            color: client.muted ? WIDGET_COLORS.WARNING : COLORS[state],
          },
        };
      }),
    },
  ];
  if (hub.online) {
    const anyOn = [...hub.model.clients.values()].some((c) => c.connected && !c.muted);
    components.push(
      anyOn ? button(lang, 'mute_all', 'volume-x') : button(lang, 'unmute_all', 'volume-2'),
    );
  }
  return { ttl_seconds: 60, components };
}

function clientContent(hub, client, lang) {
  const state = stateOf(hub, client);
  const stream = streamOfClient(hub.model, client);
  const components = [
    { type: 'text', variant: 'heading', text: hub.clientName(client).slice(0, 40) },
    {
      type: 'text',
      variant: 'caption',
      // clientText names the stream unless it plays something with a title.
      text: (state === 'playing' && nowPlaying(stream)
        ? `${hub.streamName(stream)} · ${nowPlaying(stream)}`
        : clientText(client, hub.model, lang)
      ).slice(0, 80),
    },
  ];
  const items = [
    {
      label: pick(TEXT.state, lang),
      value: pick(STATE_LABELS, lang)[state].slice(0, 40),
      color: COLORS[state],
    },
  ];
  if (hub.online) {
    items.push({
      label: pick(TEXT.volume, lang),
      value: client.muted
        ? `${client.volume ?? '–'} % (${pick(TEXT.muted, lang)})`
        : volumeText(client, lang),
      icon: client.muted ? 'volume-x' : 'volume-2',
    });
  }
  components.push({ type: 'status', items });
  if (hub.online) {
    if (stream?.canControl) {
      components.push(
        state === 'playing'
          ? button(lang, 'play_pause', 'pause', 'pause')
          : button(lang, 'play_pause', 'play', 'play'),
      );
    }
    components.push(
      button(lang, 'volume_down', 'volume-1'),
      button(lang, 'volume_up', 'volume-2'),
      client.muted ? button(lang, 'unmute', 'volume-2') : button(lang, 'mute', 'volume-x'),
    );
    // The core keeps 4 buttons: play/pause takes the place of "next stream".
    if (!stream?.canControl && hub.model.streams.size > 1) {
      components.push(button(lang, 'next_stream', 'shuffle'));
    }
  }
  return { ttl_seconds: state === 'playing' ? 30 : 120, components };
}

/**
 * @param {object} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function buildContent(hub, { settings = {}, language = 'en' } = {}) {
  const lang = STATE_LABELS[language] ? language : 'en';
  if (typeof settings.device !== 'string' || settings.device === '') {
    return listContent(hub, lang);
  }
  const client = [...hub.model.clients.values()].find(
    (candidate) => clientIds(hub.gladys, candidate.id).device === settings.device,
  );
  if (!client) {
    return textOnly(pick(hub.online ? TEXT.unknown : TEXT.unavailable, lang), 300);
  }
  return clientContent(hub, client, lang);
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (a widget action receives no language: all four). */
    async action(hub, { actionKey, settings = {} }) {
      try {
        if (actionKey === 'mute_all' || actionKey === 'unmute_all') {
          await hub.muteAll(actionKey === 'mute_all');
          return actionKey === 'mute_all' ? DONE_TEXT.mute : DONE_TEXT.unmute;
        }
        const client = hub.clientOf(settings.device);
        switch (actionKey) {
          case 'play_pause':
            await hub.controlStream(hub.streamOf(settings.device), 'play_pause');
            return DONE_TEXT.play_pause;
          case 'volume_down':
          case 'volume_up': {
            const step = actionKey === 'volume_up' ? VOLUME_STEP : -VOLUME_STEP;
            const volume = Math.max(0, Math.min(100, (client.volume ?? 50) + step));
            await hub.setVolume(client, volume);
            return DONE_TEXT.volume;
          }
          case 'mute':
          case 'unmute':
            await hub.setMute(client, actionKey === 'mute');
            return DONE_TEXT[actionKey];
          case 'next_stream':
            await hub.nextStream(client);
            return DONE_TEXT.stream;
          default:
            throw new Error(`Unknown widget action ${actionKey}`);
        }
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
    },
  },
};
