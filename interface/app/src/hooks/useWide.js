import { useEffect, useState } from 'react';

/** Whether the screen is wide (a computer or a tablet held flat), kept up to date as it changes. */
export function useWide(query = '(min-width: 768px)') {
    const [wide, setWide] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const m = window.matchMedia(query);
        const on = () => setWide(m.matches);
        m.addEventListener('change', on);
        return () => m.removeEventListener('change', on);
    }, [query]);
    return wide;
}
