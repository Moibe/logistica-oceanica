<script lang="ts">
  import { PORTS } from '$lib/domain/ports';
  import { ROUTES } from '$lib/domain/routes';
  import { INITIAL_FLEET } from '$lib/domain/fleet';

  const VIEWS = [
    {
      href: '/map/canvas',
      title: 'Canvas 2D',
      stack: 'd3-geo · Canvas',
      body:
        'Proyección geográfica real dibujada como vectores a devicePixelRatio. ' +
        'Zoom hasta 48× sin perder el filo de la costa, tres proyecciones y ' +
        'cambio automático a datos 50m al acercarse.',
    },
    {
      href: '/map/globe',
      title: 'Globo 3D',
      stack: 'Threlte · three',
      body:
        'El mismo mundo sobre una esfera: costas como líneas, rutas como tubos ' +
        'aditivos y estelas con degradado por vértice. Órbita libre y cascos ' +
        'clicables.',
    },
    {
      href: '/map/maplibre',
      title: 'MapLibre GL',
      stack: 'maplibre-gl',
      body:
        'Capas GL reales sobre el mismo TopoJSON local — sin tiles externos ni ' +
        'API keys. Mercator o proyección de globo, barcos y puertos como ' +
        'marcadores DOM.',
    },
    {
      href: '/ship',
      title: 'Vista de barco',
      stack: 'Threlte · GLSL',
      body:
        'Mar por shader (suma de senos en aguas profundas) y un portacontenedores ' +
        'construido con primitivas. El casco muestrea la misma superficie que ' +
        'dibuja el shader, así que flota de verdad.',
    },
  ];
</script>

<svelte:head>
  <title>Logística Oceánica</title>
</svelte:head>

<main>
  <header>
    <p class="label">Prototipo · scaffold</p>
    <h1>Logística Oceánica</h1>
    <p class="lede">
      Un dominio compartido — puertos, rutas de gran círculo, flota y reloj de simulación — con
      cuatro renderers encima. Cambiar de vista no cambia el mundo: los mismos barcos van en el
      mismo punto de la misma ruta.
    </p>
    <ul class="stats">
      <li><strong class="mono">{PORTS.length}</strong> <span class="label">puertos</span></li>
      <li><strong class="mono">{ROUTES.length}</strong> <span class="label">rutas</span></li>
      <li><strong class="mono">{INITIAL_FLEET.length}</strong> <span class="label">buques</span></li>
    </ul>
  </header>

  <div class="grid">
    {#each VIEWS as view (view.href)}
      <a class="card panel" href={view.href}>
        <span class="label">{view.stack}</span>
        <h2>{view.title}</h2>
        <p>{view.body}</p>
        <span class="go">Abrir →</span>
      </a>
    {/each}
  </div>
</main>

<style>
  main {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2.4rem;
    padding: 9rem 1.5rem 4rem;
  }

  header {
    max-width: 62ch;
    text-align: center;
  }

  h1 {
    margin: 0.5rem 0 0.9rem;
    font-size: clamp(2rem, 5vw, 3.1rem);
    font-weight: 600;
    letter-spacing: -0.02em;
    background: linear-gradient(120deg, #eaf6ff 20%, #4cc9ff 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .lede {
    margin: 0;
    color: var(--muted);
    line-height: 1.6;
  }

  .stats {
    margin: 1.6rem 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    justify-content: center;
    gap: 2.2rem;
  }

  .stats li {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .stats strong {
    font-size: 1.5rem;
    font-weight: 500;
    color: var(--accent);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(248px, 1fr));
    gap: 1rem;
    width: min(1040px, 100%);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.1rem 1.2rem 1.2rem;
    transition:
      transform 180ms ease,
      border-color 180ms ease;
  }

  .card:hover {
    transform: translateY(-3px);
    border-color: rgba(76, 201, 255, 0.45);
  }

  .card h2 {
    margin: 0;
    font-size: 1.12rem;
    font-weight: 550;
  }

  .card p {
    margin: 0;
    flex: 1;
    font-size: 0.84rem;
    line-height: 1.55;
    color: var(--muted);
  }

  .go {
    font-size: 0.78rem;
    color: var(--accent);
  }
</style>
