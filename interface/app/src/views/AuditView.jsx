// The Audit tab: routines with an action on a device that no longer exists.

import { IonIcon, IonItem, IonLabel, IonList, IonNote, IonSkeletonText } from '@ionic/react';
import { checkmarkCircle, warningOutline } from 'ionicons/icons';
import { OPS } from '../lib/model.js';

export default function AuditView({ app }) {
    const { audit } = app.view;
    if (!audit) return <div className="ion-padding"><IonSkeletonText animated /></div>;
    if (!audit.length) {
        return <IonItem lines="none" className="ion-padding"><IonIcon slot="start" icon={checkmarkCircle} color="success" /><IonLabel>Aucune routine cassée.</IonLabel></IonItem>;
    }
    return (
        <>
            <IonNote className="ion-padding" style={{ display: 'block' }}>Routines dont une action vise un appareil qui n'existe plus.</IonNote>
            <IonList>
                {audit.map((r) => (
                    <IonItem key={r.automationId}>
                        <IonIcon slot="start" icon={warningOutline} color="warning" />
                        <IonLabel className="ion-text-wrap">
                            <h3>{r.name}</h3>
                            <p>{r.missing.map((t) => `${OPS[t.op] || t.op} ${t.name || `${t.target.slice(0, 12)}…`} (n'existe plus)`).join(' · ')}</p>
                        </IonLabel>
                    </IonItem>
                ))}
            </IonList>
        </>
    );
}
