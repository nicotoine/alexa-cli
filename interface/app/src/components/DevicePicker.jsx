// Choosing a device among dozens: a button showing the current one, opening a searchable list. A plain select's
// popover could not be scrolled through fifty devices.

import { IonButton, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonModal, IonSearchbar, IonTitle, IonToolbar } from '@ionic/react';
import { checkmark, chevronDown, close } from 'ionicons/icons';
import { useMemo, useState } from 'react';

export default function DevicePicker({ value, devices, onChange, label = 'Appareil' }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const names = useMemo(() => [...new Set((devices || []).map((d) => d.displayName))].sort((a, b) => a.localeCompare(b, 'fr')), [devices]);
    const shown = names.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase()));
    const pick = (name) => {
        onChange(name);
        setOpen(false);
        setQuery('');
    };
    return (
        <>
            <IonButton fill="outline" onClick={() => setOpen(true)} style={{ textTransform: 'none', minWidth: 180 }} aria-label={`${label} : ${value || 'aucun'}`}>
                <span style={{ flex: 1, textAlign: 'left' }}>{value || 'Choisir…'}</span>
                <IonIcon slot="end" icon={chevronDown} />
            </IonButton>
            <IonModal isOpen={open} onDidDismiss={() => setOpen(false)} initialBreakpoint={0.85} breakpoints={[0, 0.85, 1]}>
                <IonHeader>
                    <IonToolbar>
                        <IonTitle>{label}</IonTitle>
                        <IonButton slot="end" fill="clear" onClick={() => setOpen(false)} aria-label="Fermer"><IonIcon slot="icon-only" icon={close} /></IonButton>
                    </IonToolbar>
                    <IonToolbar>
                        <IonSearchbar value={query} placeholder="Chercher un appareil" onIonInput={(e) => setQuery(e.detail.value || '')} autoFocus />
                    </IonToolbar>
                </IonHeader>
                <IonContent>
                    <IonList>
                        {shown.map((name) => (
                            <IonItem key={name} button detail={false} onClick={() => pick(name)}>
                                <IonLabel>{name}</IonLabel>
                                {name === value && <IonIcon slot="end" icon={checkmark} color="primary" />}
                            </IonItem>
                        ))}
                        {!shown.length && <IonItem lines="none"><IonLabel className="muted">Aucun appareil ne correspond.</IonLabel></IonItem>}
                    </IonList>
                </IonContent>
            </IonModal>
        </>
    );
}
