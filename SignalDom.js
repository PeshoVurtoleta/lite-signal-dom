/**
 * @zakkster/lite-signal-dom
 * -------------------------
 * Zero-GC, vanilla-first reactive DOM bindings for @zakkster/lite-signal.
 *
 * No virtual DOM, no template compiler, no build step. Each binding is a single
 * lite-signal `effect` whose body is one property write. The getter is captured
 * once at bind time, so the per-update hot path allocates nothing on the JS heap
 * (the effect re-run itself is pool-backed inside lite-signal).
 *
 * Disposal is automatic: a single document-level `MutationObserver` runs the
 * teardown for any bound node (and its bound descendants) when it leaves the DOM.
 * Manual disposers are also returned from every primitive for deterministic,
 * synchronous teardown.
 *
 * Public surface: {@link bindText}, {@link bindHTMLUnsafe}, {@link bindAttr},
 * {@link bindProp}, {@link bindClass}, {@link bindStyle}, {@link bindShow},
 * {@link bindOn}, {@link keyed}.
 *
 * @module @zakkster/lite-signal-dom
 */

import { effect, getOwner, runWithOwner } from "@zakkster/lite-signal";

/**
 * Package version. Kept in three-place sync with package.json and CHANGELOG.md.
 * @type {string}
 */
export const VERSION = "1.1.0";

// -----------------------------------------------------------------
// 1. GLOBAL AUTO-DISPOSER (Internal)
// -----------------------------------------------------------------

/**
 * Per-node list of teardown functions, stored under a Symbol so it never
 * collides with user properties and is invisible to `for...in` / `JSON`.
 * @type {symbol}
 * @private
 */
const DISPOSABLES = Symbol("lite_disposables");

/**
 * Marker class added to any element that owns disposables. Lets the observer
 * find bound descendants of a removed subtree in one `getElementsByClassName`
 * call instead of a recursive walk.
 * @type {string}
 * @private
 */
const BIND_CLASS = "__lite_bind";

/** Lazily armed on the first binding. @type {boolean} @private */
let isObserverActive = false;

/**
 * Single document-level observer. On every batch of mutations it scans removed
 * nodes and tears down any bindings they (or their bound descendants) own.
 * @private
 */
const observer =
    typeof MutationObserver !== "undefined"
        ? new MutationObserver((mutations) => {
              const mutLen = mutations.length;
              for (let i = 0; i < mutLen; i++) {
                  const removed = mutations[i].removedNodes;
                  const remLen = removed.length;
                  for (let j = 0; j < remLen; j++) {
                      const node = removed[j];
                      if (node.nodeType === 1) cleanupNodeAndChildren(node);
                  }
              }
          })
        : null;

/**
 * Observer entry point. Bails if the node was removed and re-inserted within
 * the same task (e.g. a `keyed` reorder or pooled recycle): by the time this
 * microtask runs the node is connected again and its bindings are live, so
 * tearing them down would silently kill a still-mounted element.
 *
 * @param {Element} rootNode  A node reported in a mutation's `removedNodes`.
 * @private
 */
function cleanupNodeAndChildren(rootNode) {
    // Same-tick re-insertion guard. `isConnected` is true iff the node is still
    // (or again) attached to the document, which is exactly the recycle case.
    if (rootNode.isConnected) return;
    disposeSubtree(rootNode);
}

/**
 * Synchronously run the disposables owned by `rootNode` and every bound
 * descendant. Called by the observer (genuine removal) and by {@link keyed}
 * (deterministic, immediate teardown before pooling/reordering).
 *
 * @param {Element} rootNode
 * @private
 */
function disposeSubtree(rootNode) {
    if (rootNode[DISPOSABLES] !== undefined) runDisposables(rootNode);

    const boundChildren = rootNode.getElementsByClassName(BIND_CLASS);
    // Iterate backwards: `runDisposables` removes BIND_CLASS, which mutates this
    // live HTMLCollection. Removing the highest live index never reshuffles the
    // lower ones, so a descending walk visits every element exactly once.
    for (let i = boundChildren.length - 1; i >= 0; i--) {
        runDisposables(boundChildren[i]);
    }
}

