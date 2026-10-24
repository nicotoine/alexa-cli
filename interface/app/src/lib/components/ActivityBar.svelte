<script lang="ts">
    // The activity queue on screen: a compact bar at the bottom (a loader while something runs, a countdown with
    // Annuler during an undo window, the latest outcome after), opening a bottom sheet with every item — undo, retry,
    // force — and the server's journal of applied changes. On a phone the bar is one line.
    import { CircleAlert, CircleCheck, CircleX, Hourglass, LoaderCircle, Trash2 } from '@lucide/svelte';
    import { journal } from '$lib/core/api.js';
    import { Badge } from '$lib/components/ui/badge/index.js';
    import { Button } from '$lib/components/ui/button/index.js';
    import * as Sheet from '$lib/components/ui/sheet/index.js';
    import * as Tabs from '$lib/components/ui/tabs/index.js';
    import { time } from '$lib/labels.js';
    import { app } from '$lib/state/app.svelte.js';

    let open = $state(false);
    let pane = $state('queue');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let entries = $state<any[] | null>(null);
    let journalError = $state<string | null>(null);

    // The time, ticking while a countdown shows (a value kept from an earlier render read "27 s" for a 5 s window).
    let now = $state(Date.now());
    $effect(() => {
        if (!summary.waiting) return;
        now = Date.now();
        const t = setInterval(() => (now = Date.now()), 250);
        return () => clearInterval(t);
    });

    const items = $derived(app.activity.items);
    const summary = $derived(app.activity.summary());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const waiting = $derived(items.find((i: any) => i.state === 'waiting'));
    const secondsLeft = (deadline: number) => Math.max(0, Math.ceil((deadline - now) / 1000));
    const text = $derived.by(() => {
        if (summary.busy) {
            if (waiting && summary.running === 0) return `${waiting.label} · ${secondsLeft(waiting.deadline)} s`;
            const n = summary.running + summary.waiting;
            return `${n} action${n > 1 ? 's' : ''} en cours`;
        }
        return summary.last ? `${summary.last.label} · ${summary.last.detail || summary.last.state}` : '';
    });

    $effect(() => {
        if (open && pane === 'journal') {
            entries = null;
            journal().then((e: never[]) => (entries = e), (e: Error) => (journalError = e.message));
        }
    });
</script>

{#snippet stateIcon(state: string)}
    {#if state === 'running'}<LoaderCircle class="size-5 shrink-0 animate-spin text-primary" />
    {:else if state === 'done'}<CircleCheck class="size-5 shrink-0 text-success" />
    {:else if state === 'failed'}<CircleAlert class="size-5 shrink-0 text-destructive" />
    {:else if state === 'waiting'}<Hourglass class="size-5 shrink-0 text-warning" />
    {:else}<CircleX class="size-5 shrink-0 text-muted-foreground" />{/if}
{/snippet}

{#if items.length}
    <div
        class="fixed bottom-4 left-1/2 z-40 flex w-[min(460px,calc(100vw-24px))] -translate-x-1/2 items-center gap-2 rounded-xl border bg-popover py-1.5 pr-2 pl-1.5 text-popover-foreground shadow-lg {summary.failed ? 'ring-2 ring-destructive' : ''}"
        role="status" aria-live="polite"
    >
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1 text-left hover:bg-muted" onclick={() => (open = true)}
            aria-label="Ouvrir l'activité">
            {@render stateIcon(summary.busy ? 'running' : summary.last?.state)}
            <span class="min-w-0 flex-1 truncate text-sm">{text}</span>
            {#if summary.failed}<Badge variant="destructive">{summary.failed}</Badge>{/if}
        </button>
        {#if waiting}
            <Button size="sm" onclick={() => waiting.undo()}>Annuler</Button>
        {/if}
    </div>
{/if}

<Sheet.Root bind:open>
    <Sheet.Content side="bottom" class="max-h-[85dvh] rounded-t-2xl">
        <Sheet.Header class="flex-row items-center justify-between pb-0">
            <Sheet.Title>Activité</Sheet.Title>
            <Button variant="ghost" size="icon" class="mr-8" onclick={() => app.activity.clearFinished()} title="Effacer les actions terminées" aria-label="Effacer les actions terminées">
                <Trash2 />
            </Button>
        </Sheet.Header>
        <Tabs.Root bind:value={pane} class="min-h-0 px-4">
            <Tabs.List class="w-full">
                <Tabs.Trigger value="queue">File ({items.length})</Tabs.Trigger>
                <Tabs.Trigger value="journal">Journal</Tabs.Trigger>
            </Tabs.List>
            <div class="mt-2 max-h-[55dvh] overflow-y-auto pb-4">
                <Tabs.Content value="queue">
                    <ul class="divide-y">
                        {#each [...items].reverse() as item (item.id)}
                            <li class="flex items-start gap-3 py-3">
                                {@render stateIcon(item.state)}
                                <div class="min-w-0 flex-1">
                                    <p class="text-sm font-medium">{item.label}</p>
                                    <p class="text-sm text-muted-foreground">
                                        {#if item.state === 'waiting'}Envoi dans {secondsLeft(item.deadline)} s
                                        {:else if item.state === 'running'}En cours…
                                        {:else}{item.detail || ''}{/if}
                                    </p>
                                    <p class="text-xs text-muted-foreground">{time(item.startedAt)}{item.endedAt ? ` → ${time(item.endedAt)}` : ''}</p>
                                </div>
                                <div class="flex shrink-0 gap-1">
                                    {#if item.undo}<Button size="sm" variant="outline" onclick={item.undo}>Annuler</Button>{/if}
                                    {#if item.retry}<Button size="sm" variant="outline" onclick={item.retry}>Réessayer</Button>{/if}
                                    {#if item.action}<Button size="sm" variant="destructive" onclick={item.action.run}>{item.action.label}</Button>{/if}
                                </div>
                            </li>
                        {/each}
                    </ul>
                </Tabs.Content>
                <Tabs.Content value="journal">
                    {#if journalError}
                        <p class="py-3 text-sm text-muted-foreground">Journal indisponible : {journalError}</p>
                    {:else if !entries}
                        <LoaderCircle class="my-4 size-5 animate-spin text-muted-foreground" />
                    {:else if !entries.length}
                        <p class="py-3 text-sm text-muted-foreground">Aucune modification enregistrée pour l'instant.</p>
                    {:else}
                        <ul class="divide-y">
                            {#each entries as e, i (i)}
                                <li class="flex items-start gap-3 py-3">
                                    {@render stateIcon(e.ok ? 'done' : 'failed')}
                                    <div class="min-w-0 flex-1">
                                        <p class="text-sm font-medium">{e.command}{e.target ? ` · ${e.target.replace(/^amzn1\.alexa\.automation\./, '')}` : ''}</p>
                                        <p class="text-sm break-words text-muted-foreground">{e.ok ? (e.message || e.plan) : e.error}</p>
                                        <p class="text-xs text-muted-foreground">{new Date(e.at).toLocaleString('fr-FR')}</p>
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </Tabs.Content>
                <p class="pt-3 text-xs text-muted-foreground">
                    Les suppressions attendent 5 s avant d'être envoyées : « Annuler » les arrête.
                    {#if app.build}<br />alexa-cli {app.build.label}{/if}
                </p>
            </div>
        </Tabs.Root>
    </Sheet.Content>
</Sheet.Root>
