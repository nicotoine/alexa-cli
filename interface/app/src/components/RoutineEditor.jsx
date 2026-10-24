// The routine editor: a spec (see src/routine-spec.js) edited as a form. What it saves is checked by the CLI's own
// checkSpec as you type, and drawn by the CLI's own fromSpec when saved — the editor cannot write anything the CLI
// would not.
//
// The actions are one ordered list, reordered by dragging: that is what Amazon keeps (it makes its own groups —
// each run of device actions runs with the next action), so the editor does not pretend to offer parallel blocks.

import {
    IonActionSheet, IonButton, IonButtons, IonChip, IonContent, IonFooter, IonHeader, IonIcon, IonInput, IonItem,
    IonLabel, IonList, IonModal, IonNote, IonReorder, IonReorderGroup, IonSegment, IonSegmentButton, IonSelect,
    IonSelectOption, IonTitle, IonToggle, IonToolbar,
} from '@ionic/react';
import {
    addOutline, bulbOutline, chatbubbleOutline, close, hourglassOutline, megaphoneOutline, playCircleOutline, trashOutline, tvOutline,
} from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { DAYS, PLAYS, checkSpec, toSpec } from '@cli/routine-spec.js';
import { explain } from '../lib/explain.js';
import { label, phraseOwner } from '../lib/model.js';
import DevicePicker from './DevicePicker.jsx';

const DAY_LABELS = { MO: 'L', TU: 'M', WE: 'M', TH: 'J', FR: 'V', SA: 'S', SU: 'D' };
const DAY_NAMES = { MO: 'lundi', TU: 'mardi', WE: 'mercredi', TH: 'jeudi', FR: 'vendredi', SA: 'samedi', SU: 'dimanche' };
const PLAY_LABELS = { weather: 'Météo', time: 'Heure', date: 'Date', calendar: 'Agenda du jour', news: 'Infos', goodmorning: 'Bonjour' };
const KINDS = {
    device: { label: 'Appareil', icon: bulbOutline, make: (v) => ({ device: (v.devices || [])[0]?.displayName || '', turn: 'on' }) },
    say: { label: 'Parler', icon: chatbubbleOutline, make: () => ({ say: '' }) },
    wait: { label: 'Attendre', icon: hourglassOutline, make: () => ({ wait: 5 }) },
    play: { label: 'Météo, heure, infos…', icon: playCircleOutline, make: () => ({ play: 'weather' }) },
    command: { label: 'Commande à Alexa', icon: megaphoneOutline, make: () => ({ command: '' }) },
    fireTv: { label: 'Éteindre une Fire TV', icon: tvOutline, make: (v) => ({ fireTv: 'off', on: ((v.echos || []).find((e) => e.deviceFamily === 'FIRE_TV') || {}).accountName || '' }) },
};
const kindOf = (step) => Object.keys(KINDS).find((k) => step[k] !== undefined) || 'raw';

let keySeq = 0;
const withKeys = (steps) => steps.map((s) => ({ ...s, _key: ++keySeq }));
const withoutKeys = (spec) => ({ ...spec, do: spec.do.map(({ _key, ...s }) => s) });

const EMPTY = () => ({ name: '', enabled: true, when: { say: [] }, do: [] });

function echoOptions(echos, { fireTv = false } = {}) {
    return (echos || [])
        .filter((e) => (fireTv ? e.deviceFamily === 'FIRE_TV' : e.deviceFamily !== 'FIRE_TV'))
        .map((e) => ({ value: e.accountName || e.serialNumber, text: e.accountName || `Appli Alexa (${e.serialNumber.slice(0, 6)}…)` }));
}

