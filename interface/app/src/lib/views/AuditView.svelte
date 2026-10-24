<script lang="ts">
    // The Audit tab: routines with an action on a device that no longer exists.
    import { CircleCheck, TriangleAlert } from '@lucide/svelte';
    import { Skeleton } from '$lib/components/ui/skeleton/index.js';
    import { OPS } from '$lib/core/model.js';
    import { app } from '$lib/state/app.svelte.js';

    const audit = $derived(app.view.audit);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const missing = (r: any) => r.missing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((t: any) => `${(OPS as Record<string, string>)[t.op] || t.op} ${t.name || `${t.target.slice(0, 12)}…`} (n'existe plus)`).join(' · ');
</script>

{#if !audit}
    <Skeleton class="h-16 w-full" />
{:else if !audit.length}
    <p class="flex items-center gap-2 py-4"><CircleCheck class="size-5 text-success" />Aucune routine cassée.</p>
{:else}
    <p class="mb-3 text-sm text-muted-foreground">Routines dont une action vise un appareil qui n'existe plus.</p>
    <ul class="divide-y rounded-lg border">
        {#each audit as r (r.automationId)}
            <li class="flex items-start gap-3 px-3 py-3">
                <TriangleAlert class="mt-0.5 size-5 shrink-0 text-warning" />
                <div class="min-w-0">
                    <p class="font-medium">{r.name}</p>
                    <p class="text-sm text-muted-foreground">{missing(r)}</p>
                </div>
            </li>
        {/each}
    </ul>
{/if}
