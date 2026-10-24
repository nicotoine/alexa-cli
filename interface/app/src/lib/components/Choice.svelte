<script lang="ts">
    // A labelled select over a few fixed options: the shape every sort and filter control takes.
    import { Label } from '$lib/components/ui/label/index.js';
    import * as Select from '$lib/components/ui/select/index.js';

    let { label, value, options, onChange, class: className = '' }: {
        label: string;
        value: string;
        options: [string, string][];
        onChange: (value: string) => void;
        class?: string;
    } = $props();

    const id = `choice-${Math.random().toString(36).slice(2, 8)}`;
    const shown = $derived(options.find(([v]) => v === value)?.[1] ?? '');
</script>

<div class="grid min-w-36 gap-1 {className}">
    <Label for={id} class="text-xs text-muted-foreground">{label}</Label>
    <Select.Root type="single" {value} onValueChange={onChange}>
        <Select.Trigger {id} class="w-full">{shown}</Select.Trigger>
        <Select.Content class="max-h-72">
            {#each options as [v, text] (v)}
                <Select.Item value={v} label={text}>{text}</Select.Item>
            {/each}
        </Select.Content>
    </Select.Root>
</div>