function EchoSelect({ value, onChange, echos, scheduled, fireTv }) {
    return (
        <IonSelect label="Sur" labelPlacement="stacked" interface="popover" value={value || ''} onIonChange={(e) => onChange(e.detail.value || undefined)}>
            {!scheduled && !fireTv && <IonSelectOption value="">L'Echo qui a entendu</IonSelectOption>}
            {echoOptions(echos, { fireTv }).map((o) => <IonSelectOption key={o.value} value={o.value}>{o.text}</IonSelectOption>)}
        </IonSelect>
    );
}

function StepRow({ step, onChange, onRemove, view, scheduled }) {
    const kind = kindOf(step);
    const meta = KINDS[kind];
    const set = (patch) => onChange({ ...step, ...patch });
    let fields;
    switch (kind) {
    case 'device':
        fields = (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <DevicePicker value={step.device} devices={view.devices} onChange={(device) => set({ device })} />
                <IonSegment className="turn" value={step.turn} onIonChange={(e) => set({ turn: e.detail.value })} style={{ width: 'auto' }}>
                    <IonSegmentButton value="on"><IonLabel>Allumer</IonLabel></IonSegmentButton>
                    <IonSegmentButton value="off"><IonLabel>Éteindre</IonLabel></IonSegmentButton>
                </IonSegment>
            </div>
        );
        break;
    case 'say':
    case 'command':
        fields = (
            <>
                <IonInput label={kind === 'say' ? 'Alexa dit' : 'Comme si on disait'} labelPlacement="stacked" value={step[kind]}
                    placeholder={kind === 'say' ? 'Bonne nuit !' : 'mets de la musique douce'} onIonInput={(e) => set({ [kind]: e.detail.value || '' })} />
                <EchoSelect value={step.on} echos={view.echos} scheduled={scheduled} onChange={(on) => set({ on })} />
            </>
        );
        break;
    case 'wait':
        fields = <IonInput label="Secondes" labelPlacement="stacked" type="number" min="1" max="3600" value={step.wait}
            onIonInput={(e) => set({ wait: Number(e.detail.value) || 0 })} />;
        break;
    case 'play':
        fields = (
            <>
                <IonSelect label="Annonce" labelPlacement="stacked" interface="popover" value={step.play} onIonChange={(e) => set({ play: e.detail.value })}>
                    {Object.keys(PLAYS).map((p) => <IonSelectOption key={p} value={p}>{PLAY_LABELS[p] || p}</IonSelectOption>)}
                </IonSelect>
                <EchoSelect value={step.on} echos={view.echos} scheduled={scheduled} onChange={(on) => set({ on })} />
            </>
        );
        break;
    case 'fireTv':
        fields = <EchoSelect value={step.on} echos={view.echos} fireTv onChange={(on) => set({ on })} />;
        break;
    default:
        fields = <IonNote>Action « {step.raw.type} » conservée telle quelle.</IonNote>;
    }
    return (
        <IonItem>
            <IonIcon slot="start" icon={(meta || {}).icon || playCircleOutline} color="primary" aria-hidden="true" />
            <div style={{ flex: 1, padding: '8px 0' }}>
                <div className="small muted" style={{ marginBottom: 4 }}>{(meta || { label: 'Autre' }).label}</div>
                {fields}
            </div>
            <IonButton slot="end" fill="clear" color="danger" onClick={onRemove} aria-label="Retirer l'action"><IonIcon slot="icon-only" icon={trashOutline} /></IonButton>
            <IonReorder slot="end" />
        </IonItem>
    );
}

export default function RoutineEditor({ open, routine, view, onClose, onSave }) {
    const [spec, setSpec] = useState(EMPTY);
    const [phrase, setPhrase] = useState('');
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        if (!open) return;
        const start = routine ? toSpec(routine, { devices: [...(view.devices || []), ...(view.appliances || [])], echos: view.echos || [] }) : EMPTY();
        setSpec({ ...start, do: withKeys(start.do) });
        setPhrase('');
    }, [open, routine]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only when the editor opens

    const scheduled = spec.when.at !== undefined;
    const phrases = [].concat(spec.when.say || []);

    // Checked as you type, by the CLI's own rules, plus phrases another routine already answers to.
    const error = useMemo(() => {
        try {
            checkSpec(withoutKeys(spec));
        } catch (e) {
            return explain(e.message);
        }
        for (const p of phrases) {
            const owner = phraseOwner(view.routines, p, routine && routine.automationId);
            if (owner) return `« ${p} » déclenche déjà « ${label(owner)} ».`;
        }
        return null;
    }, [spec, view.routines, routine]); // eslint-disable-line react-hooks/exhaustive-deps

    const setWhen = (when) => setSpec((s) => ({ ...s, when }));
    const setStep = (i, step) => setSpec((s) => ({ ...s, do: s.do.map((x, j) => (j === i ? step : x)) }));
    // Enter reads the field itself: the keydown can arrive before React has applied the last keystroke.
    const addPhrase = (typed = phrase) => {
        const p = String(typed || '').trim();
        if (p && !phrases.includes(p)) setWhen({ say: [...phrases, p] });
        setPhrase('');
    };

    return (
        <IonModal className="editor" isOpen={open} onDidDismiss={onClose}>
            <IonHeader>
                <IonToolbar>
                    <IonButtons slot="start"><IonButton onClick={onClose} aria-label="Fermer"><IonIcon slot="icon-only" icon={close} /></IonButton></IonButtons>
                    <IonTitle>{routine ? 'Modifier la routine' : 'Nouvelle routine'}</IonTitle>
                </IonToolbar>
            </IonHeader>
            <IonContent>
                <IonList>
                    <IonItem>
                        <IonInput label="Nom" labelPlacement="stacked" value={spec.name || ''} placeholder={phrases[0] || 'nom de la routine'}
                            onIonInput={(e) => setSpec((s) => ({ ...s, name: e.detail.value || null }))} />
                    </IonItem>
                    <IonItem>
                        <IonToggle checked={spec.enabled !== false} onIonChange={(e) => setSpec((s) => ({ ...s, enabled: e.detail.checked }))}>Active</IonToggle>
                    </IonItem>
                </IonList>

                <div className="editor-section">Quand</div>
                <IonSegment value={scheduled ? 'at' : 'say'} style={{ margin: '0 12px', width: 'calc(100% - 24px)' }}
                    onIonChange={(e) => setWhen(e.detail.value === 'at' ? { at: '07:00' } : { say: [] })}>
                    <IonSegmentButton value="say"><IonLabel>Phrase</IonLabel></IonSegmentButton>
                    <IonSegmentButton value="at"><IonLabel>Horaire</IonLabel></IonSegmentButton>
                </IonSegment>
                {scheduled ? (
                    <IonList>
                        <IonItem>
                            <IonInput label="Heure" labelPlacement="stacked" type="time" value={spec.when.at} onIonInput={(e) => setWhen({ ...spec.when, at: e.detail.value })} />
                        </IonItem>
                        <div className="days" role="group" aria-label="Jours">
                            {DAYS.map((d) => {
                                const on = (spec.when.days || []).includes(d);
                                return (
                                    <IonChip key={d} color={on ? 'primary' : 'medium'} outline={!on} aria-pressed={on} title={DAY_NAMES[d]}
                                        onClick={() => {
                                            const days = on ? (spec.when.days || []).filter((x) => x !== d) : [...(spec.when.days || []), d];
                                            setWhen({ ...spec.when, days: DAYS.filter((x) => days.includes(x)) });
                                        }}>
                                        <IonLabel>{DAY_LABELS[d]}</IonLabel>
                                    </IonChip>
                                );
                            })}
                        </div>
                        <IonNote className="ion-padding-horizontal small">{(spec.when.days || []).length ? '' : 'Aucun jour choisi : tous les jours.'}</IonNote>
                    </IonList>
                ) : (
                    <div style={{ padding: '8px 12px' }}>
                        <div className="chips">
                            {phrases.map((p) => (
                                <IonChip key={p} outline><IonLabel>{p}</IonLabel>
                                    <IonIcon icon={close} role="button" aria-label={`Retirer ${p}`} onClick={() => setWhen({ say: phrases.filter((x) => x !== p) })} />
                                </IonChip>
                            ))}
                        </div>
                        <IonItem lines="none">
                            <IonInput label="Ajouter une phrase" labelPlacement="stacked" value={phrase} placeholder="Alexa, …"
                                onIonInput={(e) => setPhrase(e.detail.value || '')} onKeyDown={(e) => { if (e.key === 'Enter') addPhrase(e.currentTarget.value); }} />
                            <IonButton slot="end" fill="clear" onClick={() => addPhrase()} aria-label="Ajouter la phrase"><IonIcon slot="icon-only" icon={addOutline} /></IonButton>
                        </IonItem>
                    </div>
                )}

                <div className="editor-section">Alexa fait, dans l'ordre</div>
                <IonList>
                    <IonReorderGroup disabled={false} onIonItemReorder={(e) => {
                        setSpec((s) => ({ ...s, do: e.detail.complete([...s.do]) }));
                    }}>
                        {spec.do.map((step, i) => (
                            <StepRow key={step._key} step={step} view={view} scheduled={scheduled}
                                onChange={(next) => setStep(i, next)}
                                onRemove={() => setSpec((s) => ({ ...s, do: s.do.filter((_, j) => j !== i) }))} />
                        ))}
                    </IonReorderGroup>
                </IonList>
                <IonButton expand="block" fill="outline" className="ion-margin" onClick={() => setAdding(true)}>
                    <IonIcon slot="start" icon={addOutline} />Ajouter une action
                </IonButton>
                <IonNote className="ion-padding-horizontal small" style={{ display: 'block' }}>
                    Amazon exécute les actions dans l'ordre ; plusieurs actions sur des appareils à la suite se font en même temps que l'action qui les suit.
                </IonNote>
                <IonActionSheet isOpen={adding} onDidDismiss={() => setAdding(false)} header="Ajouter une action"
                    buttons={[...Object.entries(KINDS).map(([kind, meta]) => ({
                        text: meta.label, icon: meta.icon,
                        handler: () => setSpec((s) => ({ ...s, do: [...s.do, { ...meta.make(view), _key: ++keySeq }] })),
                    })), { text: 'Annuler', role: 'cancel' }]} />
            </IonContent>
            <IonFooter>
                {error && <p className="spec-error" role="alert">{error}</p>}
                <IonToolbar>
                    <IonButtons slot="end">
                        <IonButton onClick={onClose}>Annuler</IonButton>
                        <IonButton strong disabled={Boolean(error)} onClick={() => onSave(withoutKeys(spec), routine)}>Enregistrer</IonButton>
                    </IonButtons>
                </IonToolbar>
            </IonFooter>
        </IonModal>
    );
}
