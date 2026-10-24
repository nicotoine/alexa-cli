// Shown when no Amazon session is accepted: there is no terminal on a phone, so signing in starts here.

import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonIcon, IonSpinner, IonText } from '@ionic/react';
import { logInOutline } from 'ionicons/icons';
import { useState } from 'react';
import { explain } from '../lib/explain.js';

export default function LoginPanel({ onLogin }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const start = async () => {
        setBusy(true);
        setError(null);
        try {
            await onLogin();
        } catch (e) {
            setError(explain(e.message));
        } finally {
            setBusy(false);
        }
    };
    return (
        <IonCard style={{ maxWidth: 560, margin: '32px auto' }}>
            <IonCardHeader><IonCardTitle>Connexion à Amazon</IonCardTitle></IonCardHeader>
            <IonCardContent>
                <p>Pour lire et modifier tes routines, connecte-toi une fois à ton compte Amazon. La page de connexion est
                    celle d'Amazon, servie par l'application sur cet appareil : le mot de passe n'est jamais conservé, seuls
                    les jetons de session le sont.</p>
                <p className="muted" style={{ marginTop: 8 }}>Une fois connecté, reviens en arrière : la page se met à jour toute seule.</p>
                {error && <IonText color="danger"><p style={{ marginTop: 8 }}>{error}</p></IonText>}
                <IonButton expand="block" onClick={start} disabled={busy} style={{ marginTop: 16 }}>
                    {busy ? <IonSpinner name="dots" /> : <><IonIcon slot="start" icon={logInOutline} />Se connecter à Amazon</>}
                </IonButton>
            </IonCardContent>
        </IonCard>
    );
}
