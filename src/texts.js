// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of Gladys (German
// says "du", Spanish "usted"). Feature names follow the configured `language`
// (frozen by Gladys once a device is added); action and widget messages are
// multi-language objects, Gladys picks the user's language.
// -----------------------------------------------------------------------------

export const pick = (table, language) => table[language] ?? table.en;

// Feature names of a client (a room).
export const CLIENT_NAMES = {
  en: {
    volume: 'Volume',
    mute: 'Mute',
    connected: 'Connected',
    stream: 'Stream',
    playback_state: 'Playback state',
    now_playing: 'Now playing',
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous',
    next: 'Next',
  },
  fr: {
    volume: 'Volume',
    mute: 'Sourdine',
    connected: 'Connecté',
    stream: 'Flux',
    playback_state: 'État de lecture',
    now_playing: 'En cours',
    play: 'Lecture',
    pause: 'Pause',
    previous: 'Précédent',
    next: 'Suivant',
  },
  de: {
    volume: 'Lautstärke',
    mute: 'Stumm',
    connected: 'Verbunden',
    stream: 'Stream',
    playback_state: 'Wiedergabestatus',
    now_playing: 'Aktuelle Wiedergabe',
    play: 'Wiedergabe',
    pause: 'Pause',
    previous: 'Vorheriger Titel',
    next: 'Nächster Titel',
  },
  es: {
    volume: 'Volumen',
    mute: 'Silencio',
    connected: 'Conectado',
    stream: 'Fuente',
    playback_state: 'Estado de reproducción',
    now_playing: 'Reproduciendo',
    play: 'Reproducir',
    pause: 'Pausa',
    previous: 'Anterior',
    next: 'Siguiente',
  },
};

// Feature names of a stream (a source).
export const STREAM_NAMES = {
  en: {
    playback_state: 'Playback state',
    now_playing: 'Now playing',
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous',
    next: 'Next',
  },
  fr: {
    playback_state: 'État de lecture',
    now_playing: 'En cours',
    play: 'Lecture',
    pause: 'Pause',
    previous: 'Précédent',
    next: 'Suivant',
  },
  de: {
    playback_state: 'Wiedergabestatus',
    now_playing: 'Aktuelle Wiedergabe',
    play: 'Wiedergabe',
    pause: 'Pause',
    previous: 'Vorheriger Titel',
    next: 'Nächster Titel',
  },
  es: {
    playback_state: 'Estado de reproducción',
    now_playing: 'Reproduciendo',
    play: 'Reproducir',
    pause: 'Pausa',
    previous: 'Anterior',
    next: 'Siguiente',
  },
};

// What a stream does, or a client that is not connected.
export const STATE_LABELS = {
  en: {
    playing: 'Playing',
    paused: 'Paused',
    idle: 'Idle',
    disabled: 'Disabled',
    unknown: 'Unknown',
    offline: 'Offline',
  },
  fr: {
    playing: 'En lecture',
    paused: 'En pause',
    idle: 'Inactif',
    disabled: 'Désactivé',
    unknown: 'Inconnu',
    offline: 'Hors ligne',
  },
  de: {
    playing: 'Wiedergabe',
    paused: 'Pausiert',
    idle: 'Inaktiv',
    disabled: 'Deaktiviert',
    unknown: 'Unbekannt',
    offline: 'Offline',
  },
  es: {
    playing: 'Reproduciendo',
    paused: 'En pausa',
    idle: 'Inactivo',
    disabled: 'Desactivado',
    unknown: 'Desconocido',
    offline: 'Sin conexión',
  },
};

export const INIT_FAILED = {
  en: 'The Snapcast integration could not start. See its logs.',
  fr: "L'intégration Snapcast n'a pas pu démarrer. Consultez ses journaux.",
  de: 'Die Snapcast-Integration konnte nicht starten. Sieh in ihre Protokolle.',
  es: 'La integración Snapcast no pudo iniciarse. Consulte sus registros.',
};

// The connection status shown on the integration page.
export const STATUS_TEXT = {
  not_configured: {
    en: 'Type the address of your Snapcast server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Snapcast dans la configuration.",
    de: 'Gib die Adresse deines Snapcast-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Snapcast en la configuración.',
  },
  invalid_host: {
    en: 'The server address is not valid: an IP address or a host name, with :port if needed.',
    fr: "L'adresse du serveur n'est pas valide : une adresse IP ou un nom d'hôte, avec :port au besoin.",
    de: 'Die Serveradresse ist ungültig: eine IP-Adresse oder ein Hostname, bei Bedarf mit :Port.',
    es: 'La dirección del servidor no es válida: una dirección IP o un nombre de host, con :puerto si hace falta.',
  },
  unreachable: {
    en: 'The Snapcast server does not answer. Check its address, its port (1705) and that it runs.',
    fr: 'Le serveur Snapcast ne répond pas. Vérifiez son adresse, son port (1705) et qu’il tourne.',
    de: 'Der Snapcast-Server antwortet nicht. Prüfe Adresse, Port (1705) und ob er läuft.',
    es: 'El servidor Snapcast no responde. Compruebe su dirección, su puerto (1705) y que esté en marcha.',
  },
};

