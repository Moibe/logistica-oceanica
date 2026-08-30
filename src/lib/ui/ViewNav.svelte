<script lang="ts">
  import { dev } from '$app/environment';
  import { page } from '$app/state';

  /**
   * The view switcher. Three renderers of the same world map plus the 3D
   * close-up — they all read the same simulation, so switching is instant and
   * the fleet is in the same place on the other side.
   */
  const VIEWS = [
    { href: '/map/canvas', label: 'Canvas 2D', hint: 'd3-geo · nítido' },
    { href: '/map/globe', label: 'Globo 3D', hint: 'three · arcos' },
    { href: '/map/maplibre', label: 'MapLibre', hint: 'GL · capas' },
    { href: '/ship', label: 'Barco', hint: 'threlte · mar' },
  ];
</script>

<nav class="panel">
  <a class="brand" href="/">
    <span class="dot"></span>
    <span class="mono">LOGÍSTICA OCEÁNICA</span>
  </a>
  <div class="views">
    {#each VIEWS as view (view.href)}
      <a
        class="ctl"
        class:is-active={page.url.pathname === view.href}
        href={view.href}
      >
        <span>{view.label}</span>
        <span class="hint">{view.hint}</span>
      </a>
    {/each}
  </div>
  {#if dev}
    <!-- Development only. Deliberately styled as a small chip rather than a
         fifth view card: it is a check on the data, not somewhere to play. -->
    <a class="tool" class:is-active={page.url.pathname === '/audit'} href="/audit">
      Auditoría
    </a>
  {/if}
</nav>

<style>
  nav {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 1.1rem;
    padding: 0.5rem 0.75rem 0.5rem 1rem;
  }

  .brand {
    flex: none;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    color: var(--muted);
    padding-right: 1rem;
    border-right: 1px solid var(--line);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent);
  }

  .views {
    display: flex;
    gap: 0.4rem;
  }

  .views .ctl {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    /* Never let a card shrink below its label: squeezed, the hint wraps onto a
       third line and the whole bar grows taller instead of wider. */
    flex: none;
    white-space: nowrap;
  }

  .hint {
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    color: var(--muted);
  }

  .tool {
    flex: none;
    white-space: nowrap;
    padding: 0.3rem 0.6rem;
    margin-left: 0.2rem;
    border: 1px dashed var(--line);
    border-radius: 9px;
    font-size: 0.66rem;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .tool:hover,
  .tool.is-active {
    color: var(--ink);
    border-color: rgba(76, 201, 255, 0.45);
  }

  @media (max-width: 720px) {
    .brand {
      display: none;
    }
    .hint {
      display: none;
    }
  }
</style>
