<script lang="ts">
    // One device: what it is, what it is doing now (asked when the panel opens), and switching it on or off when
    // it accepts that. The state comes from Alexa at the moment of asking; the list stays as the snapshot left it.
    import { LoaderCircle, Power, PowerOff, RefreshCw, Trash2 } from '@lucide/svelte';
    import { Badge } from '$lib/components/ui/badge/index.js';
    import { Button } from '$lib/components/ui/button/index.js';
    import { Separator } from '$lib/components/ui/separator/index.js';
    import * as Sheet from '$lib/components/ui/sheet/index.js';
    import { Skeleton } from '$lib/components/ui/skeleton/index.js';
    import { deviceState } from '$lib/core/api.js';
    import { explain } from '$lib/core/explain.js';
    import { app } from '$lib/state/app.svelte.js';
    import { wide } from '$lib/wide.svelte.js';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { appliance, source = '', refs = [], onClose }: { appliance: any; source?: string; refs?: string[]; onClose: () => void } = $props();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let info = $state<any>(null);
    let error = $state<string | null>(null);
    let loading = $state(false);
    let switching = $state<'on' | 'off' | null>(null);

    const ops = $derived(((appliance?.features || []).find((f: { name: string }) => f.name === 'power')?.operations || [])
        .map((o: { name: string }) => o.name));
    const canSwitch = $derived(ops.includes('turnOn') && ops.includes('turnOff'));

    async function load() {
        if (!appliance) return;
        const asked = appliance.applianceId;
        loading = true;
        error = null;
        try {
            const s = await deviceState(asked);
            // Another device opened meanwhile: this answer is not for it.
            if (appliance?.applianceId === asked) info = s;
        } catch (e) {
            if (appliance?.applianceId === asked) error = explain((e as Error).message);
        } finally {
            loading = false;
        }
    }

    async function setPower(on: boolean) {
        switching = on ? 'on' : 'off';
        const after = await app.actions.power(appliance, on);
        if (after) info = after;
        switching = null;
    }

    // Keyed on the id, not the object: the list hands a new object on every refresh, and the state must not be
    // asked again (and blanked) for the same device every two minutes.
    const currentId = $derived(appliance?.applianceId ?? null);
    $effect(() => {
        if (!currentId) return;
        info = null;
        load();
    });

    const powerText = $derived(info?.power === 'ON' ? 'Allumé' : info?.power === 'OFF' ? 'Éteint' : '—');
</script>

<Sheet.Root open={appliance !== null} onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
    <Sheet.Content side={wide.current ? 'right' : 'bottom'} class={wide.current ? 'w-full sm:max-w-md' : 'max-h-[85dvh] rounded-t-2xl'}>
        {#if appliance}
            <Sheet.Header class="pb-0">
                <Sheet.Title>{appliance.friendlyName}</Sheet.Title>
                <Sheet.Description class="flex flex-wrap items-center gap-1.5">
                    {appliance.manufacturerName || ''}
                    {#if source}<Badge variant="outline">{source}</Badge>{/if}
                    {#each appliance.applianceTypes || [] as t (t)}<Badge variant="secondary">{t}</Badge>{/each}
                </Sheet.Description>
            </Sheet.Header>

            <div class="space-y-4 overflow-y-auto px-4 pb-4">
                <section class="space-y-2 rounded-lg border p-3">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-medium">État</h3>
                        <Button variant="ghost" size="icon-sm" onclick={load} disabled={loading} aria-label="Relire l'état" title="Relire l'état">
                            {#if loading}<LoaderCircle class="animate-spin" />{:else}<RefreshCw />{/if}
                        </Button>
                    </div>
                    {#if error}
                        <p class="text-sm text-destructive">{error}</p>
                    {:else if !info}
                        <Skeleton class="h-5 w-2/3" /><Skeleton class="h-5 w-1/2" />
                    {:else}
                        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                            <dt class="text-muted-foreground">Joignable</dt>
                            <dd class={info.reachable ? 'text-success' : 'text-destructive'}>{info.reachable ? 'Oui' : 'Non'}</dd>
                            {#if info.power}
                                <dt class="text-muted-foreground">Alimentation</dt>
                                <dd class={info.power === 'ON' ? 'font-medium text-success' : ''}>{powerText}</dd>
                            {/if}
                            {#if info.brightness !== null && info.brightness !== undefined}
                                <dt class="text-muted-foreground">Luminosité</dt><dd>{info.brightness} %</dd>
                            {/if}
                        </dl>
                    {/if}
                    {#if canSwitch}
                        <div class="grid grid-cols-2 gap-2 pt-1">
                            <Button disabled={switching !== null || (info && info.power === 'ON')} onclick={() => setPower(true)}>
                                {#if switching === 'on'}<LoaderCircle class="animate-spin" />{:else}<Power />{/if}Allumer
                            </Button>
                            <Button variant="outline" disabled={switching !== null || (info && info.power === 'OFF')} onclick={() => setPower(false)}>
                                {#if switching === 'off'}<LoaderCircle class="animate-spin" />{:else}<PowerOff />{/if}Éteindre
                            </Button>
                        </div>
                    {:else if info}
                        <p class="text-xs text-muted-foreground">Cet appareil ne se pilote pas en marche / arrêt depuis ici.</p>
                    {/if}
                </section>

                {#if info && info.features.length}
                    <section class="space-y-1">
                        <h3 class="text-sm font-medium">Fonctions</h3>
                        <ul class="space-y-1 text-xs text-muted-foreground">
                            {#each info.features as f (f.name + (f.instance || ''))}
                                <li>
                                    <span class="font-medium text-foreground">{f.name}{f.instance ? `.${f.instance}` : ''}</span>
                                    {Object.entries(f.properties).map(([k, v]) => `${k} : ${v ?? '?'}`).join(' · ')}
                                    {#if f.operations.length}<span class="text-primary"> — {f.operations.join(', ')}</span>{/if}
                                </li>
                            {/each}
                        </ul>
                    </section>
                {/if}

                <section class="space-y-1">
                    <h3 class="text-sm font-medium">Routines</h3>
                    <p class="text-sm text-muted-foreground">{refs.length ? refs.join(', ') : 'Aucune routine ne l\'utilise.'}</p>
                </section>

                <Separator />
                <p class="text-xs break-all text-muted-foreground">{appliance.applianceId}</p>
                <Button variant="ghost" class="w-full text-destructive hover:text-destructive"
                    onclick={() => { app.actions.forget(appliance); onClose(); }}>
                    <Trash2 />Supprimer d'Alexa
                </Button>
            </div>
        {/if}
    </Sheet.Content>
</Sheet.Root>
