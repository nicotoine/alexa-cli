// The Skills tab: each skill and the devices it provides. A deleted device that comes back here comes from a skill
// that is still linked.

import { IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonCheckbox, IonChip, IonLabel, IonNote, IonSelect, IonSelectOption, IonSkeletonText } from '@ionic/react';
import { SKILL_SORTS, skillRows, skillTypes } from '../lib/listing.js';

export default function SkillsView({ app }) {
    const { view, prefs, setPrefs } = app;
    const criteria = prefs.skills;
    const set = (patch) => setPrefs('skills', patch);
    if (!view.skills) return <div className="ion-padding"><IonNote>La page Amazon des skills est lente…</IonNote><IonSkeletonText animated /></div>;
    const rows = skillRows(view, criteria);
    return (
        <>
            <IonNote className="ion-padding" style={{ display: 'block' }}>
                Skills activées et appareils fournis par chacune. Un appareil supprimé qui revient ici vient d'une skill toujours liée.
            </IonNote>
            <div className="filters">
                <IonSelect label="Trier" labelPlacement="stacked" interface="popover" value={criteria.sort} onIonChange={(e) => set({ sort: e.detail.value })}>
                    {Object.entries(SKILL_SORTS).map(([v, t]) => <IonSelectOption key={v} value={v}>{t}</IonSelectOption>)}
                </IonSelect>
                <IonSelect label="Type" labelPlacement="stacked" interface="popover" value={criteria.type} onIonChange={(e) => set({ type: e.detail.value })}>
                    <IonSelectOption value="all">Tous</IonSelectOption>
                    {skillTypes(view).map((t) => <IonSelectOption key={t} value={t}>{t}</IonSelectOption>)}
                </IonSelect>
                <IonCheckbox checked={criteria.withDevices} labelPlacement="end" onIonChange={(e) => set({ withDevices: e.detail.checked })}>Avec appareils</IonCheckbox>
                <span className="count">{rows.length} skill{rows.length > 1 ? 's' : ''}</span>
            </div>
            {rows.map((s) => (
                <IonCard key={s.id}>
                    <IonCardHeader>
                        <IonCardTitle style={{ fontSize: 17 }}>{s.name || '(sans nom)'}</IonCardTitle>
                        <IonCardSubtitle>{s.type} · {s.devices.length} appareil{s.devices.length > 1 ? 's' : ''}</IonCardSubtitle>
                    </IonCardHeader>
                    <IonCardContent>
                        <div className="chips">{s.devices.map((d) => <IonChip key={d.applianceId || d.name} outline><IonLabel>{d.name}</IonLabel></IonChip>)}</div>
                        <p className="mono muted">{s.id}</p>
                    </IonCardContent>
                </IonCard>
            ))}
        </>
    );
}
