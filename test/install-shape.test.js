// X-PEER install-shape gate: the peer-dependency contract, made executable.
//
// A signal graph is module-instance state. If a consumer's tree ends up with two
// copies of lite-signal (which a bundled runtime `dependencies` invites the day
// lite-signal ships a new major), a signal from one copy does not drive an effect
// from the other -- every binding silently freezes at its initial value, no error.
//
// Declaring lite-signal a PEER dependency is what guarantees a single shared
// graph. This suite proves both directions: the deduped install drives a binding,
// and a deliberately duplicated two-copy tree does not. The second copy is real,
// not mocked -- Node keys the ESM module cache by full URL, so importing the exact
// same file under a distinct query string re-evaluates it with its own graph state.

import "../dom-setup.js";

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Graph A: the same lite-signal instance the package's effects run inside.
import { signal as signalA } from "@zakkster/lite-signal";
import { bindText } from "../SignalDom.js";

// Graph B: a genuine second instance of the exact same lite-signal file.
const require = createRequire(import.meta.url);
const signalFileURL = pathToFileURL(require.resolve("@zakkster/lite-signal")).href;
const graphB = await import(signalFileURL + "?dup");
const signalB = graphB.signal;

const make = (tag = "div") => document.createElement(tag);

test("install-shape: the second import really is a distinct lite-signal graph", () => {
    assert.notEqual(
        signalA,
        signalB,
        "duplicated-tree simulation is only meaningful if the two copies differ",
    );
});

test("install-shape: one shared graph drives a binding (the deduped peer install)", () => {
    const s = signalA("a");
    const el = make();
    const stop = bindText(el, () => s());

    assert.equal(el.textContent, "a", "initial read");
    s.set("b");
    assert.equal(el.textContent, "b", "effect and signal share one graph -> the binding reruns");

    stop();
});

test("install-shape: two graphs do NOT drive each other (what a duplicated tree ships)", () => {
    const s = signalB("a"); // signal owned by graph B
    const el = make();
    const stop = bindText(el, () => s()); // bindText's effect lives in graph A

    assert.equal(el.textContent, "a", "the initial synchronous read still runs once");
    s.set("b"); // mutate the graph-B signal

    assert.equal(
        el.textContent,
        "a",
        "graph-A's effect never tracked the graph-B signal, so the binding is frozen. " +
            "This is exactly the silent failure a bundled (non-peer) lite-signal would ship, " +
            "and the reason the manifest declares lite-signal a peer dependency.",
    );

    stop();
});
