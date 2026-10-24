// How actions and states read in French.

export const PLAY_LABELS: Record<string, string> = {
    weather: 'Météo', time: 'Heure', date: 'Date', calendar: 'Agenda du jour', news: 'Infos', goodmorning: 'Bonjour',
};

export const PLAY_TYPES: Record<string, string> = {
    'Alexa.Weather.Play': 'météo', 'Alexa.Time.Play': 'heure', 'Alexa.Date.Play': 'date',
    'Alexa.Calendar.PlayToday': 'agenda', 'Alexa.News.NationalNews': 'infos', 'Alexa.GoodMorning.Play': 'bonjour',
};

export const DAY_LABELS: Record<string, string> = { MO: 'L', TU: 'M', WE: 'M', TH: 'J', FR: 'V', SA: 'S', SU: 'D' };
export const DAY_NAMES: Record<string, string> = {
    MO: 'lundi', TU: 'mardi', WE: 'mercredi', TH: 'jeudi', FR: 'vendredi', SA: 'samedi', SU: 'dimanche',
};

export const time = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
