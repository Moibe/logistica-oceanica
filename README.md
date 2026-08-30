# Logística Oceánica

Juego de logística marítima. Un **dominio compartido** (puertos, rutas de gran círculo,
flota y reloj de simulación) con **cuatro renderers intercambiables** encima: cambiar de
vista no cambia el mundo — los mismos barcos van en el mismo punto de la misma ruta.

Stack igual al de `hexa-turnos`: SvelteKit 2 + Svelte 5 en modo runes + TypeScript +
Threlte 8 / three, canvas a pantalla completa con HUD flotante encima.

## Arranque

```sh
npm install
npm run dev   # http://localhost:4444
```

El puerto es fijo (`strictPort` en `vite.config.ts`): si 4444 está ocupado el dev
server falla en vez de saltar al siguiente libre.

| Comando         | Qué hace                              |
| --------------- | ------------------------------------- |
| `npm run dev`   | Servidor de desarrollo                |
| `npm run build` | Build de producción (`adapter-auto`)  |
| `npm run check` | `svelte-check` sobre todo el proyecto |

En desarrollo hay además una herramienta en `/audit` que verifica que ninguna ruta cruce
tierra — ver [El invariante de las rutas](#el-invariante-de-las-rutas-y-cómo-verificarlo).

## Las cuatro vistas

| Ruta             | Stack             | Qué demuestra                                                                                              |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `/map/canvas`    | d3-geo + Canvas2D | Proyección real dibujada como vectores a devicePixelRatio. Zoom 48×, tres proyecciones, swap 110m→50m, mundo repetido, cámara animada y colisión de etiquetas. |
| `/map/globe`     | Threlte + three   | El mismo mundo sobre una esfera: costas en líneas, rutas como tubos aditivos, estelas con degradado.         |
| `/map/maplibre`  | maplibre-gl       | Capas GL reales sobre el mismo TopoJSON local. Mercator o globo, sin tiles externos ni API keys.             |
| `/ship`          | Threlte + GLSL    | Mar por shader y un portacontenedores de primitivas que muestrea la misma superficie que dibuja el shader.   |

### Cuál es el mapa del juego

**`/map/canvas` es el mapa principal.** Se construyeron los tres para poder compararlos con
los mismos datos, y esa comparación ya se resolvió (2026-08-29): Canvas gana porque los
datos son pocos y propios, la animación va a 60 fps sin pelearse con nadie, y el control
del píxel es justo lo que pide la estética de consola.

`/map/globe` y `/map/maplibre` **se quedan a propósito**, congelados, como laboratorio para
experimentar más adelante. No son código muerto y no hay que emparejarlos en funciones con
el Canvas — si algo se agrega, se agrega al Canvas salvo que se diga lo contrario.

MapLibre volvería a estar sobre la mesa el día que haga falta acercarse a un puerto real
(muelles, costa a escala de metros, nombres de terminal): ahí su teselado y su manejo de
etiquetas ahorran meses. Para vista de mundo, no compensa el megabyte.

## Lo que la vista Canvas le robó a MapLibre

Tres comportamientos que un mapa oceánico necesita y que en Canvas salen baratos,
todos en [`src/lib/map/CanvasMap.svelte`](src/lib/map/CanvasMap.svelte):

1. **Mundo repetido.** En las proyecciones cilíndricas (equirectangular y Mercator) el
   mundo se tesela horizontalmente: los mismos `Path2D` ya horneados se dibujan una vez
   por copia visible, así que puedes perseguir un barco por el Pacífico sin que el mapa
   se acabe. `worldOffsets()` calcula qué copias tocan la pantalla; todo —costas, rutas,
   estelas, puertos, cascos y el hit-test— itera sobre esa lista.
2. **Cámara animada (`flyTo` + `Seguir`).** Interpolación del `ZoomTransform` en un rAF,
   con la escala en espacio logarítmico para que no dé un tirón. `Seguir` fija la cámara
   al barco seleccionado; arrastrar la suelta, la rueda no. El objetivo siempre se
   traslada a la copia del mundo más cercana, así que cruzar el antimeridiano no provoca
   un salto de media vuelta al planeta.
3. **Colisión de etiquetas.** Las candidatas se juntan durante el dibujo y se resuelven al
   final por prioridad (barco seleccionado ≫ barco bajo el cursor ≫ resto ≫ puerto por
   TEU), descartando las que chocan con una ya colocada.

Lo que **no** se portó: teselado, atlas de glyphs y el spec de estilo. Resuelven problemas
que este mapa no tiene.

## Arquitectura

```
src/lib/
  domain/          TypeScript puro, sin nada de UI ni de render
    geo.ts         matemática esférica: distancia, slerp, rumbo, lon/lat → vec3
    ports.ts       catálogo de puertos
    routes.ts      rutas por chokepoints, muestreo de gran círculo, pointAt/slice
    fleet.ts       clases de buque, avance por horas simuladas, estela
  state/
    simulation.svelte.ts   el reloj compartido (runas). Loop rAF con conteo de vistas
  map/             los tres renderers de mapa + carga de TopoJSON
  scene/           la escena 3D de barco (mar, casco, espuma)
  ui/              navegación y HUD, comunes a todas las vistas
```

Dos reglas que sostienen todo:

1. **`domain/` no conoce ningún renderer.** Devuelve `[lon, lat]` y kilómetros; cada vista
   decide cómo proyectarlos. Por eso las tres vistas no pueden discrepar sobre dónde está
   un barco.
2. **Una sola fuente de verdad por dato compartido.** El oleaje vive en `scene/waves.ts` y
   se evalúa dos veces — en GLSL para dibujar el mar y en JS para que el casco flote sobre
   *esa* superficie, no sobre un seno propio.

### Datos geográficos

`static/data/` lleva el TopoJSON de `world-atlas` copiado en el scaffold (110m y 50m).
No hay tiles, ni proveedor, ni API key: el mapa funciona sin red.

## Calibración

Velocidades y distancias están medidas contra la realidad, no puestas a ojo:

| Ruta | Juego | Real aprox. |
| --- | ---: | ---: |
| Asia – Europa (Suez) | 10.906 nm | ~10.500 |
| Transpacífico | 5.696 nm | ~5.100 |
| Atlántico Norte | 3.688 nm | ~3.400 |
| Cabo de Buena Esperanza | 9.116 nm | ~8.900 |
| Golfo – Índico | 4.109 nm | ~3.800 |

Las travesías salen entre 8,5 y 27 días según buque y ruta, que es la banda correcta
para tiempo de mar puro a velocidad de servicio. Asia–Europa da 21,6 días en vez de los
30–35 que anuncia una naviera; esos incluyen puertos intermedios, que este juego no
modela — cada ruta va directa entre sus dos únicos puertos.

El reloj corre a **3 horas simuladas por segundo real** en 1×, o sea un día cada ocho
segundos: la travesía más corta dura ~1 minuto y la más larga ~3,5. Antes iba a 12 h/s y
Asia–Europa completa pasaba en 42 segundos, que no dejaba dónde tomar una decisión.

## Combustible, escalas y velocidad de crucero

Cada buque lleva un tanque (`src/lib/domain/fleet.ts`), lo quema navegando y lo rellena
al atracar. Tres piezas, una sola fuente de verdad:

- **Combustible.** Consumo en toneladas/día, escala **al cubo** de la velocidad — así
  funciona de verdad la resistencia de un casco, y es la razón real por la que la
  navegación lenta ahorra tanto: 0,6× la velocidad de diseño quema ~22 % del consumo
  normal; 1,15× quema ~152 %.
- **Escalas.** Al llegar a un puerto el buque **atraca** (`status: 'docked'`) entre 12 h
  (feeder) y 30 h (ULCV) según la clase, reabasteciendo con una interpolación lineal
  hasta llenar el tanque justo cuando zarpa — el medidor sube visiblemente, no salta.
  Un buque atracado se dibuja como un disco estático con un anillo pulsante (no la
  flecha direccional, que implicaría que sigue en marcha) y no deja estela.
- **Velocidad de crucero.** Control deslizante en el panel del buque seleccionado, entre
  0,6× y 1,15× la velocidad de diseño de su clase. Sube el ETA baja el consumo y
  viceversa — es la decisión real que introduce el combustible.

La capacidad del tanque de cada clase no es arbitraria: es
`díasDeSuRutaMásExigenteADiseño × consumo × 1,5`. Ese margen de 1,5× se cancela casi
exacto contra el cubo de la velocidad máxima (1,15³ ≈ 1,52), así que sostener velocidad
máxima en la ruta más dura de una clase la deja **justo corta** de combustible — hoy la
única forma de ver un buque quedar **a la deriva** (`status: 'adrift'`, halo rojo, sin
estela, control de velocidad bloqueado). No hay mecánica de rescate: un buque a la deriva
se queda ahí. Con la flota y las rutas por defecto esto no ocurre por accidente — solo si
fuerzas el deslizador al máximo y lo dejas así toda la travesía más exigente de esa clase.

Un dato de proceso: verificar esto por reloj de pared en un Chrome headless salió mal — el
`requestAnimationFrame` corría ahí a ~1,3 fps (throttling propio del modo headless con
SwiftShader), muy por debajo de lo que el multiplicador de velocidad hacía suponer. La
lógica se validó llamando `advance()` directo con horas exactas — 19 aserciones, incluida
una llamada que cruza llegada + escala completa + reanudar navegación en un solo golpe —
en vez de confiar en cuánto tiempo real había pasado.

### Precio de combustible por puerto, y los tres tipos reales de escala

En la vida real un buque no repostaba porque se le acabe el tanque — carga para semanas y
repostea donde el combustible sale barato. Pero "barato" no vive solo en los puertos de
carga: existen tres categorías reales, y el juego las modela como tres cosas distintas en
vez de una sola.

1. **Puerto completo** — carga y repostaje al mismo tiempo. Es casi todos los puertos del
   mundo, porque el combustible es un servicio que sigue al tráfico: donde hay barcos, hay
   proveedor. Los 14 `Port` con `kind: 'full'` en `ports.ts`.
2. **Puerto de repostaje dominante** — un lugar con nombre, ciudad y algo de carga, pero
   cuyo negocio real es casi todo combustible. **Fujairah** (Emiratos) es el ejemplo de
   libro: uno de los tres puertos con mayor volumen de bunkering del planeta, precisamente
   porque está justo fuera del Estrecho de Ormuz — un barco puede repostar ahí sin meterse
   al Golfo Pérsico y salir. `kind: 'bunker'` en `ports.ts`, `teu: 0.3` (para que el punto en
   el mapa salga chico) y un diamante ámbar en vez del punto cian de siempre. La ruta
   Golfo–Índico pasa literalmente por sus coordenadas — se corrigió el via-point aproximado
   que había ahí antes por el puerto real, así la geometría concuerda con el precio que cobra.
3. **Fondeadero, sin identidad de puerto** — repostaje ship-to-ship en aguas abiertas: una
   barcaza de combustible se arrima al barco anclado, sin terminal, sin ciudad, sin nada.
   La bahía de Gibraltar es de las zonas de bunkering ship-to-ship más transitadas del
   mundo, y la ruta Asia–Europa ya pasa justo por ahí. Es un `BunkerStop` con
   `kind: 'anchorage'` en `routes.ts` — no existe como `Port`, solo como un punto sobre la
   geometría de esa ruta específica (diamante ámbar hueco en el mapa, para diferenciarlo del
   relleno de Fujairah).

Ni Fujairah ni el fondeadero de Gibraltar exigen desvío: sus coordenadas se colocan sobre
la polilínea que la ruta ya recorre (`BunkerStop.atProgress`, calculado buscando el punto
muestreado más cercano a la posición real — exacto para Fujairah, que ahora es un via-point
en sí mismo; ~37 km de margen para Gibraltar, razonable para "en algún lugar de esta bahía").

Cada `Port` lleva un `fuelPrice` (USD/tonelada) que sigue la jerarquía real: Singapur y
Fujairah son los más baratos (~$578-585), Róterdam y el fondeadero de Gibraltar un peldaño
arriba (~$592-600), y los puertos chicos o sin refinería cerca (Sídney, Valparaíso, Durban)
hasta 25% más caros por tener que traer el combustible en camión o barcaza. Es una foto
fija, no un feed — el precio real se mueve a diario con el mercado petrolero.

Parar en un fondeadero o en Fujairah es **decisión del jugador**, no automática:
`Ship.useWaypointStops` (casilla en el panel del buque, solo visible si su ruta tiene
alguna parada) — por defecto en falso, así que un barco navega derecho salvo que actives la
casilla. Activarla cuesta `BUNKER_STOP_HOURS` (6 h, una sola cifra para todas las clases: a
diferencia de la carga, bombear combustible no depende del tamaño del barco, depende del
caudal de la bomba — 4-12 h es el rango real, 6 es un punto medio representativo) a cambio
de repostar al precio de esa parada en vez de esperar al puerto de destino.

`Ship.fuelSpend` acumula en USD lo gastado en toda su vida, cobrado **por tonelada
efectivamente añadida** en el momento en que se añade — no al llegar, no al zarpar, sino
mientras el tanque sube durante la escala, sea puerto o parada. El HUD muestra el precio de
donde esté repostando ahora mismo (puerto o parada) y, mientras navega, el del puerto
**de destino** — para que la decisión de velocidad (llegar antes vs. quemar menos) se tome
sabiendo qué tan caro va a salir el próximo repostaje.

Verificado con 48 aserciones directas contra `advance()` en total (19 del ciclo
puerto/combustible original + 8 del costeo + 21 de la parada intermedia), incluida la
llamada que cruza en un solo golpe *llegar a la parada → agotar toda la escala → seguir
navegando*. Dos de esas aserciones fallaron en el primer intento por el mismo motivo de
antes: pruebas viejas construían un buque `'docked'` a mano sin fijar el campo nuevo
`dockHoursTotal` que la generalización requiere — el bug estaba en la prueba, no en
`advance()`.

### El invariante de las rutas, y cómo verificarlo

**Ninguna ruta cruza tierra.** Cada punto muestreado se prueba contra
`static/data/land-50m.json` con un test punto-en-polígono; las únicas excepciones son los
canales de Suez y Panamá, y un radio de ~120 km alrededor de cada puerto (los atracaderos
están en dársenas que una costa generalizada se traga).

Corre **`localhost:4444/audit`** cada vez que muevas un waypoint, agregues un puerto o
inventes una ruta. Tarda ~300 ms y te da las coordenadas exactas de los puntos secos, en el
formato que pegas de vuelta en `routes.ts`. El enlace «Auditoría» solo aparece en la nav en
desarrollo; en producción la ruta responde 404.

- Lógica: [`src/lib/domain/audit.ts`](src/lib/domain/audit.ts) — TS puro, sin nada de UI.
- Página: [`src/routes/audit/+page.svelte`](src/routes/audit/+page.svelte) — solo presenta.

Existe porque el bug era invisible. La primera versión de estos waypoints metía barcos por
Sumatra, Honshu, Borneo, Madagascar, Omán y los Andes peruanos: **las ocho rutas cruzaban
tierra** y ninguna se veía mal al zoom de mundo. Una línea que recorta una península es
indistinguible de una que la rodea hasta que pruebas punto por punto.

## Detalles que conviene no romper

- **`optimizeDeps.exclude: ['maplibre-gl']`** en `vite.config.ts`. Sin eso el worker de
  maplibre se sirve desde `.vite/deps/` donde no existe, y el mapa queda en blanco *sin
  ningún error en consola*.
- El ticker de estelas de MapLibre arranca **dentro del `load`**. Si hace `setData` antes,
  la fuente nunca termina de cargar y el evento `load` no dispara nunca.
- El shader del mar cierra con `#include <colorspace_fragment>`. `THREE.Color` convierte
  cada hex a espacio lineal y un `ShaderMaterial` crudo escribe directo al framebuffer.

## Siguiente

- Modo puerto (grúas, carga/descarga real — hoy la escala solo reabastece).
- Más paradas de repostaje reales en otras rutas (hoy solo Fujairah y Gibraltar).
- Que la vista de barco lea el buque seleccionado en el mapa en vez de uno fijo.
- Mecánica de rescate para un buque a la deriva.
- Economía: fletes, retrasos por clima en los chokepoints.
