// Whether the screen is wide (a computer or a tablet held flat), kept up to date as it changes.

class Wide {
    current = $state(false);

    constructor(query = '(min-width: 768px)') {
        const m = window.matchMedia(query);
        this.current = m.matches;
        m.addEventListener('change', () => { this.current = m.matches; });
    }
}

export const wide = new Wide();
