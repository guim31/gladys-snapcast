# Snapcast

[Snapcast](https://github.com/badaix/snapcast) joue le même son, synchronisé, dans toutes les pièces :
un `snapserver` reçoit les flux (Spotify via librespot, AirPlay, MPD, une radio, un pipe…) et les
envoie aux `snapclient`, un par pièce. Cette intégration amène le serveur dans Gladys : le volume et la
sourdine de chaque pièce, le flux joué dans chaque pièce, les groupes de pièces, et des scènes quand
une enceinte se déconnecte ou qu'un flux démarre.

Elle ne joue pas la musique elle-même : la musique vient des sources de votre serveur Snapcast (MPD,
Spotify…). Testée avec snapserver et snapclient 0.31 en Docker, sans enceintes : vos retours sont les
bienvenus.

## Prérequis

- Un serveur Snapcast (snapserver 0.26 ou plus récent ; 0.31 testé) que Gladys peut joindre sur le
  réseau local.
- Son port de contrôle JSON-RPC en TCP, **1705** par défaut, actif (il l'est, sauf si la section
  `[tcp]` de `snapserver.conf` indique `enabled = false`).
- Gladys 5.1 ou plus récent.

## Configuration

1. Dans Gladys, ouvrez **Intégrations**, cherchez **Snapcast** et installez-la.
2. **Adresse du serveur** : l'adresse IP ou le nom d'hôte de la machine qui fait tourner snapserver,
   par exemple `192.168.1.20`. Ajoutez `:port`, ou remplissez **Port de contrôle**, s'il ne s'agit
   pas du 1705 (et pas du port HTTP 1780 de Snapweb).
3. **Langue** : la langue des noms des fonctionnalités et des textes créés par l'intégration. Les noms
   sont fixés à l'ajout d'un appareil : choisissez-la avant d'ajouter les appareils.
4. Enregistrez. L'intégration se connecte, puis affiche chaque client et chaque flux dans l'onglet
   **Découverte** de l'intégration : ajoutez ceux que vous voulez.

L'intégration garde une connexion ouverte avec le serveur et suit chaque changement en direct : un
volume changé dans Snapweb ou une autre application apparaît aussitôt dans Gladys. Elle relit tout
l'état chaque minute et après chaque reconnexion.

## Appareils

### Clients (pièces)

Chaque snapclient est un appareil, au nom que vous lui avez donné dans Snapweb (ou à défaut au nom
de sa machine).

| Fonctionnalité     | Ce qu'elle fait                                                                     |
| ------------------ | ----------------------------------------------------------------------------------- |
| Volume             | 0 à 100, dans les deux sens                                                         |
| Sourdine           | Activée = son coupé, dans les deux sens                                             |
| Connecté           | Le snapclient est-il connecté au serveur                                            |
| Flux               | Le flux joué dans la pièce ; en choisir un autre bascule **tout son groupe**        |
| État de lecture    | En lecture quand son flux reçoit du son                                             |
| En cours           | Artiste et titre quand le flux les donne, sinon le nom et l'état du flux            |
| Lecture, Pause     | Agissent sur le flux de la pièce, quand un script de contrôle le pilote (voir Flux) |
| Précédent, Suivant | Idem                                                                                |

Un client a le volume, la lecture, la pause et l'état de lecture qu'attend la boîte **Musique** de
Gladys : ajoutez la boîte à un tableau de bord et choisissez la pièce.

### Flux

Chaque flux du serveur est aussi un appareil : son **état de lecture** et ce qu'il joue (**en
cours**). Un flux piloté par un script de contrôle (librespot, MPD via `meta_mpd.py`, AirPlay,
Plexamp… voir la documentation de Snapcast) a aussi les boutons **Lecture**, **Pause**,
**Précédent** et **Suivant**. Un simple pipe n'en a pas : Snapcast ne peut pas mettre en pause ce
qu'il ne pilote pas.

Il n'y a pas d'appareil par groupe : Snapcast supprime un groupe vidé et donne une nouvelle identité
à un nouveau groupe, ce qui laisserait des appareils orphelins dans Gladys. Les groupes se gèrent par
leurs clients (choix du flux, actions plus bas).

## Widget de tableau de bord

**Pièces Snapcast** :

