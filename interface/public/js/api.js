// The two calls the page makes to its server.

/** Every part of the snapshot as it arrives: yields { kind, data, cached }. */
export async function* snapshot(fetchFn = fetch) {
    const res = await fetchFn('/api/snapshot');
    if (!res.ok || !res.body) throw new Error(res.statusText || `HTTP ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        let nl;
        while ((nl = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, nl).trim();
            pending = pending.slice(nl + 1);
            if (line) yield JSON.parse(line);
        }
    }
}

/**
 * One change through the CLI. Resolves to the CLI's --json answer; rejects with the CLI's own message when it
 * refused (the message the toast shows).
 */
export async function change(command, body, fetchFn = fetch) {
    let res;
    try {
        res = await fetchFn(`/api/do/${command}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Alexa-Cli': '1' },
            body: JSON.stringify(body),
        });
    } catch {
        throw new Error('Failed to fetch');
    }
    const doc = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) throw new Error(doc.error || `HTTP ${res.status}`);
    return doc;
}
