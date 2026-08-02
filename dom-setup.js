/**
 * Test/bench DOM bootstrap. Installs a jsdom window's globals so the same
 * source that runs in a browser runs unchanged under `node --test`.
 *
 * Import this FIRST (before SignalDom.js) so `document` / `MutationObserver`
 * exist when the module-level observer is constructed.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://lite.test/",
});

const { window } = dom;
const documentRef = window.document;

// Minimal global surface the library touches.
globalThis.window = window;
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Comment = window.Comment;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;

/**
 * Flush pending MutationObserver callbacks. jsdom delivers them on the
 * microtask queue, so awaiting a resolved promise drains them. Await an extra
 * turn for cascades (a disposal that triggers further removals).
 * @returns {Promise<void>}
 */
export async function flushObserver() {
    await Promise.resolve();
    await Promise.resolve();
}

export { window };
export { documentRef as document };
