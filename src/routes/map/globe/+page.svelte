<script lang="ts">
  import GlobeMap from '$lib/map/GlobeMap.svelte';
  import Hud from '$lib/ui/Hud.svelte';
</script>

<svelte:head>
  <title>Mapa global · Globo 3D</title>
</svelte:head>

<GlobeMap />
<Hud note="Orbita con arrastre. Los cascos son clicables sobre el globo." />
