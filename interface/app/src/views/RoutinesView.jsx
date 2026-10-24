// The Routines tab: search, sort and filters, then one card per routine.

import {
    IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonCheckbox, IonChip, IonIcon,
    IonBadge, IonInput, IonLabel, IonSearchbar, IonSelect, IonSelectOption, IonSkeletonText, IonToggle, useIonAlert,
} from '@ionic/react';
import { addCircleOutline, close, createOutline, funnelOutline, playOutline, trashOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useWide } from '../hooks/useWide.js';
import { ROUTINE_DEFAULTS, ROUTINE_SORTS, routineDevices, routineRows } from '../lib/listing.js';
import { OPS, deviceNames, isVoice, label, phraseOwner, targetName } from '../lib/model.js';

const PLAY_WORDS = { 'Alexa.Weather.Play': 'météo', 'Alexa.Time.Play': 'heure', 'Alexa.Date.Play': 'date',
    'Alexa.Calendar.PlayToday': 'agenda', 'Alexa.News.NationalNews': 'infos', 'Alexa.GoodMorning.Play': 'bonjour' };

function ActionText({ action, names }) {
    if (action.speak) return <span>dire « <b>{action.speak}</b> »</span>;
    if (action.wait !== undefined) return <span>attendre {action.wait} s</span>;
    if (action.command !== undefined) return <span>« <b>{action.command}</b> » à Alexa</span>;
    if (action.type) return <span>{PLAY_WORDS[action.type] || action.type.replace(/^Alexa\./, '')}</span>;
    const verb = action.op.split(',').map((o) => OPS[o] || o).join(', ');
    return <span>{verb} <b>{targetName(action.target, names) || `${action.target.slice(0, 10)}… (introuvable)`}</b></span>;
}

function AddPhrase({ routine, view, actions, onTaken }) {
    const [value, setValue] = useState('');
    // Enter reads the field itself: the keydown can arrive before React has applied the last keystroke.
    const add = (typed = value) => {
        const phrase = String(typed || '').trim();
        if (!phrase) return;
        const owner = phraseOwner(view.routines, phrase, routine.automationId);
        if (owner) return onTaken(phrase, owner);
        actions.editPhrases(routine, { add: [phrase] });
        setValue('');
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 220, flex: 1 }}>
            <IonInput value={value} placeholder="ajouter une phrase…" aria-label={`Ajouter une phrase à ${label(routine)}`}
                onIonInput={(e) => setValue(e.detail.value || '')} onKeyDown={(e) => { if (e.key === 'Enter') add(e.currentTarget.value); }} />
            <IonButton fill="clear" size="small" onClick={() => add()} aria-label="Ajouter la phrase"><IonIcon icon={addCircleOutline} /></IonButton>
        </div>
    );
}

function RoutineCard({ row, app, names, onEdit }) {
    const { r, phrases, acts } = row;
    const { actions, store, view } = app;
    const [presentAlert] = useIonAlert();
    const draft = Boolean(r.draft);
    const pending = draft || store.isPending(r.automationId);
    const taken = (phrase, owner) => presentAlert({ header: 'Phrase déjà utilisée', message: `« ${phrase} » déclenche déjà « ${label(owner)} ».`, buttons: ['OK'] });

    return (
        <IonCard className={`routine-card${pending ? ' pending' : ''}`}>
            <IonCardHeader>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IonCardTitle style={{ flex: 1 }}>{label(r)}</IonCardTitle>
                    <IonToggle checked={r.status === 'ENABLED'} disabled={draft}
                        aria-label={r.status === 'ENABLED' ? 'Désactiver' : 'Activer'}
                        onIonChange={(e) => actions.setStatus(r, e.detail.checked ? 'ENABLED' : 'DISABLED')} />
                </div>
                {pending && <IonCardSubtitle color="primary">enregistrement…</IonCardSubtitle>}
                {!isVoice(r) && <IonCardSubtitle>{(r.triggers || [])[0]?.type === 'AbsoluteTimeSchedule' ? 'programmée' : 'autre déclencheur'}</IonCardSubtitle>}
            </IonCardHeader>
            <IonCardContent>
                {isVoice(r) && (
                    <div className="chips">
                        {phrases.map((p) => (
                            <IonChip key={p} outline>
                                <IonLabel>{p}</IonLabel>
                                {phrases.length > 1 && !draft && (
                                    <IonIcon icon={close} role="button" aria-label={`Retirer ${p}`} onClick={() => actions.editPhrases(r, { remove: [p] })} />
                                )}
                            </IonChip>
                        ))}
                        {!draft && <AddPhrase routine={r} view={view} actions={actions} onTaken={taken} />}
                    </div>
                )}
                {acts.length > 0 && (
                    <div className="actions-line">
                        {acts.map((a, i) => <span key={i}>{i ? ' · ' : ''}<ActionText action={a} names={names} /></span>)}
                    </div>
                )}
                {!draft && (
                    <div className="card-buttons">
                        <IonButton fill="clear" size="small" onClick={() => onEdit(r)}><IonIcon slot="start" icon={createOutline} />Modifier</IonButton>
                        <IonButton fill="clear" size="small" onClick={() => presentAlert({
                            header: `Lancer « ${label(r)} » ?`, message: 'La routine s\'exécute maintenant, comme si on l\'avait dite à l\'Echo.',
                            buttons: [{ text: 'Annuler', role: 'cancel' }, { text: 'Lancer', handler: () => actions.run(r) }],
                        })}><IonIcon slot="start" icon={playOutline} />Lancer</IonButton>
                        <IonButton fill="clear" size="small" color="danger" onClick={() => actions.deleteRoutine(r)}>
                            <IonIcon slot="start" icon={trashOutline} />Supprimer
                        </IonButton>
                    </div>
                )}
            </IonCardContent>
        </IonCard>
    );
}

