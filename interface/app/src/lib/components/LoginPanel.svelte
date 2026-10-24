<script lang="ts">
    // Shown when no Amazon session is accepted: there is no terminal on a phone, so signing in starts here.
    import { LoaderCircle, LogIn } from '@lucide/svelte';
    import { Button } from '$lib/components/ui/button/index.js';
    import * as Card from '$lib/components/ui/card/index.js';
    import { explain } from '$lib/core/explain.js';
    import { app } from '$lib/state/app.svelte.js';

    let busy = $state(false);
    let error = $state<string | null>(null);

    async function start() {
        busy = true;
        error = null;
        try {
            await app.startLogin();
        } catch (e) {
            error = explain((e as Error).message);
        } finally {
            busy = false;
        }
    }
</script>

<Card.Root class="mx-auto my-8 max-w-xl">
    <Card.Header><Card.Title>Connexion à Amazon</Card.Title></Card.Header>
    <Card.Content class="space-y-3 text-sm">
        <p>Pour lire et modifier tes routines, connecte-toi une fois à ton compte Amazon. La page de connexion est
            celle d'Amazon, servie par l'application sur cet appareil : le mot de passe n'est jamais conservé, seuls
            les jetons de session le sont.</p>
        <p class="text-muted-foreground">Une fois connecté, reviens en arrière : la page se met à jour toute seule.</p>
        {#if error}<p class="text-destructive" role="alert">{error}</p>{/if}
    </Card.Content>
    <Card.Footer>
        <Button class="w-full" size="lg" onclick={start} disabled={busy}>
            {#if busy}<LoaderCircle class="animate-spin" />{:else}<LogIn />{/if}
            Se connecter à Amazon
        </Button>
    </Card.Footer>
</Card.Root>
