// The app shell: header with the sync state, the four tabs, the activity toast, the routine editor.

import {
    IonApp, IonButton, IonButtons, IonChip, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonLabel, IonPage,
    IonSegment, IonSegmentButton, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/react';
import { add, cloudDoneOutline, cloudOfflineOutline, refresh, timeOutline } from 'ionicons/icons';
import { useState } from 'react';
import ActivityToast from './components/ActivityToast.jsx';
import LoginPanel from './components/LoginPanel.jsx';
import RoutineEditor from './components/RoutineEditor.jsx';
import { useApp } from './state/useApp.js';
import AuditView from './views/AuditView.jsx';
import DevicesView from './views/DevicesView.jsx';
import RoutinesView from './views/RoutinesView.jsx';
import SkillsView from './views/SkillsView.jsx';

const TABS = [['routines', 'Routines'], ['devices', 'Appareils'], ['skills', 'Skills'], ['audit', 'Audit']];

function SyncChip({ sync }) {
    const busy = sync.state === 'loading' || sync.state === 'saving';
    const icon = sync.state === 'error' ? cloudOfflineOutline : sync.state === 'cached' ? timeOutline : cloudDoneOutline;
    const color = sync.state === 'error' ? 'danger' : sync.state === 'cached' ? 'warning' : busy ? 'primary' : 'success';
    return (
        <IonChip outline color={color} aria-live="polite" style={{ maxWidth: '46vw' }}>
            {busy ? <IonSpinner name="dots" style={{ width: 16, height: 16, marginRight: 6 }} /> : <IonIcon icon={icon} />}
            <IonLabel style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sync.text}</IonLabel>
        </IonChip>
    );
}

export default function App() {
    const app = useApp();
    const [tab, setTab] = useState('routines');
    const [editing, setEditing] = useState(null); // null: closed; { routine } to edit, { routine: null } to create

    return (
        <IonApp>
            <IonPage>
                <IonHeader>
                    <IonToolbar>
                        <IonTitle>Alexa{app.build && <span className="title-version">{app.build.label}</span>}</IonTitle>
                        <IonButtons slot="end">
                            <SyncChip sync={app.sync} />
                            <IonButton onClick={app.reload} aria-label="Recharger depuis Alexa" title="Recharger depuis Alexa">
                                <IonIcon slot="icon-only" icon={refresh} />
                            </IonButton>
                        </IonButtons>
                    </IonToolbar>
                    {!app.needsLogin && (
                        <IonToolbar>
                            <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value)} scrollable>
                                {TABS.map(([value, text]) => (
                                    <IonSegmentButton key={value} value={value}><IonLabel>{text}</IonLabel></IonSegmentButton>
                                ))}
                            </IonSegment>
                        </IonToolbar>
                    )}
                </IonHeader>
                <IonContent>
                    <div className="page-width" style={{ paddingBottom: 96 }}>
                        {app.needsLogin ? <LoginPanel onLogin={app.startLogin} /> : (
                            <>
                                {tab === 'routines' && <RoutinesView app={app} onEdit={(routine) => setEditing({ routine })} />}
                                {tab === 'devices' && <DevicesView app={app} />}
                                {tab === 'skills' && <SkillsView app={app} />}
                                {tab === 'audit' && <AuditView app={app} />}
                            </>
                        )}
                    </div>
                    {!app.needsLogin && tab === 'routines' && (
                        <IonFab slot="fixed" vertical="bottom" horizontal="end" style={{ marginBottom: 64 }}>
                            <IonFabButton onClick={() => setEditing({ routine: null })} aria-label="Nouvelle routine" title="Nouvelle routine">
                                <IonIcon icon={add} />
                            </IonFabButton>
                        </IonFab>
                    )}
                </IonContent>
                <ActivityToast activity={app.activity} build={app.build} />
                <RoutineEditor
                    open={editing !== null}
                    routine={editing && editing.routine}
                    view={app.view}
                    onClose={() => setEditing(null)}
                    onSave={(spec, existing) => { app.actions.save(spec, existing); setEditing(null); }}
                />
            </IonPage>
        </IonApp>
    );
}
