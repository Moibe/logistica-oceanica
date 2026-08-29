<script lang="ts">
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
  }

  .hint {
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    color: var(--muted);
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
