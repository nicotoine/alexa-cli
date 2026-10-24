<script lang="ts">
    // The routine editor: a spec (see src/routine-spec.js) edited as a form. What it saves is checked by the CLI's own
    // checkSpec as you type, and drawn by the CLI's own fromSpec when saved — the editor cannot write anything the CLI
    // would not.
    //
    // The actions are one ordered list, reordered by dragging their handle: that is what Amazon keeps (it makes its
    // own groups — each run of device actions runs with the next action), so the editor does not offer parallel blocks.
    import {
        CalendarClock, Clapperboard, GripVertical, Hourglass, Lightbulb, Megaphone, MessageSquare, Mic, Plus, Trash2, Tv, X,
    } from '@lucide/svelte';
    import { DAYS, PLAYS, checkSpec, toSpec } from '@cli/routine-spec.js';
    import { dragHandle, dragHandleZone } from 'svelte-dnd-action';
    import { flip } from 'svelte/animate';
    import Choice from '$lib/components/Choice.svelte';
    import DevicePicker from '$lib/components/DevicePicker.svelte';
    import { Badge } from '$lib/components/ui/badge/index.js';
    import { Button } from '$lib/components/ui/button/index.js';
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
    import { Input } from '$lib/components/ui/input/index.js';
    import { Label } from '$lib/components/ui/label/index.js';
    import { Switch } from '$lib/components/ui/switch/index.js';
    import * as Tabs from '$lib/components/ui/tabs/index.js';
    import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
    import { explain } from '$lib/core/explain.js';
    import { label, phraseOwner } from '$lib/core/model.js';
    import { DAY_LABELS, DAY_NAMES, PLAY_LABELS } from '$lib/labels.js';
    import { app } from '$lib/state/app.svelte.js';

    /* eslint-disable @typescript-eslint/no-explicit-any */
    let { open, routine, onClose, onSave }: {
        open: boolean;
        routine: any;
        onClose: () => void;
        onSave: (spec: any, existing: any) => void;
    } = $props();

    const view = $derived(app.view);
    const KINDS: Record<string, { label: string; icon: any; make: () => any }> = {
        device: { label: 'Appareil', icon: Lightbulb, make: () => ({ device: (view.devices || [])[0]?.displayName || '', turn: 'on' }) },
        say: { label: 'Parler', icon: MessageSquare, make: () => ({ say: '' }) },
        wait: { label: 'Attendre', icon: Hourglass, make: () => ({ wait: 5 }) },
        play: { label: 'Météo, heure, infos…', icon: Clapperboard, make: () => ({ play: 'weather' }) },
        command: { label: 'Commande à Alexa', icon: Megaphone, make: () => ({ command: '' }) },
        fireTv: {
            label: 'Éteindre une Fire TV', icon: Tv,
            make: () => ({ fireTv: 'off', on: ((view.echos || []).find((e: any) => e.deviceFamily === 'FIRE_TV') || {}).accountName || '' }),
        },
    };
    const kindOf = (step: any) => Object.keys(KINDS).find((k) => step[k] !== undefined) || 'raw';

    // svelte-dnd-action follows items by `id`; it is taken off again before the spec leaves the editor.
    let seq = 0;
    const withIds = (steps: any[]) => steps.map((s) => ({ ...s, id: ++seq }));
    const withoutIds = (spec: any) => ({ ...spec, do: spec.do.map(({ id: _id, ...s }: any) => s) });
    const EMPTY = () => ({ name: '', enabled: true, when: { say: [] as string[] }, do: [] as any[] });

    let spec = $state<any>(EMPTY());
    let phrase = $state('');

    // Reloaded only when the editor opens, not on every refresh of the view behind it.
    let wasOpen = false;
    $effect(() => {
        if (open && !wasOpen) {
            const v = $state.snapshot(app.view) as any;
            const start: any = routine
                ? toSpec($state.snapshot(routine), { devices: [...(v.devices || []), ...(v.appliances || [])] as any, echos: v.echos || [] })
                : EMPTY();
            spec = { ...start, do: withIds(start.do) };
            phrase = '';
        }
        wasOpen = open;
    });

    const scheduled = $derived(spec.when.at !== undefined);
    const phrases = $derived<string[]>([].concat(spec.when.say || []));

    // Checked as you type, by the CLI's own rules, plus phrases another routine already answers to.
    const error = $derived.by(() => {
        try {
            checkSpec(withoutIds($state.snapshot(spec)));
        } catch (e) {
            return explain((e as Error).message);
        }
        for (const p of phrases) {
            const owner = phraseOwner(view.routines, p, routine && routine.automationId);
            if (owner) return `« ${p} » déclenche déjà « ${label(owner)} ».`;
        }
        return null;
    });

    function addPhrase(typed = phrase) {
        const p = String(typed || '').trim();
        if (p && !phrases.includes(p)) spec.when = { say: [...phrases, p] };
        phrase = '';
    }

    function toggleDay(d: string) {
        const days: string[] = spec.when.days || [];
        const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
        spec.when = { ...spec.when, days: DAYS.filter((x: string) => next.includes(x)) };
    }

    function echoOptions({ fireTv = false } = {}): [string, string][] {
        const list = (view.echos || [])
            .filter((e: any) => (fireTv ? e.deviceFamily === 'FIRE_TV' : e.deviceFamily !== 'FIRE_TV'))
            .map((e: any) => [e.accountName || e.serialNumber, e.accountName || `Appli Alexa (${e.serialNumber.slice(0, 6)}…)`] as [string, string]);
        return !scheduled && !fireTv ? [['-', 'L\'Echo qui a entendu'], ...list] : list;
    }

    const save = () => onSave(withoutIds($state.snapshot(spec)), routine);
