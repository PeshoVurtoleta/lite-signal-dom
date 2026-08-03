// test/torture.mjs -- node --expose-gc test/torture.mjs
//
// The mandatory retention + GC gate for @zakkster/lite-signal-dom, focused on
// keyed() and its SD-05 fix (row bindings rooted under a stable per-keyed owner
// via runWithOwner, disposed by keyed's own teardown).
//
// DOM choice: the MOCK dom (no MutationObserver, no-op classList), exactly like
// zero-alloc.test.js. Two reasons: (1) allocation must be measured in isolation
// so a heap/GC number reflects the LIBRARY's cost, not jsdom's per-op churn;
// (2) with the observer null, teardown here is the explicit disposer path, and
// lite-signal's own owner tree is what must reclaim the row effects. The
// OBSERVER (bare-DOM-removal) teardown path is retention-tested separately under
// jsdom in test/keyed-ownership.test.js, which runs in `npm test`.
//
//   phase 1 -- retention: 4096 build/reorder/dispose cycles must leave ZERO live
//              effects and reclaim every tracked item (lite-leak + stats()).
//   phase 2 -- allocation: 100k in-place reorders of a steady list must trigger
//              no major GC (lite-gc-profiler, maxMajor 0).

import { installMockDom } from "../mock-dom.js";
installMockDom();

import { GcProfiler, checkNoGc } from "@zakkster/lite-gc-profiler";
import {
    createLeakTracker,
    createOwnerCascadeOrphanKernel,
    createObserverOrphanKernel,
} from "@zakkster/lite-leak";
import { signal, stats, dispose } from "@zakkster/lite-signal";

import { keyed, bindText } from "../SignalDom.js";

const CYCLES = 4096;
const HOT = 100_000;
const ROWS = 8;

const leaks = [];
const warns = [];
const tracker = createLeakTracker({
    name: "signal-dom-keyed",
    onLeak: (r) => leaks.push(r.kind + ":" + String(r.tag)),
    onWarning: (w) => warns.push(w.kind + ":" + w.reason),
});
tracker.registerKernel(createOwnerCascadeOrphanKernel()); // stranded row-owner / rows
tracker.registerKernel(createObserverOrphanKernel()); // bindText effect still subscribed

const makeRow = (it, recycled) => {
    const li = recycled || document.createElement("li");
    return { element: li, dispose: bindText(li, () => it.label()) };
};

// ---- phase 1: retention torture ------------------------------------------
// Fresh per-cycle items so a surviving row effect keeps its item reachable (the
// bindText body closes over `it`) -- that is what `tracker.track` watches for.
// The item signals are the harness's to dispose (keyed owns only the effects);
// disposing them keeps the run under lite-signal's 1024-node pool ceiling.
for (let i = 0; i < CYCLES; i++) {
    const items = [];
    for (let k = 0; k < ROWS; k++) items.push({ id: k, label: signal("r" + k) });

    const parent = document.createElement("ul");
    const listSig = signal(items.slice(), { equals: false });
    const teardown = keyed(parent, () => listSig(), (it) => it.id, makeRow);

    listSig.set(items.slice().reverse()); // every key survives, all move
    listSig.set(items.slice(1).concat(items[0]));
    listSig.set(items.slice());

    teardown();
    for (const it of items) dispose(it.label);
    dispose(listSig);

    // Neither the cleanup nor the tag may close over the tracked object. No
    // per-track audit: onLeak would then fire transiently for earlier items not
    // yet finalized mid-loop. The authoritative retention check is size()/audit()
    // after the settle passes below.
    tracker.track(items[0], () => {}, "item#" + i);
}

const effectsAfterChurn = stats().effects;
// GC entries and finalization arrive asynchronously: settle over a few passes
// before reading, or gate on a half-collected window and get a false PASS.
for (let p = 0; p < 4; p++) {
    globalThis.gc?.();
    await new Promise((r) => setTimeout(r, 30));
}
// Only the settled state is authoritative; discard any live-stream notifications
// emitted while finalization was still in flight.
leaks.length = 0;
warns.length = 0;
const live = tracker.size();
const findings = tracker.audit();

// ---- phase 2: allocation + GC torture (the reorder hot path) --------------
// One steady list; reorder the SAME array in place and re-set under equals:false
// (the zero-alloc reorder contract). keyFn returns a number, so the reconciler
// should allocate nothing per update -- no major GC.
const hotItems = [];
for (let k = 0; k < 16; k++) hotItems.push({ id: k, label: signal("h" + k) });
const hotArr = hotItems.slice();
const hotList = signal(hotArr, { equals: false });
const hotParent = document.createElement("ul");
const hotDispose = keyed(hotParent, () => hotList(), (it) => it.id, makeRow);

const gc = new GcProfiler().start();
for (let i = 0; i < HOT; i++) {
    const a = i % 16;
    const b = (i * 7 + 3) % 16;
    const t = hotArr[a];
    hotArr[a] = hotArr[b];
    hotArr[b] = t; // swap in place
    hotList.set(hotArr); // same reference; equals:false forces the reconcile
    if ((i & 8191) === 0) {
        gc.sampleHeap(performance.now(), process.memoryUsage().heapUsed);
    }
}
await new Promise((r) => setTimeout(r, 50));
const s = gc.summary();
const report = checkNoGc(s, { maxMajor: 0, maxPauseMs: 4 });
gc.stop();
hotDispose();

// ---- gate -----------------------------------------------------------------
const ok =
    report.ok &&
    live === 0 &&
    leaks.length === 0 &&
    findings.length === 0 &&
    warns.length === 0 &&
    effectsAfterChurn === 0;

console.log(
    "GATE leak=size " + live + "/0 findings=" + findings.length +
    " warnings=" + warns.length +
    " | effects-after-churn=" + effectsAfterChurn + "/0" +
    " | gc major=" + s.gc.major + " minor=" + s.gc.minor +
    " maxMs=" + s.gc.maxMs.toFixed(2) +
    " | " + (ok ? "ok" : "FAIL"),
);
if (!ok) {
    for (const v of report.violations) {
        console.error("  violation " + v.metric + " limit=" + v.limit + " actual=" + v.actual);
    }
    for (const f of findings) console.error("  finding " + f.kind + ":" + f.reason);
    for (const l of leaks) console.error("  leak " + l);
    for (const w of warns) console.error("  warning " + w);
    process.exitCode = 1;
}
