<script lang="ts">
  import {
    auditRoutes,
    formatCoord,
    indexLand,
    PORT_GRACE_KM,
    type RouteFinding,
  } from '$lib/domain/audit';
  import { loadWorld } from '$lib/map/world';

  /**
   * Development view for the route invariant: no lane may cross land. Run it
   * after touching any waypoint in `routes.ts` — a lane that clips a peninsula
   * looks perfectly fine on the map, which is exactly why this page exists.
   */
  let findings = $state.raw<RouteFinding[] | null>(null);
  let landmasses = $state(0);
  let elapsedMs = $state(0);
  let failure = $state<string | null>(null);

  const broken = $derived(findings?.filter((f) => f.dry.length > 0) ?? []);

  async function run() {
    findings = null;
    failure = null;
    try {
      // 50m on purpose: finer than the data the routes were drawn against, so
      // the check is not just confirming its own assumptions.
      const world = await loadWorld('50m');
      const started = performance.now();
      const index = indexLand(world.land);
      landmasses = index.count;
      findings = auditRoutes(index);
      elapsedMs = Math.round(performance.now() - started);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    run();
  });
</script>

<svelte:head>
  <title>Auditoría de rutas</title>
</svelte:head>

<main>
  <header>
    <p class="label">Herramienta de desarrollo</p>
    <h1>Auditoría de rutas</h1>
    <p class="lede">
      Cada punto muestreado de cada ruta se prueba contra la costa <strong>50m</strong> con
      un test punto-en-polígono. Se exceptúan los canales de Suez y Panamá, y un radio de
      {PORT_GRACE_KM} km alrededor de cada puerto: los atracaderos están en dársenas que una
      costa generalizada se traga.
    </p>
  </header>

  {#if failure}
    <p class="verdict bad panel">No se pudo correr: {failure}</p>
  {:else if !findings}
    <p class="verdict panel">Cargando la costa 50m y recorriendo las rutas…</p>
  {:else}
    <p class="verdict panel" class:good={broken.length === 0} class:bad={broken.length > 0}>
      {#if broken.length === 0}
        Las {findings.length} rutas se mantienen en el agua.
      {:else}
        {broken.length} de {findings.length} rutas cruzan tierra.
      {/if}
      <span class="label mono"
        >{landmasses.toLocaleString('es-MX')} masas de tierra · {elapsedMs} ms</span
      >
    </p>

    <table class="panel">
      <thead>
        <tr>
          <th>Ruta</th>
          <th class="num">Millas náuticas</th>
          <th class="num">Rodeo</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        {#each findings as f (f.route.id)}
          <tr class:is-bad={f.dry.length > 0}>
            <td>
              <span class="swatch" style:background={f.route.color}></span>
              {f.route.name}
            </td>
            <td class="num mono">{f.lengthNm.toLocaleString('es-MX')}</td>
            <td class="num mono">+{f.detourPct}%</td>
            <td>
              {#if f.dry.length === 0}
                <span class="ok">en el agua</span>
              {:else}
                <details>
                  <summary>{f.dry.length} puntos en tierra</summary>
                  <ul>
                    {#each f.dry.slice(0, 12) as p, i (i)}
                      <li class="mono">{formatCoord(p)}</li>
                    {/each}
                    {#if f.dry.length > 12}
                      <li class="more">…y {f.dry.length - 12} más</li>
                    {/if}
                  </ul>
                </details>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    <p class="foot label">
      El «rodeo» compara con el círculo máximo directo entre los dos puertos. Es informativo,
      no un veredicto: una ruta que debe bordear un continente es legítimamente mucho más
      larga que la línea recta.
    </p>

    <button class="ctl" onclick={run}>Volver a correr</button>
  {/if}
</main>

<style>
  main {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    padding: 7rem 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.1rem;
  }

  header {
    max-width: 68ch;
    text-align: center;
  }

  h1 {
    margin: 0.4rem 0 0.8rem;
    font-size: clamp(1.6rem, 4vw, 2.3rem);
    font-weight: 600;
    letter-spacing: -0.015em;
  }

  .lede {
    margin: 0;
    color: var(--muted);
    line-height: 1.6;
    font-size: 0.88rem;
  }

  .verdict {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    width: min(920px, 100%);
    margin: 0;
    padding: 0.85rem 1.1rem;
    font-size: 0.95rem;
  }

  .verdict.good {
    border-color: rgba(74, 222, 128, 0.45);
    color: #b8f5cf;
  }

  .verdict.bad {
    border-color: rgba(255, 145, 120, 0.5);
    color: #ffc9bb;
  }

  table {
    width: min(920px, 100%);
    border-collapse: collapse;
    overflow: hidden;
    font-size: 0.85rem;
  }

  th,
  td {
    padding: 0.6rem 0.9rem;
    text-align: left;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }

  th {
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 500;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tr.is-bad td {
    background: rgba(255, 120, 96, 0.07);
  }

  .num {
    text-align: right;
  }

  .swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.5rem;
  }

  .ok {
    color: #7fd6a2;
  }

  summary {
    cursor: pointer;
    color: #ffb4a2;
  }

  ul {
    margin: 0.5rem 0 0;
    padding-left: 1rem;
    display: grid;
    gap: 0.2rem;
    font-size: 0.76rem;
    color: var(--muted);
  }

  .more {
    list-style: none;
    margin-left: -1rem;
  }

  .foot {
    max-width: 68ch;
    margin: 0;
    line-height: 1.55;
    text-align: center;
  }
</style>