/**
 * Run and clear every disposable on a single node. Idempotent: a second call
 * (e.g. observer firing after a manual teardown) is a no-op because the list
 * is cleared and the marker class removed on the first pass.
 *
 * @param {Element} node
 * @private
 */
function runDisposables(node) {
    const fns = node[DISPOSABLES];
    if (fns !== undefined) {
        const len = fns.length;
        for (let i = 0; i < len; i++) {
            try {
                fns[i]();
            } catch (err) {
                // One bad disposer must not strand the rest.
                console.error("lite-signal-dom: error during binding disposal", err);
            }
        }
        node[DISPOSABLES] = undefined;
        if (node.nodeType === 1) node.classList.remove(BIND_CLASS);
    }
}

/**
 * Register a teardown function against a node and arm the observer if needed.
 * @param {Node} node
 * @param {() => void} disposeFn
 * @private
 */
function trackDisposal(node, disposeFn) {
    if (!isObserverActive && observer !== null) {
        // document.body may not exist yet if a binding is created from a
        // head-blocking script; guard so we don't throw on observe(null).
        const target = document.body || document.documentElement;
        if (target) {
            observer.observe(target, { childList: true, subtree: true });
            isObserverActive = true; // single-threaded: no race possible
        }
    }

    if (node[DISPOSABLES] === undefined) {
        node[DISPOSABLES] = [];
        if (node.nodeType === 1) node.classList.add(BIND_CLASS);
    }
    node[DISPOSABLES].push(disposeFn);
}

/**
 * Remove a single disposable from a node without disturbing its siblings.
 * Used by the manual disposers so calling one twice -- or after the node has
 * already left the DOM -- is safe.
 * @param {Node} node
 * @param {() => void} disposeFn
 * @private
 */
function untrackDisposal(node, disposeFn) {
    const fns = node[DISPOSABLES];
    if (fns !== undefined) {
        const idx = fns.indexOf(disposeFn);
        if (idx > -1) fns.splice(idx, 1);
        if (fns.length === 0) {
            node[DISPOSABLES] = undefined;
            if (node.nodeType === 1) node.classList.remove(BIND_CLASS);
        }
    }
}

// -----------------------------------------------------------------
// 2. BINDING PRIMITIVES
// -----------------------------------------------------------------

/**
 * Core binding factory. Wraps `computeFn` in an effect, registers it for both
 * automatic (observer) and manual disposal, and returns an idempotent manual
 * disposer that also untracks itself from the node.
 *
 * @param {Node} node
 * @param {() => void} computeFn  Reactive body; allocated once by the caller.
 * @returns {() => void} Idempotent dispose handle.
 * @private
 */
function createBinding(node, computeFn) {
    const effectDispose = effect(computeFn);
    trackDisposal(node, effectDispose);
    return () => {
        effectDispose();
        untrackDisposal(node, effectDispose);
    };
}

/**
 * Bind a node's `textContent` to a reactive getter.
 *
 * @example
 *   const name = signal("world");
 *   bindText(el, () => `hello ${name()}`);
 *   name.set("twitch"); // el.textContent updates synchronously
 *
 * @param {Node} node          Target node (element or text node).
 * @param {() => unknown} getter Reactive read; result is coerced to a string.
 * @returns {() => void}       Idempotent dispose handle.
 */
export function bindText(node, getter) {
    return createBinding(node, () => {
        node.textContent = getter();
    });
}

/**
 * Bind a node's `innerHTML` to a reactive getter.
 *
 * WARNING: **UNSAFE.** The result is parsed as HTML. Never pass unsanitised
 * user-controlled strings -- use {@link bindText} for untrusted content.
 *
 * @param {Element} node
 * @param {() => string} getter
 * @returns {() => void} Idempotent dispose handle.
 */
export function bindHTMLUnsafe(node, getter) {
    return createBinding(node, () => {
        node.innerHTML = getter();
    });
}

/**
 * Bind an HTML attribute to a reactive getter. `null`/`undefined`/`false`
 * remove the attribute; `true` sets it to the empty string (boolean attribute);
 * anything else is coerced to a string value.
 *
 * @example
 *   bindAttr(input, "disabled", () => isLocked());      // boolean attr
 *   bindAttr(a, "href", () => `/u/${userId()}`);        // value attr
 *
 * @param {Element} node
 * @param {string} attr
 * @param {() => unknown} getter
 * @returns {() => void} Idempotent dispose handle.
 */
