<script lang="ts">
    // The Devices tab: a table sorted by its column headers on a wide screen, a list with a sort menu on a phone; the
    // same filters for both.
    import { ArrowDown, ArrowUp, ArrowUpDown, Search, Trash2 } from '@lucide/svelte';
    import Choice from '$lib/components/Choice.svelte';
    import { Badge } from '$lib/components/ui/badge/index.js';
    import { Button } from '$lib/components/ui/button/index.js';
    import * as InputGroup from '$lib/components/ui/input-group/index.js';
    import { Skeleton } from '$lib/components/ui/skeleton/index.js';
    import * as Table from '$lib/components/ui/table/index.js';
    import { DEVICE_COLUMNS, deviceFacets, deviceRows, nextDeviceSort } from '$lib/core/listing.js';
    import { app } from '$lib/state/app.svelte.js';
    import { wide } from '$lib/wide.svelte.js';

    const criteria = $derived(app.prefs.devices);
    const set = (patch: Record<string, unknown>) => app.setPrefs('devices', patch);
    const view = $derived(app.view);
    const rows = $derived(view.appliances ? deviceRows(view, criteria) : []);
    const facets = $derived(deviceFacets(view));
    const count = $derived(view.appliances
        ? (rows.length === view.appliances.length ? `${rows.length} appareils` : `${rows.length} sur ${view.appliances.length}`) : '');
    const sortOf = (column: string) => (criteria.sort !== column ? 'none' : criteria.dir === 'desc' ? 'descending' : 'ascending');
</script>

{#snippet source(s: string)}
    <Badge variant={s === 'Skill' ? 'secondary' : 'outline'} class={s === 'Skill' ? 'bg-warning/15 text-warning' : 'text-primary'}>{s}</Badge>
{/snippet}

<div class="space-y-3">
    <InputGroup.Root>
        <InputGroup.Addon><Search /></InputGroup.Addon>
        <InputGroup.Input value={criteria.text} placeholder="Filtrer les appareils" aria-label="Filtrer les appareils"
            oninput={(e: Event) => set({ text: (e.currentTarget as HTMLInputElement).value })} />
    </InputGroup.Root>

    <div class="flex flex-wrap items-end gap-3">
        {#if !wide.current}
            <div class="flex items-end gap-1">
                <Choice label="Trier" value={criteria.sort} options={Object.entries(DEVICE_COLUMNS)} onChange={(sort) => set({ sort })} />
                <Button variant="outline" size="icon" aria-label={criteria.dir === 'desc' ? 'Ordre décroissant' : 'Ordre croissant'}
                    onclick={() => set({ dir: criteria.dir === 'desc' ? 'asc' : 'desc' })}>
                    {#if criteria.dir === 'desc'}<ArrowDown />{:else}<ArrowUp />{/if}
                </Button>
            </div>
        {/if}
        <Choice label="Source" value={criteria.source} options={[['all', 'Toutes'], ...facets.sources.map((s: string) => [s, s] as [string, string])]}
            onChange={(s) => set({ source: s })} />
        <Choice label="Fabricant" value={criteria.maker || '-'} options={[['-', 'Tous'], ...facets.makers.map((m: string) => [m, m] as [string, string])]}
            onChange={(m) => set({ maker: m === '-' ? '' : m })} />
        <Choice label="Utilisé" value={criteria.used} options={[['all', 'Peu importe'], ['yes', 'Par une routine'], ['no', 'Par aucune']]}
            onChange={(used) => set({ used })} />
        <span class="ml-auto self-center text-sm text-muted-foreground" aria-live="polite">{count}</span>
    </div>

    {#if !view.appliances}
        <div class="space-y-2"><Skeleton class="h-8 w-3/5" /><Skeleton class="h-8 w-full" /><Skeleton class="h-8 w-full" /></div>
    {:else if wide.current}
        <div class="max-h-[calc(100dvh-260px)] overflow-auto rounded-lg border">
            <Table.Root>
                <Table.Header class="sticky top-0 z-10 bg-muted">
                    <Table.Row>
                        {#each Object.entries(DEVICE_COLUMNS) as [column, title] (column)}
                            <Table.Head aria-sort={sortOf(column)}>
                                <button type="button" class="inline-flex items-center gap-1 font-medium" onclick={() => set(nextDeviceSort(criteria, column))}>
                                    {title}
                                    {#if criteria.sort !== column}<ArrowUpDown class="size-3.5 text-muted-foreground" />
                                    {:else if criteria.dir === 'desc'}<ArrowDown class="size-3.5 text-primary" />
                                    {:else}<ArrowUp class="size-3.5 text-primary" />{/if}
                                </button>
                            </Table.Head>
                        {/each}
                        <Table.Head><span class="sr-only">Actions</span></Table.Head>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {#each rows as { a, source: s, refs } (a.applianceId)}
                        <Table.Row class={app.isPending(a.applianceId) ? 'opacity-50' : ''}>
                            <Table.Cell class="font-medium">{a.friendlyName}</Table.Cell>
                            <Table.Cell>{a.manufacturerName || ''}</Table.Cell>
                            <Table.Cell>{@render source(s)}</Table.Cell>
                            <Table.Cell class="max-w-xs text-xs whitespace-normal text-muted-foreground">{refs.length ? refs.join(', ') : '—'}</Table.Cell>
                            <Table.Cell class="text-right">
                                <Button variant="ghost" size="icon-sm" class="text-destructive hover:text-destructive" aria-label="Supprimer {a.friendlyName}"
                                    onclick={() => app.actions.forget(a)}><Trash2 /></Button>
                            </Table.Cell>
                        </Table.Row>
                    {/each}
                </Table.Body>
            </Table.Root>
        </div>
    {:else}
        <ul class="divide-y rounded-lg border">
            {#each rows as { a, source: s, refs } (a.applianceId)}
                <li class="flex items-center gap-3 px-3 py-2.5 {app.isPending(a.applianceId) ? 'opacity-50' : ''}">
                    <div class="min-w-0 flex-1">
                        <p class="font-medium">{a.friendlyName}</p>
                        <p class="flex items-center gap-1.5 text-sm text-muted-foreground">{a.manufacturerName || ''} {@render source(s)}</p>
                        {#if refs.length}<p class="text-xs text-muted-foreground">{refs.join(', ')}</p>{/if}
                    </div>
                    <Button variant="ghost" size="icon" class="text-destructive hover:text-destructive" aria-label="Supprimer {a.friendlyName}"
                        onclick={() => app.actions.forget(a)}><Trash2 /></Button>
                </li>
            {/each}
        </ul>
    {/if}
    {#if view.appliances && !rows.length}
        <p class="py-6 text-center text-sm text-muted-foreground">Aucun appareil ne correspond aux filtres.</p>
    {/if}
</div>
