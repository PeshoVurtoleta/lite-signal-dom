/**
 * bench/bench.js -- @zakkster/lite-signal-dom
 *
 * Run: node --expose-gc bench/bench.js
 *
 * Measured against a no-op linked-list DOM (../mock-dom.js), NOT jsdom. Two
 * reasons: (1) it isolates the library's own allocation from the host DOM's
 * (native and ~free in a browser, JS-heavy under jsdom); (2) jsdom queues a
 * MutationObserver record per mutation that never drains in a tight loop, which
 * OOMs the process and swamps the measurement. The mock has zero-allocation,
 * O(1) node ops, so a heap delta here is the library + lite-signal alone.
 *
 * Caveat: throughput is "algorithmic" (no layout/reflow/paint). Treat it as the
 * cost of the reconcile + bind work, not a full-browser frame time.
 */
import { installMockDom } from "../mock-dom.js";
installMockDom();
import { signal, effect } from "@zakkster/lite-signal";
import { bindText, keyed } from "../SignalDom.js";

const hasGC = typeof global.gc === "function";
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const log = (...a) => { console.log(...a); };

function heapDelta(fn) {
    if (hasGC) global.gc();
    const before = process.memoryUsage().heapUsed;
    fn();
    if (hasGC) global.gc();
    return process.memoryUsage().heapUsed - before;
}

const item = (id, l) => ({ id, label: signal(l) });
const items = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(item(i, "item-" + i)); return a; };
const row = (it, recycled) => {
    const el = recycled || document.createElement("li");
    return { element: el, dispose: bindText(el, () => it.label()) };
};

// 1. text binding — steady-state update cost
function benchText(updates) {
    const s = signal(0);
    const el = document.createElement("div");
    bindText(el, () => s());
    for (let i = 0; i < 10000; i++) s.set(i);
    const heap = heapDelta(() => { for (let i = 0; i < updates; i++) s.set(i); });
    const t0 = now(); for (let i = 0; i < updates; i++) s.set(i); const ms = now() - t0;
    return { ops: updates / (ms / 1000), heap };
}

// 2. keyed reorder — reuse + pool, no new keys (equals:false, in-place: no harness alloc)
function benchKeyed(n, iters) {
    const arr = items(n);
    const list = signal(arr, { equals: false });
    const parent = document.createElement("ul");
    const stop = keyed(parent, () => list(), (it) => it.id, row);
    const rotate = () => { arr.push(arr.shift()); list.set(arr); };
    for (let i = 0; i < 5000; i++) rotate();
    const heap = heapDelta(() => { for (let i = 0; i < iters; i++) rotate(); });
    const t0 = now(); for (let i = 0; i < iters; i++) rotate(); const ms = now() - t0;
    stop();
    return { ops: iters / (ms / 1000), heap };
}

// 3. naive rebuild — recreate every element each update (disposes old; no leak)
function benchNaive(n, iters) {
    const arr = items(n);
    const list = signal(arr, { equals: false });
    const parent = document.createElement("ul");
    let stops = [];
    const render = () => {
        for (let i = 0; i < stops.length; i++) stops[i]();
        stops = [];
        const a = list();
        for (let c = parent.firstChild; c; c = parent.firstChild) parent.removeChild(c);
        for (let i = 0; i < a.length; i++) {
            const el = document.createElement("li");
            stops.push(bindText(el, () => a[i].label()));
            parent.appendChild(el);
        }
    };
    const stopEffect = effect(render);
    const rotate = () => { arr.push(arr.shift()); list.set(arr); };
    for (let i = 0; i < 500; i++) rotate();
    const heap = heapDelta(() => { for (let i = 0; i < iters; i++) rotate(); });
    const t0 = now(); for (let i = 0; i < iters; i++) rotate(); const ms = now() - t0;
    stopEffect();
    for (let i = 0; i < stops.length; i++) stops[i]();
    return { ops: iters / (ms / 1000), heap, allocsPerUpdate: n + 2 * n };
}

const fmtB = (b) => (Math.abs(b) < 4096 ? b + " B" : (b / 1024).toFixed(1) + " KB");
const perUp = (b, n) => (b / n).toFixed(3) + " B/update";
const fmtOps = (o) => (o >= 1e6 ? (o / 1e6).toFixed(2) + "M" : (o / 1e3).toFixed(0) + "K");
const med = (label, fn, k) => { log("  ..", label); const r = [fn(), fn(), fn()]; const m = median(r.map((x) => x[k])); return r.find((x) => x[k] === m); };

(function main() {
    log("\n  @zakkster/lite-signal-dom -- bench (mock DOM, isolates library allocation)");
    if (!hasGC) log("  WARN  run with --expose-gc for heap numbers");
    const N = 100, ITERS = 50000, TEXT = 1000000;
    log("  running 3x medians ...");

    const text = med("text binding " + TEXT.toLocaleString() + " updates", () => benchText(TEXT), "heap");
    const kd   = med("keyed reorder " + ITERS.toLocaleString() + " x " + N + " items", () => benchKeyed(N, ITERS), "heap");
    const nv   = med("naive rebuild " + ITERS.toLocaleString() + " x " + N + " items", () => benchNaive(N, ITERS), "ops");

    log("\n  -- allocation (library only; transfers to browser) -------------");
    log("  bindText update ....... " + fmtB(text.heap).padStart(9) + " total -> " + perUp(text.heap, TEXT));
    log("  keyed reorder ......... " + fmtB(kd.heap).padStart(9) + " total -> " + perUp(kd.heap, ITERS));
    log("  naive rebuild ......... " + fmtB(nv.heap).padStart(9) + " total -> " + perUp(nv.heap, ITERS) + "  (" + nv.allocsPerUpdate + " allocs/update)");
    log("\n  -- throughput (algorithmic; no layout/paint) -------------------");
    log("  text update ........... " + fmtOps(text.ops).padStart(7) + " ops/s");
    log("  keyed reorder ......... " + fmtOps(kd.ops).padStart(7) + " ops/s   (0 element allocs/update)");
    log("  naive rebuild ......... " + fmtOps(nv.ops).padStart(7) + " ops/s   (" + N + " nodes + " + (2 * N) + " closures/update)");
    log("\n  keyed reorder: ~" + (kd.ops / nv.ops).toFixed(1) + "x naive throughput, ~0 vs " + nv.allocsPerUpdate + " allocs/update.\n");

    import("node:fs").then((fs) => {
        fs.writeFileSync(new URL("./bench-results.json", import.meta.url), JSON.stringify({
            node: process.version, timestamp: new Date().toISOString(),
            harness: "mock-dom (no jsdom); isolates library allocation; throughput is algorithmic (no layout/paint)",
            textUpdates: { count: TEXT, ops: text.ops, heapBytes: text.heap, bytesPerUpdate: text.heap / TEXT },
            keyedReorder: { items: N, iters: ITERS, ops: kd.ops, heapBytes: kd.heap, bytesPerUpdate: kd.heap / ITERS },
            naiveRebuild: { items: N, iters: ITERS, ops: nv.ops, heapBytes: nv.heap, allocsPerUpdate: nv.allocsPerUpdate },
        }, null, 2));
        log("  wrote bench/bench-results.json\n");
    });
})();
