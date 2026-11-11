<script lang="ts">
    // Offers a newer APK. The link is followed in the same page on purpose: in the app, a link outside the allowed
    // hosts (capacitor.config.json) opens in the phone's browser, which downloads the APK and offers to install it.
    import { Download } from '@lucide/svelte';
    import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
    import { Button } from '$lib/components/ui/button/index.js';
    import { app } from '$lib/state/app.svelte.js';
</script>

<AlertDialog.Root open={app.update !== null} onOpenChange={(o: boolean) => { if (!o) app.dismissUpdate(); }}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>Mise à jour disponible</AlertDialog.Title>
            <AlertDialog.Description>
                La version {app.update?.latest} est sortie (vous avez la {app.update?.current}). Téléchargez l'APK puis
                ouvrez-le : il s'installe par-dessus celle-ci, sans perdre la connexion Amazon.
            </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel onclick={() => app.dismissUpdate()}>Plus tard</AlertDialog.Cancel>
            <Button href={app.update?.url} rel="noopener noreferrer"><Download />Télécharger l'APK</Button>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
