# Snapcast

[Snapcast](https://github.com/badaix/snapcast) reproduce el mismo sonido, sincronizado, en todas las
habitaciones: un `snapserver` recibe las fuentes (Spotify con librespot, AirPlay, MPD, una radio, un
pipe…) y las envía a los `snapclient`, uno por habitación. Esta integración lleva el servidor a
Gladys: el volumen y el silencio de cada habitación, la fuente que suena en cada una, los grupos de
habitaciones, y escenas cuando un altavoz se desconecta o una fuente empieza a sonar.

No reproduce música por sí misma: la música viene de las fuentes de su servidor Snapcast (MPD,
Spotify…). Probada con snapserver y snapclient 0.31 en Docker, sin altavoces: sus comentarios son
bienvenidos.

## Requisitos

- Un servidor Snapcast (snapserver 0.26 o posterior; 0.31 probado) al que Gladys pueda acceder en la
  red local.
- Su puerto de control JSON-RPC por TCP, **1705** por defecto, activo (lo está, salvo que la sección
  `[tcp]` de `snapserver.conf` diga `enabled = false`).
- Gladys 5.3 o posterior (reproductor Música; la versión 1.0 de la integración sigue para Gladys 5.1 y 5.2).

## Configuración

1. En Gladys, abra **Integraciones**, busque **Snapcast** e instálela.
2. **Dirección del servidor**: la dirección IP o el nombre de host del equipo que ejecuta
   snapserver, por ejemplo `192.168.1.20`. Añada `:puerto`, o rellene **Puerto de control**, si no es
   el 1705 (no el puerto HTTP 1780 de Snapweb).
3. **Idioma**: el idioma de los nombres de las funciones y de los textos que crea la integración.
   Los nombres se fijan al añadir un dispositivo: elíjalo antes de añadir los dispositivos.
4. Guarde. La integración se conecta y muestra cada cliente y cada fuente en la pestaña
   **Descubrimiento** de la integración: añada los que desee.

La integración mantiene una conexión abierta con el servidor y sigue cada cambio en directo: un
volumen cambiado en Snapweb u otra aplicación aparece al instante en Gladys. Vuelve a leer todo el
estado cada minuto y tras cada reconexión.

## Dispositivos

### Clientes (habitaciones)

Cada snapclient es un dispositivo, con el nombre que usted le dio en Snapweb (o, si no, el nombre de
su equipo).

| Función                          | Qué hace                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Volumen                          | 0 a 100, en ambos sentidos                                                                                                              |
| Silencio                         | Activado = sonido apagado, en ambos sentidos (silencio del reproductor Música)                                                          |
| Conectado                        | Si el snapclient está conectado al servidor                                                                                             |
| Fuente                           | La fuente de la habitación; elegir otra cambia **todo su grupo**                                                                        |
| Estado de reproducción           | Reproduciendo (1), en pausa (0) o detenido (2), según la fuente de la habitación; controlable cuando una fuente tiene script de control |
| Reproduciendo                    | Artista y título cuando la fuente los indica, si no el nombre y el estado de la fuente                                                  |
| Reproducir, Pausa                | Actúan sobre la fuente de la habitación, cuando un script de control la maneja (ver Fuentes)                                            |
| Anterior, Siguiente              | Igual                                                                                                                                   |
| Título, Artista, Álbum, Carátula | Lo que suena en la fuente de la habitación (vea Reproductor Música)                                                                     |
| Duración, Posición               | De la pista actual; la posición se ajusta cuando la fuente puede desplazarse                                                            |
| Aleatorio, Repetir               | Cuando una fuente del servidor los indica; actúan sobre la fuente de la habitación                                                      |

Un cliente es un reproductor para la caja **Música** de Gladys: añada la caja a un panel y elija la
habitación (vea Reproductor Música de Gladys 5.3).

### Fuentes

Cada fuente del servidor también es un dispositivo: su **estado de reproducción** (1 reproduciendo,
0 en pausa, 2 detenido) y lo que suena (**reproduciendo**). Una fuente manejada por un script de control (librespot, MPD con
`meta_mpd.py`, AirPlay, Plexamp… vea la documentación de Snapcast) tiene además los botones
**Reproducir**, **Pausa**, **Anterior** y **Siguiente**. Un simple pipe no los tiene: Snapcast no
puede pausar lo que no controla.

No hay dispositivo por grupo: Snapcast elimina un grupo vacío y da una identidad nueva a un grupo
nuevo, lo que dejaría dispositivos huérfanos en Gladys. Los grupos se manejan a través de sus
clientes (elección de la fuente, acciones más abajo).

## Reproductor Música de Gladys 5.3

Desde Gladys 5.3, la caja **Música** del panel es un verdadero reproductor. Elija una habitación (un
cliente): muestra lo que suena en la fuente de su grupo (carátula, título, artista, álbum, barra de
progreso), con reproducir / pausa, anterior / siguiente, aleatorio, repetir, y el volumen y el
silencio de la habitación.

- Título, artista, álbum, duración, posición y carátula vienen del **script de control** de la fuente
  (librespot, Mopidy con `meta_mopidy.py`, MPD con `meta_mpd.py`, AirPlay…). Un simple pipe no da
  nada de esto: la caja muestra el nombre de la fuente como título, en directo, sin barra de progreso.
- Las órdenes de reproducción, posición, aleatorio y repetición actúan sobre la fuente de la
  habitación, es decir sobre **todas las habitaciones de su grupo**; el volumen y el silencio siguen
  siendo los de la habitación.
- Lo que se controla depende de sus fuentes: el estado de reproducción en cuanto una fuente del
  servidor tiene script de control, la posición en cuanto una fuente puede desplazarse, aleatorio y
  repetir en cuanto una fuente los indica. Una orden que la fuente de la habitación no puede cumplir
  se rechaza con un mensaje.
- La carátula es la dirección que da el script o la imagen enviada en la fuente (AirPlay). Una imagen
  demasiado pesada se reduce; el logotipo SVG que envía librespot no se muestra (formato que Gladys
  rechaza).
- Sin biblioteca, búsqueda ni cola: Snapcast no las tiene. Elija la música en la aplicación de su
  fuente.

**Dispositivos ya añadidos**: en la pestaña **Descubrimiento** de la integración, pulse **Actualizar** en
cada habitación. Recibe las nuevas funciones, y su **Silencio** pasa a ser el del reproductor Música
(misma función, escenas conservadas). La propuesta vuelve si una fuente pasa a ser controlable más
tarde. El **estado de reproducción** vale ahora **2** cuando nada suena, en vez de 0: una escena con
«estado de reproducción = 0» ya solo se activa en pausa. **Reproduciendo** sigue disponible.

## Widget del panel

**Habitaciones Snapcast**:

- sin habitación elegida: cada cliente con lo que suena y su volumen (o «Silenciado», «Sin
  conexión»), y un botón **Silenciar todo** / **Activar todo**;
- con una habitación elegida: su estado y su volumen, los botones **Volumen −**, **Volumen +**,
  **Silenciar** / **Activar**, y **Reproducir** / **Pausa** cuando su fuente se puede controlar, si
  no **Otra fuente**.

## Disparadores de escena

| Disparador           | Cuándo                                                            | Variables               |
| -------------------- | ----------------------------------------------------------------- | ----------------------- |
| Cliente desconectado | Un snapclient abandona el servidor (altavoz apagado, red perdida) | nombre del cliente      |
| Cliente conectado    | Un snapclient vuelve a unirse al servidor                         | nombre del cliente      |
| Fuente iniciada      | Llega sonido a una fuente (alguien emite por Spotify…)            | fuente, título, artista |
| Fuente detenida      | Una fuente deja de sonar (en pausa, ya sin sonido)                | fuente, título, artista |

Cada disparador puede limitarse a un cliente o a una fuente. No se dispara nada por lo que ocurre
mientras el propio servidor no está accesible.

## Acciones de escena

| Acción                                     | Qué hace                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Ajustar el volumen de una habitación       | Volumen de un cliente, de 0 a 100                                                                          |
| Silenciar o activar todas las habitaciones | Todos los clientes del servidor; devuelve cuántos cambiaron                                                |
| Cambiar la fuente de una habitación        | El grupo del cliente pasa a la fuente elegida                                                              |
| Controlar una fuente                       | Reproducir, pausa, reproducir/pausa, siguiente, anterior, en una fuente o en lo que escucha una habitación |
| Agrupar dos habitaciones                   | El primer cliente se une al grupo del segundo, sincronizado                                                |
| Desagrupar una habitación                  | El cliente forma un grupo propio, misma fuente                                                             |

El volumen, el silencio y la fuente de una habitación también se ajustan con la acción estándar
«Establecer valor del dispositivo» de Gladys.

## Ejemplos de escenas

- **Noche tranquila**: a las 23 h, «Silenciar o activar todas las habitaciones» → Silenciar. A las
  7 h, Activar.
- **Radio de la mañana**: a las 7 h entre semana, «Cambiar la fuente de una habitación» → Cocina,
  fuente Radio, y luego «Ajustar el volumen de una habitación» → Cocina, 30.
- **La música le sigue**: con «Fuente iniciada» de Spotify, «Agrupar dos habitaciones» → el Salón se
  une a la Cocina.
- **Altavoz desenchufado**: con «Cliente desconectado» del Baño, enviar un mensaje.

## Solución de problemas

- **«El servidor Snapcast no responde»**: compruebe la dirección, que snapserver esté en marcha y que
  el puerto sea el de control TCP (1705 por defecto), ni el puerto de audio 1704 ni el puerto HTTP 1780. Un cortafuegos debe dejar pasar a Gladys.
- **Una habitación indica «Sin conexión»**: su snapclient no está conectado al servidor (equipo
  apagado, dirección de servidor incorrecta en el cliente).
- **«Esta fuente no se puede controlar»**: la fuente no tiene script de control. Use una fuente que
  describa su reproductor (librespot, MPD con `meta_mpd.py`…) o controle el reproductor directamente.
- **Una fuente indica «Inactivo» aunque su reproductor dice que reproduce**: no llega sonido a
  snapserver; Snapcast indica lo que recibe.
- Más detalles: ponga el `LOG_LEVEL` de la integración en `debug`.

## Limitaciones

- Un solo servidor Snapcast por integración.
- Sin autenticación: el puerto de control de snapserver no tiene por defecto. Un servidor que la exija
  (opción de las versiones recientes) no es compatible.
- Sin dispositivo por grupo (ver Fuentes); la latencia de un cliente y los nombres se ajustan en
  Snapweb.
- La estructura de un dispositivo habitación depende de lo que saben hacer las fuentes del servidor
  (vea Reproductor Música): Gladys propone **Actualizarlo** cuando una fuente pasa a ser controlable.
- La estructura de un dispositivo fuente depende de su script de control: si una fuente pasa a ser
  controlable más tarde, Gladys propone **Actualizarla** en la pestaña Descubrimiento.
- Probada con snapserver y snapclient 0.31 en Docker, con una fuente pipe y un reproductor simulado,
  sin altavoces. Sus comentarios son bienvenidos en el foro.
