<script lang="ts">
    // The app shell: header with the sync state, the tabs, the activity bar, the routine editor.
    import { CloudCheck, CloudOff, History, LoaderCircle, Plus, RefreshCw } from '@lucide/svelte';
    import ActivityBar from '$lib/components/ActivityBar.svelte';
    import LoginPanel from '$lib/components/LoginPanel.svelte';
    import RoutineEditor from '$lib/components/RoutineEditor.svelte';
    import { Badge } from '$lib/components/ui/badge/index.js';
    import { Button } from '$lib/components/ui/button/index.js';
    import * as Tabs from '$lib/components/ui/tabs/index.js';
    import { app } from '$lib/state/app.svelte.js';
    import AuditView from '$lib/views/AuditView.svelte';
    import DevicesView from '$lib/views/DevicesView.svelte';
    import RoutinesView from '$lib/views/RoutinesView.svelte';
    import SkillsView from '$lib/views/SkillsView.svelte';
    import { onMount } from 'svelte';

    let tab = $state('routines');
    // null: closed; { routine } edits one, { routine: null } creates one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let editing = $state<{ routine: any } | null>(null);

    onMount(() => app.start());

    const sync = $derived(app.sync);
    const busy = $derived(sync.state === 'loading' || sync.state === 'saving' || app.refreshing);
</script>

<div class="min-h-dvh pb-28">
    <header class="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <div class="flex min-w-0 flex-1 items-baseline gap-2">
                <h1 class="text-lg font-semibold tracking-tight">Alexa</h1>
                {#if app.build}<span class="hidden truncate text-xs text-muted-foreground md:inline">{app.build.label}</span>{/if}
            </div>
            <Badge variant="outline" class="max-w-[46vw] gap-1.5 truncate font-normal" aria-live="polite">
                {#if busy}
                    <LoaderCircle class="size-3.5 animate-spin text-primary" />
                {:else if sync.state === 'error'}
                    <CloudOff class="size-3.5 text-destructive" />
                {:else if sync.state === 'cached'}
                    <History class="size-3.5 text-warning" />
                {:else}
                    <CloudCheck class="size-3.5 text-success" />
                {/if}
                <span class="truncate">{sync.text}</span>
            </Badge>
            <Button variant="ghost" size="icon" onclick={() => app.load()} aria-label="Recharger depuis Alexa" title="Recharger depuis Alexa">
                <RefreshCw />
            </Button>
        </div>
    </header>

    <main class="mx-auto max-w-5xl px-4 pt-4">
        {#if app.needsLogin}
            <LoginPanel />
        {:else}
            <Tabs.Root bind:value={tab}>
                <Tabs.List class="w-full sm:w-auto">
                    <Tabs.Trigger value="routines">Routines</Tabs.Trigger>
                    <Tabs.Trigger value="devices">Appareils</Tabs.Trigger>
                    <Tabs.Trigger value="skills">Skills</Tabs.Trigger>
                    <Tabs.Trigger value="audit">Audit</Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="routines" class="pt-3"><RoutinesView onEdit={(routine) => (editing = { routine })} /></Tabs.Content>
                <Tabs.Content value="devices" class="pt-3"><DevicesView /></Tabs.Content>
                <Tabs.Content value="skills" class="pt-3"><SkillsView /></Tabs.Content>
                <Tabs.Content value="audit" class="pt-3"><AuditView /></Tabs.Content>
            </Tabs.Root>
        {/if}
    </main>

    {#if !app.needsLogin && tab === 'routines'}
        <Button size="icon-lg" class="fixed right-5 bottom-20 z-30 size-14 rounded-full shadow-lg"
            onclick={() => (editing = { routine: null })} aria-label="Nouvelle routine" title="Nouvelle routine">
            <Plus class="size-6" />
        </Button>
    {/if}

    <ActivityBar />
    <RoutineEditor
        open={editing !== null}
        routine={editing?.routine ?? null}
        onClose={() => (editing = null)}
        onSave={(spec, existing) => { app.actions.save(spec, existing); editing = null; }}
    />
</div>
