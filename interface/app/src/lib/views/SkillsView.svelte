<script lang="ts">
    // The Skills tab: each skill and the devices it provides. A deleted device that comes back here comes from a skill
    // that is still linked.
    import Choice from '$lib/components/Choice.svelte';
    import { Badge } from '$lib/components/ui/badge/index.js';
    import * as Card from '$lib/components/ui/card/index.js';
    import { Checkbox } from '$lib/components/ui/checkbox/index.js';
    import { Label } from '$lib/components/ui/label/index.js';
    import { Skeleton } from '$lib/components/ui/skeleton/index.js';
    import { SKILL_SORTS, skillRows, skillTypes } from '$lib/core/listing.js';
    import { app } from '$lib/state/app.svelte.js';

    const criteria = $derived(app.prefs.skills);
    const set = (patch: Record<string, unknown>) => app.setPrefs('skills', patch);
    const view = $derived(app.view);
    const rows = $derived(view.skills ? skillRows(view, criteria) : []);
</script>

<div class="space-y-3">
    <p class="text-sm text-muted-foreground">
        Skills activées et appareils fournis par chacune. Un appareil supprimé qui revient ici vient d'une skill toujours liée.
    </p>
    {#if !view.skills}
        <p class="text-sm text-muted-foreground">La page Amazon des skills est lente…</p>
        <Skeleton class="h-24 w-full" />
    {:else}
        <div class="flex flex-wrap items-end gap-3">
            <Choice label="Trier" value={criteria.sort} options={Object.entries(SKILL_SORTS)} onChange={(sort) => set({ sort })} />
            <Choice label="Type" value={criteria.type} options={[['all', 'Tous'], ...skillTypes(view).map((t: string) => [t, t] as [string, string])]}
                onChange={(type) => set({ type })} />
            <div class="flex h-8 items-center gap-2">
                <Checkbox id="with-devices" checked={criteria.withDevices} onCheckedChange={(withDevices: boolean) => set({ withDevices })} />
                <Label for="with-devices">Avec appareils</Label>
            </div>
            <span class="ml-auto self-center text-sm text-muted-foreground">{rows.length} skill{rows.length > 1 ? 's' : ''}</span>
        </div>
        <div class="grid gap-3 lg:grid-cols-2">
            {#each rows as s (s.id)}
                <Card.Root class="gap-3 py-4">
                    <Card.Header class="px-4">
                        <Card.Title>{s.name || '(sans nom)'}</Card.Title>
                        <Card.Description>{s.type} · {s.devices.length} appareil{s.devices.length > 1 ? 's' : ''}</Card.Description>
                    </Card.Header>
                    <Card.Content class="space-y-2 px-4">
                        {#if s.devices.length}
                            <div class="flex flex-wrap gap-1.5">
                                {#each s.devices as d, i (d.applianceId || i)}<Badge variant="outline" class="font-normal">{d.name}</Badge>{/each}
                            </div>
                        {/if}
                        <p class="font-mono text-xs break-all text-muted-foreground">{s.id}</p>
                    </Card.Content>
                </Card.Root>
            {/each}
        </div>
    {/if}
</div>
