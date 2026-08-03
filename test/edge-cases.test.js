// Bootstrap a DOM BEFORE importing the library (its module body builds the
// MutationObserver at evaluation time).
import "../dom-setup.js";
import { flushObserver } from "../dom-setup.js";

import test from "node:test";
import assert from "node:assert/strict";

import { signal, stats } from "@zakkster/lite-signal";
import {
    bindText,
    bindHTMLUnsafe,
    bindAttr,
    bindProp,
    bindClass,
    bindStyle,
    bindShow,
    bindOn,
    keyed,
} from "../SignalDom.js";

// ── helpers ──────────────────────────────────────────────────────
const make = (tag = "div") => document.createElement(tag);
const mount = (el) => {
    document.body.appendChild(el);
    return el;
};
const baseline = () => stats().effects;

// ─────────────────────────────────────────────────────────────────
// bindText
// ─────────────────────────────────────────────────────────────────
test("bindText: initial value + reactive update", () => {
    const s = signal("a");
    const el = make();
    bindText(el, () => s());
    assert.equal(el.textContent, "a");
    s.set("b");
    assert.equal(el.textContent, "b");
});

test("bindText: coerces non-strings", () => {
    const s = signal(0);
    const el = make();
    bindText(el, () => s() + 1);
    assert.equal(el.textContent, "1");
    s.set(41);
    assert.equal(el.textContent, "42");
});

test("bindText: manual dispose stops updates and is idempotent", () => {
    const s = signal("x");
    const el = make();
    const stop = bindText(el, () => s());
    stop();
    s.set("y");
    assert.equal(el.textContent, "x", "no update after dispose");
    assert.doesNotThrow(stop, "second dispose is a no-op");
    assert.doesNotThrow(stop, "third dispose is a no-op");
});

// ─────────────────────────────────────────────────────────────────
// bindAttr
// ─────────────────────────────────────────────────────────────────
test("bindAttr: value attribute set + update", () => {
    const href = signal("/a");
    const el = make("a");
    bindAttr(el, "href", () => href());
    assert.equal(el.getAttribute("href"), "/a");
    href.set("/b");
    assert.equal(el.getAttribute("href"), "/b");
});

test("bindAttr: true => empty boolean attr, false/null => removed", () => {
    const on = signal(true);
    const el = make("input");
    bindAttr(el, "disabled", () => on());
    assert.equal(el.getAttribute("disabled"), "");
    on.set(false);
    assert.equal(el.hasAttribute("disabled"), false);
    on.set(true);
    assert.equal(el.getAttribute("disabled"), "");
});

test("bindAttr: numeric coercion", () => {
    const n = signal(3);
    const el = make("div");
    bindAttr(el, "data-n", () => n());
    assert.equal(el.getAttribute("data-n"), "3");
});

// ─────────────────────────────────────────────────────────────────
// bindProp / bindClass / bindStyle / bindShow / bindHTMLUnsafe
// ─────────────────────────────────────────────────────────────────
test("bindProp: live property (value)", () => {
    const v = signal("hi");
    const el = make("input");
    bindProp(el, "value", () => v());
    assert.equal(el.value, "hi");
    v.set("bye");
    assert.equal(el.value, "bye");
});

test("bindClass: toggles only the named class", () => {
    const active = signal(false);
    const el = make();
    el.className = "keep";
    bindClass(el, "active", () => active());
    assert.equal(el.classList.contains("active"), false);
    assert.equal(el.classList.contains("keep"), true);
    active.set(true);
    assert.equal(el.classList.contains("active"), true);
    assert.equal(el.classList.contains("keep"), true);
});

test("bindStyle: set value + null resets", () => {
    const w = signal("50%");
    const el = make();
    bindStyle(el, "width", () => w());
    assert.equal(el.style.width, "50%");
    w.set(null);
    assert.equal(el.style.width, "");
});

test("bindShow: hide/show with default and custom display", () => {
    const vis = signal(true);
    const el = make();
    bindShow(el, () => vis(), "grid");
    assert.equal(el.style.display, "grid");
    vis.set(false);
    assert.equal(el.style.display, "none");
    vis.set(true);
    assert.equal(el.style.display, "grid");
});

