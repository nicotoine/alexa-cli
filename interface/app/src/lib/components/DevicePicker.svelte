<script lang="ts">
    // Choosing a device among dozens: a button showing the current one, opening a searchable list.
    import { Check, ChevronsUpDown } from '@lucide/svelte';
    import { Button } from '$lib/components/ui/button/index.js';
    import * as Command from '$lib/components/ui/command/index.js';
    import * as Popover from '$lib/components/ui/popover/index.js';
    import { targetName } from '$lib/core/model.js';

    let { value, devices, onChange, label = 'Appareil' }: {
        value: string;
        devices: { displayName: string }[];
        onChange: (name: string) => void;
        label?: string;
    } = $props();

    let open = $state(false);
    const names = $derived([...new Set((devices || []).map((d) => d.displayName))].sort((a, b) => a.localeCompare(b, 'fr')));
    // A group target ("all the lights") or a device that no longer exists is shown by what it means, its value kept.
    const shown = $derived(value ? targetName(value, new Map()) || value : null);
</script>

<Popover.Root bind:open>
    <Popover.Trigger>
        {#snippet child({ props })}
            <Button {...props} variant="outline" class="w-full min-w-44 justify-between font-normal sm:w-auto" aria-label="{label} : {shown || 'aucun'}">
                <span class="truncate">{shown || 'Choisir…'}</span>
                <ChevronsUpDown class="opacity-50" />
            </Button>
        {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-72 p-0" align="start">
        <Command.Root>
            <Command.Input placeholder="Chercher un appareil" />
            <Command.List class="max-h-64">
                <Command.Empty>Aucun appareil ne correspond.</Command.Empty>
                <Command.Group>
                    {#each names as name (name)}
                        <Command.Item value={name} onSelect={() => { onChange(name); open = false; }}>
                            <Check class={name === value ? '' : 'invisible'} />
                            {name}
                        </Command.Item>
                    {/each}
                </Command.Group>
            </Command.List>
        </Command.Root>
    </Popover.Content>
</Popover.Root>