- sans pièce choisie : chaque client avec ce qu'il joue et son volume (ou « Coupé », « Hors
  ligne »), et un bouton **Tout couper** / **Tout rétablir** ;
- avec une pièce choisie : son état et son volume, les boutons **Volume −**, **Volume +**,
  **Couper** / **Rétablir**, et **Lire** / **Pause** quand son flux se pilote, sinon **Flux
  suivant**.

## Déclencheurs de scène

| Déclencheur       | Quand                                                            | Variables            |
| ----------------- | ---------------------------------------------------------------- | -------------------- |
| Client déconnecté | Un snapclient quitte le serveur (enceinte éteinte, réseau perdu) | nom du client        |
| Client connecté   | Un snapclient rejoint le serveur                                 | nom du client        |
| Flux démarré      | Du son arrive sur un flux (quelqu'un diffuse sur Spotify…)       | flux, titre, artiste |
| Flux arrêté       | Un flux cesse de jouer (en pause, plus de son)                   | flux, titre, artiste |

Chaque déclencheur peut se limiter à un client ou à un flux. Rien ne se déclenche pour ce qui arrive
pendant que le serveur lui-même est injoignable.

## Actions de scène

| Action                            | Ce qu'elle fait                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Régler le volume d'une pièce      | Volume d'un client, de 0 à 100                                                           |
| Couper ou rétablir le son partout | Tous les clients du serveur ; renvoie le nombre de clients modifiés                      |
| Changer le flux d'une pièce       | Le groupe du client passe sur le flux choisi                                             |
| Piloter un flux                   | Lecture, pause, lecture/pause, suivant, précédent, sur un flux ou ce qu'entend une pièce |
| Grouper deux pièces               | Le premier client rejoint le groupe du second, en synchro                                |
| Dégrouper une pièce               | Le client forme un groupe à lui seul, même flux                                          |

Le volume, la sourdine et le flux d'une pièce se règlent aussi avec l'action standard « Contrôler un
appareil » de Gladys.

## Exemples de scènes

- **Nuit calme** : à 23 h, « Couper ou rétablir le son partout » → Couper. À 7 h, Rétablir.
- **Radio du matin** : à 7 h en semaine, « Changer le flux d'une pièce » → Cuisine, flux Radio, puis
  « Régler le volume d'une pièce » → Cuisine, 30.
- **La musique vous suit** : sur « Flux démarré » de Spotify, « Grouper deux pièces » → le Salon
  rejoint la Cuisine.
- **Enceinte débranchée** : sur « Client déconnecté » de la Salle de bain, envoyer un message.

## Dépannage

- **« Le serveur Snapcast ne répond pas »** : vérifiez l'adresse, que snapserver tourne, et que le
  port est bien le port de contrôle TCP (1705 par défaut), ni le port des flux 1704 ni le port HTTP 1780. Un pare-feu doit laisser passer Gladys.
- **Une pièce indique « Hors ligne »** : son snapclient n'est pas connecté au serveur (machine
  éteinte, mauvaise adresse de serveur sur le client).
- **« Ce flux ne se pilote pas »** : le flux n'a pas de script de contrôle. Utilisez une source qui
  décrit son lecteur (librespot, MPD avec `meta_mpd.py`…) ou pilotez le lecteur lui-même.
- **Un flux indique « Inactif » alors que son lecteur dit lire** : aucun son n'arrive à snapserver ;
  Snapcast indique ce qu'il reçoit.
- Plus de détails : passez le `LOG_LEVEL` de l'intégration à `debug`.

## Limites

- Un seul serveur Snapcast par intégration.
- Pas d'authentification : le port de contrôle de snapserver n'en a pas par défaut. Un serveur qui en
  exige une (option des versions récentes) n'est pas pris en charge.
- Pas d'appareil par groupe (voir Flux) ; la latence d'un client et les noms se règlent dans Snapweb.
- La structure d'un appareil flux dépend de son script de contrôle : si un flux devient pilotable plus
  tard, Gladys propose de le **Mettre à jour** dans l'onglet Découverte.
- Testée avec snapserver et snapclient 0.31 en Docker, avec un flux pipe et un lecteur scripté, sans
  enceintes. Vos retours sont les bienvenus sur le forum.