test("bindHTMLUnsafe: writes innerHTML", () => {
    const html = signal("<b>x</b>");
    const el = make();
    bindHTMLUnsafe(el, () => html());
    assert.equal(el.querySelector("b").textContent, "x");
    html.set("<i>y</i>");
    assert.equal(el.querySelector("i").textContent, "y");
});

// ─────────────────────────────────────────────────────────────────
// bindOn
// ─────────────────────────────────────────────────────────────────
test("bindOn: fires handler, dispose removes listener", () => {
    const el = make("button");
    let n = 0;
    const stop = bindOn(el, "click", () => n++);
    el.dispatchEvent(new window.Event("click"));
    el.dispatchEvent(new window.Event("click"));
    assert.equal(n, 2);
    stop();
    el.dispatchEvent(new window.Event("click"));
    assert.equal(n, 2, "no fire after dispose");
    assert.doesNotThrow(stop, "double dispose safe");
});

// ─────────────────────────────────────────────────────────────────
// Automatic disposal via MutationObserver
// ─────────────────────────────────────────────────────────────────
test("auto-dispose: removing a bound element stops its effect", async () => {
    const before = baseline();
    const s = signal("a");
    const el = mount(make());
    bindText(el, () => s());
    assert.equal(stats().effects, before + 1);

    document.body.removeChild(el);
    await flushObserver();

    assert.equal(stats().effects, before, "effect released back to the pool");
    s.set("b");
    assert.equal(el.textContent, "a", "detached element no longer updates");
});

test("auto-dispose: tears down bound descendants of a removed subtree", async () => {
    const before = baseline();
    const s = signal(1);
    const wrap = mount(make());
    const child = make("span");
    wrap.appendChild(child);
    bindText(child, () => String(s()));
    assert.equal(stats().effects, before + 1);

    document.body.removeChild(wrap); // remove the PARENT
    await flushObserver();

    assert.equal(stats().effects, before, "descendant effect cleaned up");
});

test("auto-dispose: re-inserting the same tick keeps bindings alive (isConnected guard)", async () => {
    const s = signal("a");
    const el = mount(make());
    bindText(el, () => s());

    // Detach + reattach within the same task, before the observer microtask runs.
    document.body.removeChild(el);
    document.body.appendChild(el);
    await flushObserver();

    s.set("b");
    assert.equal(el.textContent, "b", "binding survived the same-tick re-insert");
});

// ─────────────────────────────────────────────────────────────────
// keyed — ordering
// ─────────────────────────────────────────────────────────────────
const row = (item, recycled) => {
    const li = recycled || make("li");
    const stop = bindText(li, () => item.label());
    return { element: li, dispose: stop };
};
const labels = (parent) =>
    Array.from(parent.querySelectorAll("li")).map((li) => li.textContent);
const item = (id, label) => ({ id, label: signal(label) });

test("keyed: initial render in order", () => {
    const list = signal([item(1, "a"), item(2, "b"), item(3, "c")]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);
    assert.deepEqual(labels(parent), ["a", "b", "c"]);
});

test("keyed: append, prepend, remove preserve order", () => {
    const a = item(1, "a"), b = item(2, "b"), c = item(3, "c");
    const list = signal([a, b]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);
    assert.deepEqual(labels(parent), ["a", "b"]);

    list.set([a, b, c]); // append
    assert.deepEqual(labels(parent), ["a", "b", "c"]);

    list.set([c, a, b]); // prepend c + reorder
    assert.deepEqual(labels(parent), ["c", "a", "b"]);

    list.set([c, b]); // remove a
    assert.deepEqual(labels(parent), ["c", "b"]);
});

test("keyed: reverse reorder keeps every binding live", () => {
    const a = item(1, "a"), b = item(2, "b"), c = item(3, "c");
    const list = signal([a, b, c]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);

    list.set([c, b, a]);
    assert.deepEqual(labels(parent), ["c", "b", "a"]);

    // Mutate each label; if any binding were torn down, its text would freeze.
    a.label.set("A"); b.label.set("B"); c.label.set("C");
    assert.deepEqual(labels(parent), ["C", "B", "A"]);
});

test("keyed: stable list performs no DOM moves", () => {
    const a = item(1, "a"), b = item(2, "b");
    const list = signal([a, b]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);
    const elA = parent.querySelectorAll("li")[0];
    list.set([a, b]); // identical order
    assert.equal(parent.querySelectorAll("li")[0], elA, "same element instance, not re-created");
});

