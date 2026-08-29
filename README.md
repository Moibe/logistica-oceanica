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
para tiempo de mar puro a velocidad de servicio. No se modelan escalas ni slow steaming,
así que Asia–Europa da 21,6 días en vez de los 30–35 que anuncia una naviera (esos
incluyen puertos intermedios y navegar más lento a propósito).

El reloj corre a **3 horas simuladas por segundo real** en 1×, o sea un día cada ocho
segundos: la travesía más corta dura ~1 minuto y la más larga ~3,5. Antes iba a 12 h/s y
Asia–Europa completa pasaba en 42 segundos, que no dejaba dónde tomar una decisión.

### El invariante de las rutas

**Ninguna ruta cruza tierra.** Se verifica caminando `ROUTES[].points` contra
`static/data/land-50m.json` con un test punto-en-polígono; las únicas excepciones son los
canales de Suez y Panamá, y un radio de ~120 km alrededor de cada puerto (los atracaderos
están en dársenas que una costa generalizada se traga).

Vale la pena volver a correrlo cada vez que se mueva un waypoint: una ruta que recorta una
península se ve perfectamente bien al zoom de mundo. La primera versión de estos waypoints
metía barcos por Sumatra, Honshu, Borneo, Madagascar, Omán y los Andes peruanos — las ocho
rutas cruzaban tierra en algún punto y ninguna se veía mal.

## Detalles que conviene no romper

- **`optimizeDeps.exclude: ['maplibre-gl']`** en `vite.config.ts`. Sin eso el worker de
  maplibre se sirve desde `.vite/deps/` donde no existe, y el mapa queda en blanco *sin
  ningún error en consola*.
- El ticker de estelas de MapLibre arranca **dentro del `load`**. Si hace `setData` antes,
  la fuente nunca termina de cargar y el evento `load` no dispara nunca.
- El shader del mar cierra con `#include <colorspace_fragment>`. `THREE.Color` convierte
  cada hex a espacio lineal y un `ShaderMaterial` crudo escribe directo al framebuffer.

## Siguiente

- Modo puerto (atraque, grúas, carga/descarga).
- Que la vista de barco lea el buque seleccionado en el mapa en vez de uno fijo.
- Economía: fletes, combustible, retrasos por clima en los chokepoints.