export function bindAttr(node, attr, getter) {
    return createBinding(node, () => {
        const val = getter();
        if (val == null || val === false) node.removeAttribute(attr);
        else node.setAttribute(attr, val === true ? "" : val);
    });
}

/**
 * Bind a DOM **property** (not attribute) to a reactive getter -- e.g.
 * `value`, `checked`, `selectedIndex`. Use this for form state and any
 * property whose live value diverges from its initial attribute.
 *
 * @example
 *   bindProp(input, "value", () => draft());
 *
 * @param {Element} node
 * @param {string} prop
 * @param {() => unknown} getter
 * @returns {() => void} Idempotent dispose handle.
 */
export function bindProp(node, prop, getter) {
    return createBinding(node, () => {
        node[prop] = getter();
    });
}

/**
 * Toggle a single class on/off from a reactive boolean getter. Leaves all
 * other classes on the element untouched.
 *
 * @example
 *   bindClass(row, "is-active", () => row.id === selectedId());
 *
 * @param {Element} node
 * @param {string} className
 * @param {() => unknown} getter Truthy -> add class, falsy -> remove.
 * @returns {() => void} Idempotent dispose handle.
 */
export function bindClass(node, className, getter) {
    return createBinding(node, () => {
        if (getter()) node.classList.add(className);
        else node.classList.remove(className);
    });
}

/**
 * Bind a single inline style property to a reactive getter. `null`/`undefined`
 * resets the property to its stylesheet value.
 *
 * @example
 *   bindStyle(bar, "width", () => `${pct()}%`);
 *   bindStyle(box, "transform", () => `translateX(${x()}px)`);
 *
 * @param {ElementCSSInlineStyle} node
 * @param {string} styleProp camelCase or kebab-case CSS property.
 * @param {() => (string | number | null | undefined)} getter
 * @returns {() => void} Idempotent dispose handle.
 */
export function bindStyle(node, styleProp, getter) {
    return createBinding(node, () => {
        const val = getter();
        node.style[styleProp] = val == null ? "" : val;
    });
}

/**
 * Show/hide a node via `style.display` from a reactive boolean getter. When
 * shown, `display` is set to `displayStyle` (default `""`, i.e. the element's
 * stylesheet default); when hidden it is set to `"none"`.
 *
 * @example
 *   bindShow(spinner, () => isLoading());
 *   bindShow(grid, () => hasItems(), "grid");
 *
 * @param {ElementCSSInlineStyle} node
 * @param {() => unknown} getter        Truthy -> shown.
 * @param {string} [displayStyle=""]    `display` value to use when shown.
 * @returns {() => void} Idempotent dispose handle.
 */
export function bindShow(node, getter, displayStyle = "") {
    return createBinding(node, () => {
        node.style.display = getter() ? displayStyle : "none";
    });
}

// -----------------------------------------------------------------
// 3. EVENT BINDING HELPER
// -----------------------------------------------------------------

/**
 * Events that default to `{ passive: true }` so they never block scrolling.
 * @type {Set<string>}
 * @private
 */
const PASSIVE_EVENTS = new Set(["touchstart", "touchmove", "wheel", "mousewheel"]);

/**
 * Attach an event listener whose lifetime is tied to the node's presence in
 * the DOM, mirroring the binding primitives. Touch/wheel events default to
 * passive; pass explicit `options` to override.
 *
 * @example
 *   bindOn(button, "click", () => count.update(n => n + 1));
 *   bindOn(scroller, "wheel", onWheel);                 // passive by default
 *   bindOn(scroller, "wheel", onWheel, { passive: false }); // opt out
 *
 * @param {EventTarget} node
 * @param {string} eventName
 * @param {EventListenerOrEventListenerObject} handler
 * @param {boolean | AddEventListenerOptions} [options]
 * @returns {() => void} Idempotent dispose handle.
 */