// ─────────────────────────────────────────────────────────────────
// keyed — pooling + the swap-recycle regression
// ─────────────────────────────────────────────────────────────────
test("keyed: removed elements are recycled from the pool", () => {
    const a = item(1, "a");
    const list = signal([a]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);
    const elA = parent.querySelector("li");

    const b = item(2, "b");
    list.set([b]); // a removed, b added — same tick
    const elB = parent.querySelector("li");
    assert.equal(elB, elA, "b reused a's pooled element");
    assert.equal(elB.textContent, "b");
});

test("keyed: REGRESSION — recycled element keeps its NEW binding live", async () => {
    const a = item(1, "a");
    const list = signal([a]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);

    const b = item(2, "b");
    list.set([b]); // swap: a out, b in, recycling a's element synchronously

    // Let the stale removal MutationRecord for a's element be delivered.
    await flushObserver();

    // Under the old draft, the async observer disposed b's fresh binding here.
    b.label.set("b2");
    assert.equal(parent.querySelector("li").textContent, "b2",
        "recycled element's new binding must stay reactive");
});

test("keyed: duplicate keys collapse to one view (last wins)", () => {
    const a = item(1, "a");
    const dup = { id: 1, label: signal("dup") };
    const list = signal([a, dup]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);
    assert.equal(parent.querySelectorAll("li").length, 1, "single element for the shared key");
});

test("keyed: empty list renders nothing, regrows correctly", () => {
    const a = item(1, "a");
    const list = signal([]);
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);
    assert.equal(parent.querySelectorAll("li").length, 0);
    list.set([a]);
    assert.deepEqual(labels(parent), ["a"]);
    list.set([]);
    assert.equal(parent.querySelectorAll("li").length, 0);
});

// ─────────────────────────────────────────────────────────────────
// keyed — teardown
// ─────────────────────────────────────────────────────────────────
test("keyed: dispose tears down every view, element and the anchor", async () => {
    const before = baseline();
    const a = item(1, "a"), b = item(2, "b");
    const list = signal([a, b]);
    const parent = mount(make("ul"));
    const stop = keyed(parent, () => list(), (it) => it.id, row);
    assert.equal(stats().effects, before + 4, "1 list effect + 1 stable row-owner + 2 row effects");

    stop();
    await flushObserver();

    assert.equal(stats().effects, before, "all effects released");
    assert.equal(parent.childNodes.length, 0, "no elements and no anchor left behind");
    a.label.set("A"); // must not throw or revive anything
    assert.doesNotThrow(stop, "dispose is idempotent");
});

// ─────────────────────────────────────────────────────────────────
// No-leak: create/destroy churn returns effects to baseline
// ─────────────────────────────────────────────────────────────────
test("no-leak: churn of bindings returns the pool to baseline", async () => {
    const before = baseline();
    for (let i = 0; i < 200; i++) {
        const s = signal(i);
        const el = mount(make());
        bindText(el, () => s());
        document.body.removeChild(el);
    }
    await flushObserver();
    assert.equal(stats().effects, before, "no effect nodes leaked across 200 mount/unmount cycles");
});

// ─────────────────────────────────────────────────────────────────
// Zero-allocation guarantee (requires --expose-gc)
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// Allocation note: the per-update "0 bytes" claim is measured in isolation
// (no jsdom, no observer) in test/zero-alloc.test.js. A heap budget can't be
// asserted under jsdom — every DOM mutation queues a MutationObserver record
// that pins memory until a microtask drains it, swamping the library's own
// (near-zero) allocation. The leak check below is the jsdom-side guarantee.
// ─────────────────────────────────────────────────────────────────

test("equals:false sanity — repeated set of the same reference DOES re-run the effect", () => {
    // Guards against the silent-bail trap: with the default Object.is equality,
    // re-setting the same (mutated) array reference bails and the reconciler
    // never runs. equals:false opts out so in-place array reuse propagates.
    const arr = [item(1, "a"), item(2, "b")];
    const list = signal(arr, { equals: false });
    const parent = mount(make("ul"));
    keyed(parent, () => list(), (it) => it.id, row);

    arr.reverse();
    list.set(arr); // same reference, reversed contents
    assert.deepEqual(labels(parent), ["b", "a"], "reconciler ran on a same-reference set");
});
