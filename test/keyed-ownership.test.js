// SD-05 regression: keyed() row bindings must survive list re-runs.
//
// lite-signal (>= 1.2.0) auto-disposes a nested effect when its owner re-runs.
// keyed() runs renderFn inside its list effect, so before the createRoot fix
// every surviving row's fine-grained bindings were torn down on the next list
// change (and, for moved-but-surviving keys, never recreated) -- the row froze.
// The one pre-existing test that caught this ("reverse reorder keeps every
// binding live") understated it: ANY row that updates after ANY list change was
// affected. These tests pin the fix from several angles and assert no leak.

import "../dom-setup.js";
import { flushObserver } from "../dom-setup.js";

import test from "node:test";
import assert from "node:assert/strict";

import { signal, stats, hasObservers } from "@zakkster/lite-signal";
import { keyed, bindText } from "../SignalDom.js";

const make = (tag = "div") => document.createElement(tag);
const mount = (el) => (document.body.appendChild(el), el);
const item = (id, label) => ({ id, label: signal(label) });
const row = (it, recycled) => {
    const li = recycled || make("li");
    return { element: li, dispose: bindText(li, () => it.label()) };
};
const labels = (p) => Array.from(p.querySelectorAll("li")).map((li) => li.textContent);

test("SD-05: a moved-but-surviving row still updates after a reorder", () => {
    const a = item(1, "a"), b = item(2, "b"), c = item(3, "c");
    const list = signal([a, b, c]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);

    list.set([c, a, b]); // every key survives; all are moved
    a.label.set("A"); b.label.set("B"); c.label.set("C");
    assert.deepEqual(labels(parent), ["C", "A", "B"], "moved survivors stay live");
});

test("SD-05: survivor bindings persist across MANY successive list changes", () => {
    const a = item(1, "a"), b = item(2, "b"), c = item(3, "c");
    const list = signal([a, b, c]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);

    // Churn the list order repeatedly; the row effects must never be reclaimed.
    list.set([b, c, a]);
    list.set([a, c, b]);
    list.set([c, b, a]);
    list.set([a, b, c]);

    a.label.set("X"); b.label.set("Y"); c.label.set("Z");
    assert.deepEqual(labels(parent), ["X", "Y", "Z"], "still live after 4 reorders");
});

test("SD-05: existing rows stay live after the list GROWS (append)", () => {
    const a = item(1, "a"), b = item(2, "b");
    const list = signal([a, b]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);

    list.set([a, b, item(3, "c")]); // list effect re-runs; a and b survive
    a.label.set("A");
    assert.deepEqual(labels(parent), ["A", "b", "c"], "survivor a is still live after append");
});

test("SD-05: survivors stay live after OTHER rows are removed", () => {
    const a = item(1, "a"), b = item(2, "b"), c = item(3, "c");
    const list = signal([a, b, c]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);

    list.set([a, c]); // b removed; a and c survive
    a.label.set("A"); c.label.set("C");
    assert.deepEqual(labels(parent), ["A", "C"], "survivors live after a sibling removal");
});

test("SD-05: no effect leak -- survivor count is stable across reorders", () => {
    const a = item(1, "a"), b = item(2, "b"), c = item(3, "c");
    const list = signal([a, b, c]);
    const parent = mount(make("ul"));
    const dispose = keyed(parent, () => list(), (it) => it.id, row);

    const afterInitial = stats().effects;
    for (let i = 0; i < 20; i++) list.set(i & 1 ? [c, b, a] : [a, b, c]);
    const afterChurn = stats().effects;

    assert.equal(
        afterChurn,
        afterInitial,
        "reorders must not accumulate row effects (createRoot roots them; no recreation for survivors)",
    );
    dispose();
});

test("SD-05: full teardown removes every row observer (no retained bindings)", () => {
    const a = item(1, "a"), b = item(2, "b");
    const list = signal([a, b]);
    const parent = mount(make("ul"));
    const dispose = keyed(parent, () => list(), (it) => it.id, row);

    assert.equal(hasObservers(a.label), true, "row a is observed while mounted");
    dispose();
    assert.equal(hasObservers(a.label), false, "row a's binding is gone after keyed dispose");
    assert.equal(hasObservers(b.label), false, "row b's binding is gone after keyed dispose");

    assert.doesNotThrow(() => a.label.set("A"), "mutating a torn-down row's signal is inert");
    assert.equal(parent.querySelectorAll("li").length, 0, "dispose removed every row element");
});

test("SD-05: keyed ADD/REMOVE churn does not accumulate effects", () => {
    const parent = mount(make("ul"));
    const list = signal([]);
    const dispose = keyed(parent, () => list(), (it) => it.id, row);

    const before = stats().effects; // list effect + stable row-owner, no rows yet
    for (let i = 0; i < 32; i++) {
        // add three fresh rows, then remove them all -- exercises the sweepStale
        // path that must dispose each rooted row effect and not retain it.
        list.set([item(i * 3, "a"), item(i * 3 + 1, "b"), item(i * 3 + 2, "c")]);
        list.set([]);
    }
    assert.equal(
        stats().effects,
        before,
        "row effects created under the stable owner are released on removal, not retained",
    );
    dispose();
});

test("SD-05: bare DOM removal (auto-dispose, no explicit dispose) reclaims the stable owner too", async () => {
    const before = stats().effects;
    const container = mount(make("div"));
    const parent = make("ul");
    container.appendChild(parent);
    const list = signal([item(1, "a"), item(2, "b")]);
    keyed(parent, () => list(), (it) => it.id, row); // deliberately DO NOT keep the disposer

    assert.equal(stats().effects, before + 4, "list effect + stable row-owner + 2 rows");

    container.removeChild(parent); // remove from the DOM; the MutationObserver cleans up
    await flushObserver();

    assert.equal(
        stats().effects,
        before,
        "observer cleanup reclaimed list effect + rows AND the stable row-owner (no stranded node)",
    );
});

test("SD-05: a throwing renderFn does not orphan row effects past teardown", () => {
    const good = item(1, "a");
    const list = signal([good]);
    const parent = mount(make("ul"));

    // renderFn that creates a real binding, THEN throws -- the partial binding is
    // rooted in the owner tree, unreachable from activeViews. Teardown must still
    // reclaim it (the fail-closed backstop), so no observer is left on bad.label.
    const bad = item(2, "b");
    const throwingRow = (it, recycled) => {
        const li = recycled || make("li");
        bindText(li, () => it.label()); // real, rooted binding
        throw new Error("renderFn boom");
    };

    const before = stats().effects;
    const dispose = keyed(parent, () => list(), (it) => it.id, (it, rec) =>
        it.id === 2 ? throwingRow(it, rec) : row(it, rec),
    );
    // Trigger the throwing row; the list effect body throws out to the setter.
    assert.throws(() => list.set([good, bad]), /renderFn boom/);
    assert.equal(hasObservers(bad.label), true, "the partial rooted binding is live (orphaned from activeViews)");

    dispose();
    assert.equal(hasObservers(bad.label), false, "teardown reclaimed the orphaned partial binding");
    assert.equal(hasObservers(good.label), false, "teardown reclaimed the good row too");
    assert.equal(stats().effects, before, "no effect survives the keyed instance");
});