export function bindOn(node, eventName, handler, options) {
    const opts = options !== undefined ? options : { passive: PASSIVE_EVENTS.has(eventName) };
    node.addEventListener(eventName, handler, opts);

    const disposeFn = () => node.removeEventListener(eventName, handler, opts);
    trackDisposal(node, disposeFn);

    return () => {
        disposeFn();
        untrackDisposal(node, disposeFn);
    };
}

// -----------------------------------------------------------------
// 4. ECS-STYLE KEYED LIST RENDERER
// -----------------------------------------------------------------

/**
 * @typedef {object} KeyedView
 * @property {Element} element            The rendered element.
 * @property {() => void} dispose         Teardown for this item's own bindings.
 * @property {number} [seen]              Internal mark-sweep stamp. Owned by
 *                                        {@link keyed} after the view is returned;
 *                                        do not read or write it.
 */

/**
 * Keyed list reconciler -- the reactive analogue of an ECS entity table.
 *
 * Reacts to a signal that returns an array. On every change it diffs the new
 * list against the mounted views **by key**, reusing the DOM element for any
 * key that survives and recycling removed elements through an internal pool so
 * `renderFn` can reset them instead of allocating new nodes.
 *
 * **Zero-GC steady state.** The diff is a three-pass mark-and-sweep keyed by an
 * integer epoch -- no `Set`, no array of keys, no iterator objects allocated per
 * update. The only persistent structures (a `Map`, a pool array, a key scratch
 * array) are allocated once at registration and reused for the lifetime of the
 * list. Adding/removing/reordering N items costs zero JS-heap allocation beyond
 * whatever `renderFn` does for genuinely new keys.
 *
 * **Per-item reactivity is independent.** `renderFn`'s reads are untracked, so
 * the list effect only re-runs when the *list itself* changes. Fine-grained
 * updates inside a row (text, classes, ...) come from the bindings `renderFn`
 * sets up, which react on their own.
 *
 * **Key uniqueness.** Keys must be unique within a render. Duplicate keys
 * collapse to a single view (last position wins), exactly as a `Map` would.
 *
 * @example
 *   const items = signal([{ id: 1, label: "a" }]);
 *   keyed(
 *     listEl,
 *     items,                       // reactive source returning the array
 *     (item) => item.id,           // stable key
 *     (item, recycled) => {        // render or re-render a row
 *       const li = recycled || document.createElement("li");
 *       const stop = bindText(li, () => item.label);
 *       return { element: li, dispose: stop };
 *     }
 *   );
 *   items.set([{ id: 2, label: "b" }, { id: 1, label: "a" }]); // diffed by id
 *
 * @param {Element} parent                       Container element.
 * @param {() => any[]} listGetter               Reactive read returning the list.
 * @param {(item: any) => string | number} keyFn Stable, unique per-item key.
 * @param {(item: any, recycledElement: Element | null) => KeyedView} renderFn
 *        Builds (or resets a recycled) element and returns it with a disposer.
 * @returns {() => void} Disposes the whole list: tears down every view, removes
 *                       every element and the internal anchor. Idempotent.
 */