</script>

{#snippet echoChoice(step: any, fireTv = false)}
    <Choice label="Sur" class="flex-1" value={step.on || (!scheduled && !fireTv ? '-' : '')} options={echoOptions({ fireTv })}
        onChange={(on) => (step.on = on === '-' ? undefined : on)} />
{/snippet}

<Dialog.Root {open} onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
    <Dialog.Content class="flex h-dvh max-h-dvh max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-xl">
        <Dialog.Header class="border-b px-4 py-3">
            <Dialog.Title>{routine ? 'Modifier la routine' : 'Nouvelle routine'}</Dialog.Title>
        </Dialog.Header>

        <div class="flex-1 space-y-6 overflow-y-auto px-4 py-4">
            <div class="flex items-end gap-4">
                <div class="grid flex-1 gap-1.5">
                    <Label for="routine-name">Nom</Label>
                    <Input id="routine-name" value={spec.name || ''} placeholder={phrases[0] || 'nom de la routine'}
                        oninput={(e: Event) => (spec.name = (e.currentTarget as HTMLInputElement).value || null)} />
                </div>
                <div class="flex h-8 items-center gap-2">
                    <Switch id="routine-enabled" checked={spec.enabled !== false} onCheckedChange={(on: boolean) => (spec.enabled = on)} />
                    <Label for="routine-enabled">Active</Label>
                </div>
            </div>

            <section class="space-y-3">
                <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quand</h3>
                <Tabs.Root value={scheduled ? 'at' : 'say'} onValueChange={(v: string) => (spec.when = v === 'at' ? { at: '07:00' } : { say: [] })}>
                    <Tabs.List class="w-full">
                        <Tabs.Trigger value="say"><Mic />Phrase</Tabs.Trigger>
                        <Tabs.Trigger value="at"><CalendarClock />Horaire</Tabs.Trigger>
                    </Tabs.List>
                </Tabs.Root>
                {#if scheduled}
                    <div class="flex flex-wrap items-end gap-4">
                        <div class="grid gap-1.5">
                            <Label for="routine-at">Heure</Label>
                            <Input id="routine-at" type="time" class="w-32" value={spec.when.at}
                                oninput={(e: Event) => (spec.when = { ...spec.when, at: (e.currentTarget as HTMLInputElement).value })} />
                        </div>
                        <div class="grid gap-1.5">
                            <span class="text-sm font-medium" id="days-label">Jours</span>
                            <div class="flex gap-1" role="group" aria-labelledby="days-label">
                                {#each DAYS as d (d)}
                                    {@const on = (spec.when.days || []).includes(d)}
                                    <Button size="icon" variant={on ? 'default' : 'outline'} class="rounded-full" aria-pressed={on} title={DAY_NAMES[d]}
                                        aria-label={DAY_NAMES[d]} onclick={() => toggleDay(d)}>{DAY_LABELS[d]}</Button>
                                {/each}
                            </div>
                        </div>
                    </div>
                    {#if !(spec.when.days || []).length}<p class="text-xs text-muted-foreground">Aucun jour choisi : tous les jours.</p>{/if}
                {:else}
                    {#if phrases.length}
                        <div class="flex flex-wrap gap-1.5">
                            {#each phrases as p (p)}
                                <Badge variant="outline" class="h-7 gap-1 pr-1 text-sm font-normal">
                                    {p}
                                    <button type="button" class="rounded-full p-0.5 hover:bg-muted" aria-label="Retirer {p}"
                                        onclick={() => (spec.when = { say: phrases.filter((x) => x !== p) })}><X class="size-3.5" /></button>
                                </Badge>
                            {/each}
                        </div>
                    {/if}
                    <div class="flex gap-2">
                        <Input value={phrase} placeholder="Alexa, …" aria-label="Ajouter une phrase"
                            oninput={(e: Event) => (phrase = (e.currentTarget as HTMLInputElement).value)}
                            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') addPhrase((e.currentTarget as HTMLInputElement).value); }} />
                        <Button variant="outline" onclick={() => addPhrase()}><Plus />Ajouter</Button>
                    </div>
                {/if}
            </section>

            <section class="space-y-3">
                <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Alexa fait, dans l'ordre</h3>
                <ol class="space-y-2"
                    use:dragHandleZone={{ items: spec.do, flipDurationMs: 150, dropTargetStyle: {} }}
                    onconsider={(e: CustomEvent) => (spec.do = e.detail.items)}
                    onfinalize={(e: CustomEvent) => (spec.do = e.detail.items)}>
                    {#each spec.do as step, i (step.id)}
                        {@const kind = kindOf(step)}
                        {@const meta = KINDS[kind]}
                        <li class="flex items-start gap-2 rounded-lg border bg-card p-2" animate:flip={{ duration: 150 }}>
                            <button type="button" use:dragHandle class="mt-1 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted"
                                aria-label="Déplacer l'action {i + 1}"><GripVertical class="size-4" /></button>
                            <div class="min-w-0 flex-1 space-y-2">
                                <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    {#if meta}<meta.icon class="size-3.5 text-primary" />{/if}{meta?.label || 'Autre'}
                                </p>
                                {#if kind === 'device'}
                                    <div class="flex flex-wrap items-center gap-2">
                                        <DevicePicker value={step.device} devices={view.devices} onChange={(d) => (step.device = d)} />
                                        <ToggleGroup.Root type="single" variant="outline" value={step.turn}
                                            onValueChange={(v: string) => { if (v) step.turn = v; }}>
                                            <ToggleGroup.Item value="on">Allumer</ToggleGroup.Item>
                                            <ToggleGroup.Item value="off">Éteindre</ToggleGroup.Item>
                                        </ToggleGroup.Root>
                                    </div>
                                {:else if kind === 'say' || kind === 'command'}
                                    <div class="flex flex-wrap items-end gap-2">
                                        <div class="grid min-w-48 flex-[2] gap-1">
                                            <Label class="text-xs text-muted-foreground" for="step-{step.id}">{kind === 'say' ? 'Alexa dit' : 'Comme si on disait'}</Label>
                                            <Input id="step-{step.id}" value={step[kind]} placeholder={kind === 'say' ? 'Bonne nuit !' : 'mets de la musique douce'}
                                                oninput={(e: Event) => (step[kind] = (e.currentTarget as HTMLInputElement).value)} />
                                        </div>
                                        {@render echoChoice(step)}
                                    </div>
                                {:else if kind === 'wait'}
                                    <div class="grid w-32 gap-1">
                                        <Label class="text-xs text-muted-foreground" for="step-{step.id}">Secondes</Label>
                                        <Input id="step-{step.id}" type="number" min="1" max="3600" value={step.wait}
                                            oninput={(e: Event) => (step.wait = Number((e.currentTarget as HTMLInputElement).value) || 0)} />
                                    </div>
                                {:else if kind === 'play'}
                                    <div class="flex flex-wrap items-end gap-2">
                                        <Choice label="Annonce" class="flex-1" value={step.play}
                                            options={Object.keys(PLAYS).map((p) => [p, PLAY_LABELS[p] || p] as [string, string])}
                                            onChange={(p) => (step.play = p)} />
                                        {@render echoChoice(step)}
                                    </div>
                                {:else if kind === 'fireTv'}
                                    {@render echoChoice(step, true)}
                                {:else}
                                    <p class="text-sm text-muted-foreground">Action « {step.raw.type} » conservée telle quelle.</p>
                                {/if}
                            </div>
                            <Button variant="ghost" size="icon-sm" class="text-destructive hover:text-destructive" aria-label="Retirer l'action {i + 1}"
                                onclick={() => (spec.do = spec.do.filter((s: any) => s.id !== step.id))}><Trash2 /></Button>
                        </li>
                    {/each}
                </ol>
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                        {#snippet child({ props })}
                            <Button {...props} variant="outline" class="w-full"><Plus />Ajouter une action</Button>
                        {/snippet}
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content class="w-64">
                        {#each Object.entries(KINDS) as [kind, meta] (kind)}
                            <DropdownMenu.Item onSelect={() => (spec.do = [...spec.do, { ...meta.make(), id: ++seq }])}>
                                <meta.icon />{meta.label}
                            </DropdownMenu.Item>
                        {/each}
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
                <p class="text-xs text-muted-foreground">
                    Amazon exécute les actions dans l'ordre ; plusieurs actions sur des appareils à la suite se font en même temps que l'action qui les suit.
                </p>
            </section>
        </div>

        <Dialog.Footer class="m-0 flex-col gap-2 border-t px-4 py-3 sm:flex-col">
            {#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
            <div class="flex justify-end gap-2">
                <Button variant="ghost" onclick={onClose}>Annuler</Button>
                <Button disabled={Boolean(error)} onclick={save}>Enregistrer</Button>
            </div>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
