// Isolated allocation measurement. No jsdom, no MutationObserver — so the
// library's auto-disposer observer is null and a heap delta reflects ONLY the
// library's own per-update allocation. Install the mock DOM BEFORE importing.
import { installMockDom, childSeq } from "../mock-dom.js";
installMockDom();

import test from "node:test";
import assert from "node:assert/strict";
import { signal } from "@zakkster/lite-signal";
import { bindText, keyed } from "../SignalDom.js";

const skip = typeof global.gc !== "function" ? "run with --expose-gc" : false;

function heapDeltaKB(fn) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    fn();
    global.gc();
    return (process.memoryUsage().heapUsed - before) / 1024;
}

const row = (item, recycled) => {
    const el = recycled || document.createElement("li");
    return { element: el, dispose: bindText(el, () => item.label()) };
};
const item = (id, label) => ({ id, label: signal(label) });

test("alloc: 1,000,000 bindText updates allocate ~0", { skip }, () => {
    const s = signal(0);
    const el = document.createElement("div");
    bindText(el, () => s());
    for (let i = 0; i < 10000; i++) s.set(i); // warm

    const kb = heapDeltaKB(() => { for (let i = 0; i < 1_000_000; i++) s.set(i); });
    assert.ok(kb < 256, `bindText: heap grew ${kb.toFixed(1)} KB over 1M updates (budget 256 KB)`);
});

test("alloc: 100,000 keyed reorders allocate ~0", { skip }, () => {
    const N = 64;
    const data = [];
    for (let i = 0; i < N; i++) data.push(item(i, "i" + i));
    const list = signal(data, { equals: false });
    const parent = document.createElement("ul");
    keyed(parent, () => list(), (it) => it.id, row);

    const rotate = () => { data.push(data.shift()); list.set(data); };
    for (let w = 0; w < 5000; w++) rotate(); // warm

    const kb = heapDeltaKB(() => { for (let i = 0; i < 100_000; i++) rotate(); });
    assert.ok(kb < 256, `keyed reorder: heap grew ${kb.toFixed(1)} KB over 100k reorders (budget 256 KB)`);
});

test("alloc harness sanity: reconciler actually reorders the mock DOM", () => {
    const data = [item(1, "a"), item(2, "b"), item(3, "c")];
    const list = signal(data, { equals: false });
    const parent = document.createElement("ul");
    keyed(parent, () => list(), (it) => it.id, row);
    assert.deepEqual(childSeq(parent), ["a", "b", "c"]);
    data.reverse();
    list.set(data);
    assert.deepEqual(childSeq(parent), ["c", "b", "a"], "real moves happened on the mock DOM");
});
