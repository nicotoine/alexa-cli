// The Devices tab: a table sorted by its column headers on a wide screen, a list with a sort menu on a phone; the
// same filters for both.

import {
    IonBadge, IonButton, IonIcon, IonItem, IonLabel, IonList, IonSearchbar, IonSelect, IonSelectOption, IonSkeletonText,
} from '@ionic/react';
import { arrowDown, arrowUp, swapVertical, trashOutline } from 'ionicons/icons';
import { useWide } from '../hooks/useWide.js';
import { DEVICE_COLUMNS, deviceFacets, deviceRows, nextDeviceSort } from '../lib/listing.js';

export default function DevicesView({ app }) {
    const { view, store, actions, prefs, setPrefs } = app;
    const wide = useWide();
    const criteria = prefs.devices;
    const set = (patch) => setPrefs('devices', patch);
    if (!view.appliances) return <div className="ion-padding"><IonSkeletonText animated style={{ width: '60%' }} /><IonSkeletonText animated /></div>;
    const rows = deviceRows(view, criteria);
    const { sources, makers } = deviceFacets(view);
    const arrow = (column) => (criteria.sort !== column ? swapVertical : criteria.dir === 'desc' ? arrowDown : arrowUp);

    return (
        <>
            <IonSearchbar value={criteria.text} placeholder="Filtrer les appareils" debounce={150} onIonInput={(e) => set({ text: e.detail.value || '' })} />
            <div className="filters">
                {!wide && (
                    <>
                        <IonSelect label="Trier" labelPlacement="stacked" interface="popover" value={criteria.sort} onIonChange={(e) => set({ sort: e.detail.value })}>
                            {Object.entries(DEVICE_COLUMNS).map(([v, t]) => <IonSelectOption key={v} value={v}>{t}</IonSelectOption>)}
                        </IonSelect>
                        <IonButton fill="clear" aria-label={criteria.dir === 'desc' ? 'Ordre décroissant' : 'Ordre croissant'}
                            onClick={() => set({ dir: criteria.dir === 'desc' ? 'asc' : 'desc' })}>
                            <IonIcon slot="icon-only" icon={criteria.dir === 'desc' ? arrowDown : arrowUp} />
                        </IonButton>
                    </>
                )}
                <IonSelect label="Source" labelPlacement="stacked" interface="popover" value={criteria.source} onIonChange={(e) => set({ source: e.detail.value })}>
                    <IonSelectOption value="all">Toutes</IonSelectOption>
                    {sources.map((s) => <IonSelectOption key={s} value={s}>{s}</IonSelectOption>)}
                </IonSelect>
                <IonSelect label="Fabricant" labelPlacement="stacked" interface="popover" value={criteria.maker} onIonChange={(e) => set({ maker: e.detail.value })}>
                    <IonSelectOption value="">Tous</IonSelectOption>
                    {makers.map((m) => <IonSelectOption key={m} value={m}>{m}</IonSelectOption>)}
                </IonSelect>
                <IonSelect label="Utilisé" labelPlacement="stacked" interface="popover" value={criteria.used} onIonChange={(e) => set({ used: e.detail.value })}>
                    <IonSelectOption value="all">Peu importe</IonSelectOption>
                    <IonSelectOption value="yes">Par une routine</IonSelectOption>
                    <IonSelectOption value="no">Par aucune</IonSelectOption>
                </IonSelect>
                <span className="count">{rows.length === view.appliances.length ? `${rows.length} appareils` : `${rows.length} sur ${view.appliances.length}`}</span>
            </div>

            {wide ? (
                <div className="table-wrap">
                    <table className="devices">
                        <thead>
                            <tr>
                                {Object.entries(DEVICE_COLUMNS).map(([column, title]) => (
                                    <th key={column} aria-sort={criteria.sort !== column ? 'none' : criteria.dir === 'desc' ? 'descending' : 'ascending'}>
                                        <button type="button" onClick={() => set(nextDeviceSort(criteria, column))}>
                                            {title} <IonIcon icon={arrow(column)} color={criteria.sort === column ? 'primary' : 'medium'} />
                                        </button>
                                    </th>
                                ))}
                                <th><span className="ion-hide">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(({ a, source, refs }) => (
                                <tr key={a.applianceId} className={store.isPending(a.applianceId) ? 'pending' : ''}>
                                    <td>{a.friendlyName}</td>
                                    <td>{a.manufacturerName || ''}</td>
                                    <td><IonBadge color={source === 'Skill' ? 'warning' : 'primary'}>{source}</IonBadge></td>
                                    <td className="small">{refs.length ? refs.join(', ') : <span className="muted">—</span>}</td>
                                    <td>
                                        <IonButton fill="clear" color="danger" size="small" onClick={() => actions.forget(a)} aria-label={`Supprimer ${a.friendlyName}`}>
                                            <IonIcon slot="icon-only" icon={trashOutline} />
                                        </IonButton>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <IonList>
                    {rows.map(({ a, source, refs }) => (
                        <IonItem key={a.applianceId} style={store.isPending(a.applianceId) ? { opacity: 0.5 } : undefined}>
                            <IonLabel className="ion-text-wrap">
                                <h3>{a.friendlyName}</h3>
                                <p>{a.manufacturerName || ''} · {source}</p>
                                {refs.length > 0 && <p className="small">{refs.join(', ')}</p>}
                            </IonLabel>
                            <IonButton slot="end" fill="clear" color="danger" onClick={() => actions.forget(a)} aria-label={`Supprimer ${a.friendlyName}`}>
                                <IonIcon slot="icon-only" icon={trashOutline} />
                            </IonButton>
                        </IonItem>
                    ))}
                </IonList>
            )}
            {rows.length === 0 && <p className="ion-padding muted">Aucun appareil ne correspond aux filtres.</p>}
        </>
    );
}
