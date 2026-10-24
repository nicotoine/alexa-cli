// The activity queue on screen: a compact bar at the bottom (a loader while something runs, the latest outcome
// after), opening a bottom sheet with every item — undo, retry, force — and the server's journal of applied changes.
// On a phone the bar is one line; the sheet is opened on purpose and never covers the page on its own.

import {
    IonBadge, IonButton, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonModal, IonNote, IonSegment,
    IonSegmentButton, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/react';
import { alertCircle, checkmarkCircle, closeCircle, hourglassOutline, trashOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { journal } from '../lib/api.js';

const ICONS = { done: [checkmarkCircle, 'success'], failed: [alertCircle, 'danger'], cancelled: [closeCircle, 'medium'], waiting: [hourglassOutline, 'warning'] };

// The time, re-read on every render and ticking while a countdown shows: a value kept from the first render read
// "27 s" for a 5 s undo window until the first tick.
function useNow(active) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!active) return undefined;
        const t = setInterval(() => setTick((n) => n + 1), 250);
        return () => clearInterval(t);
    }, [active]);
    return Date.now();
}

const time = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function ItemRow({ item, now }) {
    const [icon, color] = ICONS[item.state] || [null, 'primary'];
    const left = item.deadline ? Math.max(0, Math.ceil((item.deadline - now) / 1000)) : null;
    return (
        <IonItem lines="full">
            {item.state === 'running'
                ? <IonSpinner slot="start" name="crescent" style={{ width: 22, height: 22 }} />
                : <IonIcon slot="start" icon={icon} color={color} />}
            <IonLabel className="ion-text-wrap">
                <h3>{item.label}</h3>
                <p>
                    {item.state === 'waiting' && <span className="countdown">Envoi dans {left} s</span>}
                    {item.state === 'running' && 'En cours…'}
                    {item.detail && item.state !== 'waiting' && item.detail}
                </p>
                <p className="small muted">{time(item.startedAt)}{item.endedAt ? ` → ${time(item.endedAt)}` : ''}</p>
            </IonLabel>
            {item.undo && <IonButton slot="end" fill="outline" onClick={item.undo}>Annuler</IonButton>}
            {item.retry && <IonButton slot="end" fill="outline" onClick={item.retry}>Réessayer</IonButton>}
            {item.action && <IonButton slot="end" color="danger" onClick={item.action.run}>{item.action.label}</IonButton>}
        </IonItem>
    );
}

function JournalList() {
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => { journal().then(setEntries, (e) => setError(e.message)); }, []);
    if (error) return <p className="ion-padding muted">Journal indisponible : {error}</p>;
    if (!entries) return <div className="ion-padding"><IonSpinner name="dots" /></div>;
    if (!entries.length) return <p className="ion-padding muted">Aucune modification enregistrée pour l'instant.</p>;
    return (
        <IonList>
            {entries.map((e, i) => (
                <IonItem key={i} lines="full">
                    <IonIcon slot="start" icon={e.ok ? checkmarkCircle : alertCircle} color={e.ok ? 'success' : 'danger'} />
                    <IonLabel className="ion-text-wrap">
                        <h3>{e.command}{e.target ? ` · ${e.target.replace(/^amzn1\.alexa\.automation\./, '')}` : ''}</h3>
                        <p>{e.ok ? (e.message || e.plan) : e.error}</p>
                        <p className="small muted">{new Date(e.at).toLocaleString('fr-FR')}</p>
                    </IonLabel>
                </IonItem>
            ))}
        </IonList>
    );
}

export default function ActivityToast({ activity, build }) {
    const [open, setOpen] = useState(false);
    const [pane, setPane] = useState('queue');
    const items = activity.items;
    const summary = activity.summary();
    const now = useNow(summary.waiting > 0);
    if (!items.length) return null;

    const waiting = items.find((i) => i.state === 'waiting');
    let text;
    if (summary.busy) {
        text = waiting && summary.running === 0
            ? `${waiting.label} · ${Math.max(0, Math.ceil((waiting.deadline - now) / 1000))} s`
            : `${summary.running + summary.waiting} action${summary.running + summary.waiting > 1 ? 's' : ''} en cours`;
    } else if (summary.last) {
        text = `${summary.last.label} · ${summary.last.detail || summary.last.state}`;
    }

    return (
        <>
            <div
                className={`activity-bar${summary.failed ? ' failed' : ''}`}
                role="status"
                aria-live="polite"
                tabIndex={0}
                onClick={() => setOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(true); }}
            >
                {summary.busy ? <IonSpinner name="crescent" /> : <IonIcon icon={(ICONS[summary.last && summary.last.state] || [checkmarkCircle])[0]} />}
                <span className="text">{text}</span>
                {summary.failed > 0 && <IonBadge color="danger">{summary.failed}</IonBadge>}
                {waiting && (
                    <IonButton size="small" fill="solid" color="primary" onClick={(e) => { e.stopPropagation(); waiting.undo(); }}>Annuler</IonButton>
                )}
            </div>
            <IonModal isOpen={open} onDidDismiss={() => setOpen(false)} initialBreakpoint={0.6} breakpoints={[0, 0.6, 0.95]}>
                <IonHeader>
                    <IonToolbar>
                        <IonTitle>Activité</IonTitle>
                        <IonButton slot="end" fill="clear" onClick={() => activity.clearFinished()} title="Effacer les actions terminées">
                            <IonIcon slot="icon-only" icon={trashOutline} />
                        </IonButton>
                    </IonToolbar>
                    <IonToolbar>
                        <IonSegment value={pane} onIonChange={(e) => setPane(e.detail.value)}>
                            <IonSegmentButton value="queue"><IonLabel>File ({items.length})</IonLabel></IonSegmentButton>
                            <IonSegmentButton value="journal"><IonLabel>Journal</IonLabel></IonSegmentButton>
                        </IonSegment>
                    </IonToolbar>
                </IonHeader>
                <IonContent>
                    {pane === 'queue'
                        ? <IonList>{[...items].reverse().map((item) => <ItemRow key={item.id} item={item} now={now} />)}</IonList>
                        : <JournalList />}
                    <IonNote className="ion-padding" style={{ display: 'block' }}>
                        Les suppressions attendent 5 s avant d'être envoyées : « Annuler » les arrête.
                        {build && <><br />alexa-cli {build.label}</>}
                    </IonNote>
                </IonContent>
            </IonModal>
        </>
    );
}
