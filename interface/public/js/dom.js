// One helper to build elements. Text from Amazon only ever goes in as text nodes, never as HTML.

export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
}

export const $ = (selector) => document.querySelector(selector);