export default function RoutinesView({ app, onEdit }) {
    const { view, prefs, setPrefs } = app;
    const criteria = prefs.routines;
    const set = (patch) => setPrefs('routines', patch);
    // On a phone the filters fold behind a button, so the routines start on the first screen.
    const wide = useWide();
    const [showFilters, setShowFilters] = useState(false);
    const active = ['status', 'trigger', 'device', 'broken'].filter((k) => criteria[k] !== ROUTINE_DEFAULTS[k]).length;
    if (!view.routines) {
        return [0, 1, 2].map((i) => (
            <IonCard key={i}><IonCardContent><IonSkeletonText animated style={{ width: '40%' }} /><IonSkeletonText animated style={{ width: '80%' }} /></IonCardContent></IonCard>
        ));
    }
    const names = deviceNames(view);
    const rows = routineRows(view, criteria);
    return (
        <>
            <IonSearchbar value={criteria.text} placeholder="Filtrer par nom, phrase ou appareil" debounce={150}
                onIonInput={(e) => set({ text: e.detail.value || '' })} />
            {!wide && (
                <div className="filters">
                    <IonButton fill="outline" size="small" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
                        <IonIcon slot="start" icon={funnelOutline} />Trier et filtrer
                        {active > 0 && <IonBadge style={{ marginLeft: 6 }}>{active}</IonBadge>}
                    </IonButton>
                    <span className="count" aria-live="polite">{rows.length === view.routines.length ? `${rows.length} routines` : `${rows.length} sur ${view.routines.length}`}</span>
                </div>
            )}
            {(wide || showFilters) && <div className="filters">
                <IonSelect label="Trier" labelPlacement="stacked" interface="popover" value={criteria.sort} onIonChange={(e) => set({ sort: e.detail.value })}>
                    {Object.entries(ROUTINE_SORTS).map(([v, t]) => <IonSelectOption key={v} value={v}>{t}</IonSelectOption>)}
                </IonSelect>
                <IonSelect label="Statut" labelPlacement="stacked" interface="popover" value={criteria.status} onIonChange={(e) => set({ status: e.detail.value })}>
                    <IonSelectOption value="all">Toutes</IonSelectOption>
                    <IonSelectOption value="ENABLED">Actives</IonSelectOption>
                    <IonSelectOption value="DISABLED">Désactivées</IonSelectOption>
                </IonSelect>
                <IonSelect label="Déclencheur" labelPlacement="stacked" interface="popover" value={criteria.trigger} onIonChange={(e) => set({ trigger: e.detail.value })}>
                    <IonSelectOption value="all">Tous</IonSelectOption>
                    <IonSelectOption value="voice">Phrase</IonSelectOption>
                    <IonSelectOption value="other">Autre</IonSelectOption>
                </IonSelect>
                <IonSelect label="Appareil" labelPlacement="stacked" interface="popover" value={criteria.device} onIonChange={(e) => set({ device: e.detail.value })}>
                    <IonSelectOption value="">Tous</IonSelectOption>
                    {routineDevices(view).map((d) => <IonSelectOption key={d} value={d}>{d}</IonSelectOption>)}
                </IonSelect>
                <IonCheckbox checked={criteria.broken} labelPlacement="end" onIonChange={(e) => set({ broken: e.detail.checked })}>Cassées</IonCheckbox>
                {wide && <span className="count" aria-live="polite">{rows.length === view.routines.length ? `${rows.length} routines` : `${rows.length} sur ${view.routines.length}`}</span>}
            </div>}
            {rows.length === 0
                ? <p className="ion-padding muted">Aucune routine ne correspond aux filtres.</p>
                : rows.map((row) => <RoutineCard key={row.r.automationId} row={row} app={app} names={names} onEdit={onEdit} />)}
        </>
    );
}