export function keyed(parent, listGetter, keyFn, renderFn) {
    /** @type {Map<string|number, KeyedView>} */
    const activeViews = new Map();
    /** @type {Element[]} Recycled elements, reset on reuse by renderFn. */
    const elementPool = [];
    /** Reused per-render key cache; grows monotonically, never reallocated. */
    const keyScratch = [];
    /** Monotonic render counter used as the mark-sweep stamp. */
    let epoch = 0;

    // Stable comment node isolates the managed range from sibling DOM mutations
    // and gives us a fixed insertion sentinel.
    const anchor = document.createComment("lite-keyed-anchor");
    parent.appendChild(anchor);

    // Sweep callback, allocated ONCE. Removing a view: synchronous teardown,
    // detach, return the element to the pool, drop the map entry. Deleting the
    // current entry from inside Map.forEach is well-defined and safe.
    const sweepStale = (view, key, map) => {
        if (view.seen !== epoch) {
            disposeSubtree(view.element);
            if (view.element.parentNode === parent) parent.removeChild(view.element);
            elementPool.push(view.element);
            map.delete(key);
        }
    };

    // SD-05: stable per-keyed ownership scope for the row bindings.
    // The reconcile below runs inside a list `effect` (createBinding). lite-signal
    // (>= 1.2.0) auto-disposes a nested effect when its OWNER re-runs, so bindings
    // created as children of the list effect would be torn down on every list
    // change and never recreated for moved-but-surviving keys -- the row freezes.
    // Instead we capture a one-shot owner that never re-runs and adopt each row's
    // effects into it via `runWithOwner`. Row effects then outlive list re-runs,
    // and disposing this owner in teardown cascade-disposes EVERY row effect --
    // including any a throwing `renderFn` created partially -- so teardown stays a
    // fail-closed backstop. (`getOwner`/`runWithOwner` require lite-signal >= 1.5.0.)
    let rowOwner;
    const rowOwnerDispose = effect(() => { rowOwner = getOwner(); });
    // Register the owner's teardown for auto-disposal too, so a bare DOM removal
    // of `parent` (no explicit keyed disposer call) reclaims it via the observer's
    // disposeSubtree, not just the manual teardown below. Without this the owner
    // effect is stranded on the auto-dispose path -- one leaked node per instance.
    // Idempotent with the explicit rowOwnerDispose() in teardown.
    trackDisposal(parent, rowOwnerDispose);

    const listDispose = createBinding(parent, () => {
        const list = listGetter();
        const len = list.length;
        epoch = (epoch + 1) | 0;

        // Release stale key references when the list shrinks: indices >= len
        // would otherwise pin keys (strings/objects) from a previous, longer
        // render for the lifetime of this binding. Only truncate (never grow
        // here) so the array stays packed -- pass 1 extends it contiguously.
        if (keyScratch.length > len) keyScratch.length = len;

        // PASS 1 -- mark surviving views; cache keys so keyFn runs once per item.
        for (let i = 0; i < len; i++) {
            const key = keyFn(list[i]);
            keyScratch[i] = key;
            const view = activeViews.get(key);
            if (view !== undefined) view.seen = epoch;
        }

        // PASS 2 -- sweep views not marked this epoch (zero per-call allocation).
        if (activeViews.size > 0) activeViews.forEach(sweepStale);

        // PASS 3 -- place every item in order, creating missing views from the
        // pool. Walk back-to-front so each element is inserted before the one
        // that should follow it, using the anchor as the tail sentinel.
        let insertCursor = anchor;
        for (let i = len - 1; i >= 0; i--) {
            const key = keyScratch[i];
            let view = activeViews.get(key);

            if (view === undefined) {
                const el = elementPool.length > 0 ? elementPool.pop() : null;
                // Adopt the row's bindings into the stable per-keyed owner (see
                // SD-05 note above), not the re-running list effect. runWithOwner
                // also nulls the tracking observer for renderFn's direct reads
                // (as the old `untrack` did), so building a row does not link the
                // list effect; the row's own bindings re-establish their scopes.
                view = runWithOwner(rowOwner, () => renderFn(list[i], el));
                view.seen = epoch;
                activeViews.set(key, view);
                // Hook the row's own teardown into the global auto-disposer so a
                // plain DOM removal of this element also cleans it up.
                trackDisposal(view.element, view.dispose);
            }

            if (view.element.nextSibling !== insertCursor) {
                parent.insertBefore(view.element, insertCursor);
            }
            insertCursor = view.element;
        }
    });

    return () => {
        listDispose();
        // Deterministic full teardown -- don't leave orphaned views for the
        // observer to find later (it might never fire if `parent` is detached
        // wholesale rather than per-child).
        activeViews.forEach((view) => {
            disposeSubtree(view.element);
            if (view.element.parentNode === parent) parent.removeChild(view.element);
        });
        activeViews.clear();
        elementPool.length = 0;
        if (anchor.parentNode === parent) parent.removeChild(anchor);
        // Disposing the stable owner cascade-disposes any row effect the manual
        // sweep above did not reach (e.g. bindings left by a throwing renderFn),
        // so no row effect can outlive the keyed instance. Idempotent. Untrack it
        // from `parent` too so an explicitly-disposed keyed leaves no stale entry
        // if the caller keeps or re-keys the same parent element.
        rowOwnerDispose();
        untrackDisposal(parent, rowOwnerDispose);
    };
}
