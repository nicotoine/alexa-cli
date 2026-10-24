<script lang="ts">
    // The Routines tab: search, sort and filters, then one card per routine.
    import { CirclePlus, Funnel, Pencil, Play, Search, Trash2, X } from '@lucide/svelte';
    import Choice from '$lib/components/Choice.svelte';
    import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
    import { Badge } from '$lib/components/ui/badge/index.js';
    import { Button } from '$lib/components/ui/button/index.js';
    import * as Card from '$lib/components/ui/card/index.js';
    import { Checkbox } from '$lib/components/ui/checkbox/index.js';
    import * as InputGroup from '$lib/components/ui/input-group/index.js';
    import { Label } from '$lib/components/ui/label/index.js';
    import { Skeleton } from '$lib/components/ui/skeleton/index.js';
    import { Switch } from '$lib/components/ui/switch/index.js';
    import { ROUTINE_DEFAULTS, ROUTINE_SORTS, routineDevices, routineRows } from '$lib/core/listing.js';
    import { OPS, deviceNames, isVoice, label, phraseOwner, targetName } from '$lib/core/model.js';
    import { PLAY_TYPES } from '$lib/labels.js';
    import { app } from '$lib/state/app.svelte.js';
    import { wide } from '$lib/wide.svelte.js';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { onEdit }: { onEdit: (routine: any) => void } = $props();

    const criteria = $derived(app.prefs.routines);
    const set = (patch: Record<string, unknown>) => app.setPrefs('routines', patch);
    // On a phone the filters fold behind a button, so the routines start on the first screen.
    let showFilters = $state(false);
    const active = $derived((['status', 'trigger', 'device', 'broken'] as const)
        .filter((k) => criteria[k] !== (ROUTINE_DEFAULTS as Record<string, unknown>)[k]).length);

    const view = $derived(app.view);
    const names = $derived(deviceNames(view));
    const rows = $derived(view.routines ? routineRows(view, criteria) : []);
    const count = $derived(view.routines
        ? (rows.length === view.routines.length ? `${rows.length} routines` : `${rows.length} sur ${view.routines.length}`) : '');

    // One dialog for the page: a phrase already taken, or a confirmation before running a routine.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dialog = $state<{ title: string; text: string; confirm?: { label: string; run: () => void } } | null>(null);
    const drafts = $state<Record<string, string>>({});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function addPhrase(r: any, typed?: string) {
        const phrase = String(typed ?? drafts[r.automationId] ?? '').trim();
        if (!phrase) return;
        const owner = phraseOwner(view.routines, phrase, r.automationId);
        if (owner) {
            dialog = { title: 'Phrase déjà utilisée', text: `« ${phrase} » déclenche déjà « ${label(owner)} ».` };
            return;
        }
        app.actions.editPhrases(r, { add: [phrase] });
        drafts[r.automationId] = '';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const confirmRun = (r: any) => (dialog = {
        title: `Lancer « ${label(r)} » ?`,
        text: 'La routine s\'exécute maintenant, comme si on l\'avait dite à l\'Echo.',
        confirm: { label: 'Lancer', run: () => app.actions.run(r) },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triggerText = (r: any) => ((r.triggers || [])[0]?.type === 'AbsoluteTimeSchedule' ? 'programmée' : 'autre déclencheur');
</script>

{#snippet actionText(a: any)}
    {#if a.speak}dire « <b>{a.speak}</b> »
    {:else if a.wait !== undefined}attendre {a.wait} s
    {:else if a.command !== undefined}« <b>{a.command}</b> » à Alexa
    {:else if a.type}{PLAY_TYPES[a.type] || a.type.replace(/^Alexa\./, '')}
    {:else}{a.op.split(',').map((o: string) => (OPS as Record<string, string>)[o] || o).join(', ')}
        <b>{targetName(a.target, names) || `${a.target.slice(0, 10)}… (introuvable)`}</b>{/if}
{/snippet}

<div class="space-y-3">
    <InputGroup.Root>
        <InputGroup.Addon><Search /></InputGroup.Addon>
        <InputGroup.Input value={criteria.text} placeholder="Filtrer par nom, phrase ou appareil" aria-label="Filtrer les routines"
            oninput={(e: Event) => set({ text: (e.currentTarget as HTMLInputElement).value })} />
    </InputGroup.Root>

    {#if !wide.current}
        <div class="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" aria-expanded={showFilters} onclick={() => (showFilters = !showFilters)}>
                <Funnel />Trier et filtrer
                {#if active}<Badge class="ml-1 h-4 min-w-4 px-1">{active}</Badge>{/if}
            </Button>
            <span class="text-sm text-muted-foreground" aria-live="polite">{count}</span>
        </div>
    {/if}
    {#if wide.current || showFilters}
        <div class="flex flex-wrap items-end gap-3">
            <Choice label="Trier" value={criteria.sort} options={Object.entries(ROUTINE_SORTS)} onChange={(sort) => set({ sort })} />
            <Choice label="Statut" value={criteria.status} options={[['all', 'Toutes'], ['ENABLED', 'Actives'], ['DISABLED', 'Désactivées']]}
                onChange={(status) => set({ status })} />
            <Choice label="Déclencheur" value={criteria.trigger} options={[['all', 'Tous'], ['voice', 'Phrase'], ['other', 'Autre']]}
                onChange={(trigger) => set({ trigger })} />
            <Choice label="Appareil" value={criteria.device || '-'}
                options={[['-', 'Tous'], ...routineDevices(view).map((d: string) => [d, d] as [string, string])]}
                onChange={(d) => set({ device: d === '-' ? '' : d })} />
            <div class="flex h-8 items-center gap-2">
                <Checkbox id="broken" checked={criteria.broken} onCheckedChange={(broken: boolean) => set({ broken })} />
                <Label for="broken">Cassées</Label>
            </div>
            {#if wide.current}<span class="ml-auto self-center text-sm text-muted-foreground" aria-live="polite">{count}</span>{/if}
        </div>
    {/if}

    {#if !view.routines}
        {#each [0, 1, 2] as i (i)}
            <Card.Root><Card.Content class="space-y-2"><Skeleton class="h-5 w-2/5" /><Skeleton class="h-4 w-4/5" /></Card.Content></Card.Root>
        {/each}
    {:else if !rows.length}
        <p class="py-6 text-center text-sm text-muted-foreground">Aucune routine ne correspond aux filtres.</p>
    {:else}
        <div class="grid gap-3 lg:grid-cols-2">
            {#each rows as { r, phrases, acts } (r.automationId)}
                {@const draft = Boolean(r.draft)}
                {@const pending = draft || app.isPending(r.automationId)}
                <Card.Root class="gap-3 py-4 transition-opacity {pending ? 'opacity-60' : ''}">
                    <Card.Header class="px-4">
                        <div class="flex items-start gap-3">
                            <div class="min-w-0 flex-1">
                                <Card.Title class="leading-snug">{label(r)}</Card.Title>
                                {#if pending}<Card.Description class="text-primary">enregistrement…</Card.Description>
                                {:else if !isVoice(r)}<Card.Description>{triggerText(r)}</Card.Description>{/if}
                            </div>
                            <Switch checked={r.status === 'ENABLED'} disabled={draft}
                                aria-label={r.status === 'ENABLED' ? 'Désactiver' : 'Activer'}
                                onCheckedChange={(on: boolean) => app.actions.setStatus(r, on ? 'ENABLED' : 'DISABLED')} />
                        </div>
                    </Card.Header>
                    <Card.Content class="space-y-3 px-4">
                        {#if isVoice(r)}
                            <div class="flex flex-wrap items-center gap-1.5">
                                {#each phrases as p (p)}
                                    <Badge variant="outline" class="h-7 gap-1 pr-1 text-sm font-normal">
                                        {p}
                                        {#if phrases.length > 1 && !draft}
                                            <button type="button" class="rounded-full p-0.5 hover:bg-muted" aria-label="Retirer {p}"
                                                onclick={() => app.actions.editPhrases(r, { remove: [p] })}><X class="size-3.5" /></button>
                                        {/if}
                                    </Badge>
                                {/each}
                                {#if !draft}
                                    <InputGroup.Root class="h-7 min-w-48 flex-1">
                                        <InputGroup.Input class="text-sm" placeholder="ajouter une phrase…" aria-label="Ajouter une phrase à {label(r)}"
                                            value={drafts[r.automationId] ?? ''}
                                            oninput={(e: Event) => (drafts[r.automationId] = (e.currentTarget as HTMLInputElement).value)}
                                            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') addPhrase(r, (e.currentTarget as HTMLInputElement).value); }} />
                                        <InputGroup.Addon align="inline-end">
                                            <InputGroup.Button size="icon-xs" aria-label="Ajouter la phrase" onclick={() => addPhrase(r)}><CirclePlus /></InputGroup.Button>
                                        </InputGroup.Addon>
                                    </InputGroup.Root>
                                {/if}
                            </div>
                        {/if}
                        {#if acts.length}
                            <p class="text-sm text-muted-foreground">
                                {#each acts as a, i (i)}{i ? ' · ' : ''}{@render actionText(a)}{/each}
                            </p>
                        {/if}
                    </Card.Content>
                    {#if !draft}
                        <Card.Footer class="gap-1 px-2">
                            <Button variant="ghost" size="sm" onclick={() => onEdit(r)}><Pencil />Modifier</Button>
                            <Button variant="ghost" size="sm" onclick={() => confirmRun(r)}><Play />Lancer</Button>
                            <Button variant="ghost" size="sm" class="ml-auto text-destructive hover:text-destructive" onclick={() => app.actions.deleteRoutine(r)}>
                                <Trash2 />Supprimer
                            </Button>
                        </Card.Footer>
                    {/if}
                </Card.Root>
            {/each}
        </div>
    {/if}
</div>

<AlertDialog.Root open={dialog !== null} onOpenChange={(o: boolean) => { if (!o) dialog = null; }}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>{dialog?.title}</AlertDialog.Title>
            <AlertDialog.Description>{dialog?.text}</AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            {#if dialog?.confirm}
                <AlertDialog.Cancel>Annuler</AlertDialog.Cancel>
                <AlertDialog.Action onclick={() => { dialog?.confirm?.run(); dialog = null; }}>{dialog.confirm.label}</AlertDialog.Action>
            {:else}
                <AlertDialog.Action onclick={() => (dialog = null)}>OK</AlertDialog.Action>
            {/if}
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