// Why a command failed (scene actions, widget, device controls).
export const COMMAND_ERRORS = {
  not_configured: STATUS_TEXT.not_configured,
  unreachable: {
    en: 'The Snapcast server is unreachable.',
    fr: 'Le serveur Snapcast est injoignable.',
    de: 'Der Snapcast-Server ist nicht erreichbar.',
    es: 'El servidor Snapcast no está accesible.',
  },
  rpc: {
    en: 'The Snapcast server refused the command.',
    fr: 'Le serveur Snapcast a refusé la commande.',
    de: 'Der Snapcast-Server hat den Befehl abgelehnt.',
    es: 'El servidor Snapcast rechazó el comando.',
  },
  unknown_device: {
    en: 'This device is not on the Snapcast server anymore.',
    fr: "Cet appareil n'est plus sur le serveur Snapcast.",
    de: 'Dieses Gerät ist nicht mehr auf dem Snapcast-Server.',
    es: 'Este dispositivo ya no está en el servidor Snapcast.',
  },
  not_client: {
    en: 'Choose a Snapcast client (a room), not a stream.',
    fr: 'Choisissez un client Snapcast (une pièce), pas un flux.',
    de: 'Wähle einen Snapcast-Client (einen Raum), keinen Stream.',
    es: 'Elija un cliente Snapcast (una habitación), no una fuente.',
  },
  not_stream: {
    en: 'Choose a Snapcast stream, not a client.',
    fr: 'Choisissez un flux Snapcast, pas un client.',
    de: 'Wähle einen Snapcast-Stream, keinen Client.',
    es: 'Elija una fuente Snapcast, no un cliente.',
  },
  not_controllable: {
    en: 'This stream cannot be controlled: only streams with a control script (Spotify, MPD, AirPlay...) can.',
    fr: 'Ce flux ne se pilote pas : seuls les flux dotés d’un script de contrôle (Spotify, MPD, AirPlay…) le peuvent.',
    de: 'Dieser Stream lässt sich nicht steuern: nur Streams mit Steuerskript (Spotify, MPD, AirPlay…) können das.',
    es: 'Esta fuente no se puede controlar: solo las que tienen un script de control (Spotify, MPD, AirPlay…).',
  },
  no_stream: {
    en: 'This room plays no stream.',
    fr: 'Cette pièce ne joue aucun flux.',
    de: 'Dieser Raum spielt keinen Stream.',
    es: 'Esta habitación no reproduce ninguna fuente.',
  },
  bad_volume: {
    en: 'The volume must be a number from 0 to 100.',
    fr: 'Le volume doit être un nombre de 0 à 100.',
    de: 'Die Lautstärke muss eine Zahl von 0 bis 100 sein.',
    es: 'El volumen debe ser un número de 0 a 100.',
  },
  bad_command: {
    en: 'Unknown command.',
    fr: 'Commande inconnue.',
    de: 'Unbekannter Befehl.',
    es: 'Comando desconocido.',
  },
  same_client: {
    en: 'Choose two different clients.',
    fr: 'Choisissez deux clients différents.',
    de: 'Wähle zwei verschiedene Clients.',
    es: 'Elija dos clientes distintos.',
  },
};

export const commandMessage = (code) => COMMAND_ERRORS[code] ?? COMMAND_ERRORS.rpc;

// The toast of a widget button.
export const DONE_TEXT = {
  play_pause: { en: 'Done.', fr: 'C’est fait.', de: 'Erledigt.', es: 'Hecho.' },
  volume: {
    en: 'Volume changed.',
    fr: 'Volume modifié.',
    de: 'Lautstärke geändert.',
    es: 'Volumen cambiado.',
  },
  mute: { en: 'Sound off.', fr: 'Son coupé.', de: 'Ton aus.', es: 'Sonido apagado.' },
  unmute: { en: 'Sound on.', fr: 'Son rétabli.', de: 'Ton an.', es: 'Sonido activado.' },
  stream: {
    en: 'Next stream.',
    fr: 'Flux suivant.',
    de: 'Nächster Stream.',
    es: 'Fuente siguiente.',
  },
};
