<script lang="ts">
    // Offers a newer APK. In the app, it downloads it (checked against the release's checksums) and opens Android's
    // installer, which still asks to confirm. Elsewhere, or as a fallback, the link opens the APK in the browser: in
    // the app, a link outside the allowed hosts (capacitor.config.json) opens in the phone's browser.
    import { Download, LoaderCircle } from '@lucide/svelte';
    import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
    import { Button } from '$lib/components/ui/button/index.js';
    import { app } from '$lib/state/app.svelte.js';

    const p = $derived(app.installing);
    const busy = $derived(p?.state === 'downloading' || p?.state === 'verifying');
    const mb = (n: number | null | undefined) => (n ? `${(n / 1048576).toFixed(0)} Mo` : '');
    const percent = $derived(p?.total && p.received ? Math.min(100, Math.round((p.received / p.total) * 100)) : null);

    const status = $derived(
        !p ? null
            : p.state === 'downloading' ? `Téléchargement… ${percent !== null ? `${percent} %` : ''} ${p.total ? `(${mb(p.received)} sur ${mb(p.total)})` : ''}`
            : p.state === 'verifying' ? 'Vérification de l\'APK…'
            : p.state === 'started' ? 'Confirmez l\'installation dans la fenêtre d\'Android.'
            : p.state === 'needs-permission' ? 'Autorisez « Alexa CLI » à installer des applications dans le réglage qui vient de s\'ouvrir, revenez ici puis appuyez de nouveau sur Installer.'
            : p.state === 'error' ? `Échec : ${p.error}`
            : null,
    );
</script>

<AlertDialog.Root open={app.update !== null} onOpenChange={(o: boolean) => { if (!o) app.dismissUpdate(); }}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>Mise à jour disponible</AlertDialog.Title>
            <AlertDialog.Description>
                La version {app.update?.latest} est sortie (vous avez la {app.update?.current}). Elle s'installe par-dessus
                celle-ci, sans perdre la connexion Amazon.
            </AlertDialog.Description>
        </AlertDialog.Header>

        {#if app.update?.selfInstall && p}
            <div class="space-y-2" aria-live="polite">
                {#if busy}
                    <div class="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent ?? undefined}>
                        <div class="h-full bg-primary transition-[width] {percent === null ? 'w-1/3 animate-pulse' : ''}" style={percent !== null ? `width: ${percent}%` : ''}></div>
                    </div>
                {/if}
                {#if status}<p class="text-sm {p.state === 'error' ? 'text-destructive' : 'text-muted-foreground'}">{status}</p>{/if}
            </div>
        {/if}

        <AlertDialog.Footer>
            <AlertDialog.Cancel disabled={busy} onclick={() => app.dismissUpdate()}>Plus tard</AlertDialog.Cancel>
            {#if app.update?.selfInstall}
                {#if p?.state === 'error'}
                    <Button variant="outline" href={app.update?.url} rel="noopener noreferrer">Par le navigateur</Button>
                {/if}
                <Button disabled={busy} onclick={() => app.installUpdate()}>
                    {#if busy}<LoaderCircle class="animate-spin" />{:else}<Download />{/if}
                    {p?.state === 'needs-permission' || p?.state === 'started' || p?.state === 'error' ? 'Installer' : 'Télécharger et installer'}
                </Button>
            {:else}
                <Button href={app.update?.url} rel="noopener noreferrer"><Download />Télécharger l'APK</Button>
            {/if}
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
