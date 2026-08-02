# lite-router + lite-signal-dom + lite-signal-gsap — merged roadmap

The three per-package roadmaps, evaluated against the published tarballs and
merged with the findings from the audit.

## 0. Verdicts

| Roadmap | Verdict | Why |
| --- | --- | --- |
| **lite-signal-dom** | **Approve — one correction, one insertion** | Sound plan, and its torture list independently names SD-01. But v1.1 proposes *pinning* the raw-text-node limitation, and that limitation is deletable — same root cause as an unlisted leak. Fix instead of pin. |
| **lite-router** | **Approve — essentially unchanged** | Independently found the `queryParam` cache hazard with the right decision already leaning. All three audit findings slot inside items it already plans. Best ledger section of the three. |
| **lite-signal-gsap** | **Approve — one state correction** | Says "Current state: v1.1". npm and GitHub `main` are both **1.0.1**; v1.1 exists nowhere. Technical plan is the most disciplined of the three. |
| **All three** | **One shared gap** | None mentions that `@zakkster/lite-signal` sits in `dependencies` rather than as a peer. The only finding here with ecosystem-wide blast radius. X-PEER goes first. |

### State corrections

| Roadmap claim | Verified |
| --- | --- |
| gsap "Current state: v1.1" | **1.0.1** on npm *and* GitHub `main`; published versions are 1.0.0 and 1.0.1 only. The state description is otherwise accurate except line count (says ~250; `SignalGsap.js` is 382), so this reads as a numbering slip rather than unpushed work. Resolve before the first publish — three-place sync cannot start from an ambiguous baseline. |
| router "Trunk signals (`pathname`, `hash`, private raw query)" | `rawQuery` is private; **`query` is a public export** — `computed(() => new URLSearchParams(rawQuery()))`, exported from the barrel. v1.2's reference to "the `query()` full-parse escape hatch" is correct; the state line understates the surface. |
| dom "Current state: v1.x" | 1.0.1, 516 lines, eight `bind*` primitives + `keyed`. Accurate. |
| router "Current state: v1.0" | 1.0.0, 254 lines across four files. Accurate. |

GitHub `main` equals npm for all three — no unpublished work anywhere.

---

## 1. Shared, and it goes first

===============================================================================
# X-PEER — patch all three: lite-signal is a peer, not a dependency
===============================================================================

```markdown
---
package: ["@zakkster/lite-router", "@zakkster/lite-signal-dom", "@zakkster/lite-signal-gsap"]
version_target: 1.0.1 / 1.0.2 / 1.0.2
status: planned
blocks: [everything below]
---

# All three — a reactive graph cannot be a transitive dependency

PURPOSE
  A signal graph is module-instance state. Two copies of lite-signal are two
  graphs, and a signal from one does not drive an effect from the other.
  Demonstrated with two module instances:

    effect from graph B saw 1 run(s)     <- the initial run, then nothing
    same-graph control: 2 runs           <- sanity

  `a.set(1); a.set(2)` produce zero reruns. No error, no warning — every
  binding, every route signal, every tween silently freezes at its initial
  value.

  It does not fire today: npm dedupes `^1.1.0`, `^1.1.1` and `^1.1.2` to one
  copy at 1.4.2, verified in a clean install. It fires the day lite-signal
  ships 2.0.0, and lite-signal currently carries `rc` 1.5.0-rc.1,
  `beta` 1.6.0-beta and `preview` 1.9.0-preview.3.

  `@zakkster/lite-persist` already declares it correctly
  (`peerDependencies: { "@zakkster/lite-signal": "^1.1.5" }`). Three packages
  need to match it.

TASKS
  - Move `@zakkster/lite-signal` from `dependencies` to `peerDependencies` in
    all three; add to `devDependencies` so the suites still resolve. Peer for
    consumers, dev for CI — the pairing lite-persist and lite-ambient-fx use.
  - Widen the range: `^1.1.x` was written against a 1.1 three minors old. Floor
    at the oldest version whose API you use, ceiling at the next major. Do not
    pin a floor above `latest`.
  - **`gsap` becomes a peer too.** Two GSAP instances mean two tickers and two
    plugin registries, and a consumer who already has GSAP should not receive a
    second copy at a version they did not choose. Record the licensing note:
    GSAP does not ship under MIT, and a hard dependency puts a non-MIT package
    in an MIT package's required install tree. As a peer it is the consumer's
    choice and the consumer's licence to accept.
  - `CHANGELOG.md` in all three and in `files[]`; `VERSION` const; three-place
    sync. All three already have `node --test` and `engines >= 18` — the
    testing law is satisfied, only the release furniture is missing.
  - **Install-shape test in each**, because this bug only appears in a
    consumer's tree: create a signal from the app's lite-signal, an effect from
    the package's, assert the effect reruns. That test is the finding, made
    executable.

ASSERTIONS
  - All three manifests: lite-signal in `peerDependencies` + `devDependencies`,
    absent from `dependencies`. Same for gsap.
  - Existing suites green, unchanged; hash parity on every exported function.
  - The cross-graph test passes on a deduped install and **fails** on a
    deliberately duplicated tree — construct the two-copy tree in CI, or the
    gate cannot fail and proves nothing.
  - `npm pack --dry-run` includes CHANGELOG.md in all three.

NON-GOALS
  No behaviour change, no API change. Three manifest patches.

DONE WHEN
  one graph is guaranteed by the manifest, and the two-graph case fails loudly
```

---

## 2. lite-signal-dom

**Verdict: approve.** The governing law — *"bytes in a hot body, not
instructions; every item that touches `sharedOnUpdate`-class code paths must
prove it adds zero bytes to the no-change fast path, or it goes to the
ledger"* — is the right frame and should stay verbatim at the top.

### 2.1 What the roadmap already got right

- **v1.1's torture list names SD-01.** *"MutationObserver storm — mass
  synchronous removals, nested subtree teardowns, **detach→reattach chains
  across multiple tasks**; pool-return count must equal binding count
  exactly."* That is exactly the case that fails, and the assertion shape is
  correct. **One correction to the framing:** the roadmap treats it as
  verification. It is a bug — `if (rootNode.isConnected) return;` is evaluated
  in the observer microtask, so a node removed this task and re-inserted next
  task is torn down and then re-inserted looking mounted, and never updates
  again. Verified. Write the test expecting failure, then fix.
- **SPP `stats()` with an "observer teardown counter"** is the leak gate the
  whole stack needs. lite-signal 1.4.2 already exports `hasObservers`,
  `forEachObserver` and `stats`, and nothing in these three packages uses them —
  "this signal has zero observers after teardown" is available today and
  unasserted. Build it here; lite-router and lite-signal-gsap reuse it.
- **v1.2's LIS constraints are correctly drawn**: preallocated grow-only
  `Int32Array` scratch, power-of-2 sizing, bitmask indexing, *"the no-move case
  must remain byte-identical in cost (LIS pass skipped when pass 1 detects
  order preservation)"*, and *"accept only if shuffle improves without
  regressing append/no-move."* A gate with a fail condition, which is more than
  most rewrites get.
- **All four ledger rejections are correct**, and `cssText` in particular —
  *"destroys per-property equality gating"* — is the kind of reasoning that
  stops an idea coming back.

### 2.2 The correction: do not pin the text-node limitation, delete it

v1.1 proposes: *"The raw-text-node auto-disposal limitation gets a pinning test
so the documented behavior can't silently change."*

That limitation and an unlisted leak are **the same bug**. The disposer's
descendant index is a real CSS class, `__lite_bind`, and `disposeSubtree` finds
bound descendants with `rootNode.getElementsByClassName(BIND_CLASS)`. Three
verified consequences:

- **SD-04 (the documented limitation).** `runDisposables` guards
  `if (node.nodeType === 1) node.classList.remove(BIND_CLASS)` — a text node
  gets `DISPOSABLES` but can never be marked, and `getElementsByClassName`
  returns only Elements. A `bindText` on a raw `Text` node is **never**
  auto-disposed when an ancestor is removed. Reproduced: bind a text node,
  remove its parent, `s.set('v2')` → the effect still runs.
- **SD-02 (not in the roadmap).** Ordinary application code assigning
  `el.className = 'card highlighted'` erases the marker from an *element*. It
  becomes invisible to the same scan, and when an ancestor is removed its effect
  keeps running on a detached node for the life of the page. Reproduced.
- **SD-03.** `getAttribute('class')` returns `"__lite_bind"` on every bound
  element, leaking into CSS selectors, serialized HTML and snapshot tests. It is
  also the cause of SD-02.

One fix closes all three, and **the package already has the mechanism**:
disposables live under a `Symbol` precisely because a Symbol cannot be
clobbered. Index descendants the same way — a `TreeWalker` over the removed
subtree with `SHOW_ELEMENT | SHOW_TEXT`, checking for the Symbol. Text nodes
become visible, application code cannot interfere, and the class leaves the DOM.

A documented limitation becomes a shipped feature, and the pinning test becomes
a regression test for behaviour that now works.

### 2.3 Merged ladder

`SD1 (new, v1.1) → SD2 (their v1.1) → SD3 (their v1.2) → SD4 (their v1.3)`

SD1 is inserted **before** the infrastructure release because SD2's torture
suite is largely a test for SD1's bugs, and SD3's LIS work touches reconciler
pass 3 — the same code the disposal rewrite sits under. Surgery, then
instruments, then optimisation.

===============================================================================
# SD1 — lite-signal-dom v1.1.0 — the disposer stops trusting a CSS class
===============================================================================

```markdown
---
package: "@zakkster/lite-signal-dom"
version_target: 1.1.0
status: planned
findings: [SD-01, SD-02, SD-03, SD-04]
depends_on: [X-PEER]
blocks: [SD2]
---

# lite-signal-dom — one root cause, four symptoms, one fix

PURPOSE
  The auto-disposer is well built — one document-level MutationObserver,
  disposables under a Symbol, manual disposers everywhere, a same-tick
  re-insertion guard that works. Every problem is in the one place the design
  reaches outside the Symbol: a real CSS class used as the descendant index.

TASKS
  - **Replace the marker.** `TreeWalker` over the removed subtree with
    `SHOW_ELEMENT | SHOW_TEXT`, checking for the `DISPOSABLES` Symbol. Removes
    the class from the DOM (SD-03), makes text nodes disposable (SD-04), makes
    the index unclobberable (SD-02).
    **Measure before assuming the class was needed.** The scan is bounded by the
    removed subtree, not the document, and the common removal is small. If a
    large-subtree walk really is slower, keep a *non-class* index — a
    module-level `Set` of bound nodes is unclobberable and still O(bound) — and
    record the number.
    Note the existing descending-HTMLCollection walk (*"`runDisposables`
    removes BIND_CLASS, which mutates this live HTMLCollection"*) disappears
    with the class; a TreeWalker over a detached subtree has no live-collection
    hazard. Simpler, not just safer.
  - **SD-01 — the re-attach window.** Decide the contract and record it:
      A. **Defer teardown one macrotask.** Widens the guard to cover
         `remove()` / `await` / `append()`. Cheap; covers the modal and
         pooled-row cases the guard exists for.
      B. **Explicit `detach(node)` / `reattach(node)`** for deliberate movers;
         anything else removed is torn down at once.
      C. Re-arm on `addedNodes` — likely a rejection to record, since a binding
         closing over a getter is not reconstructible from the DOM.
    Recommendation: A, with B's `detach` as an escape hatch for callers pooling
    across frames.
    **Whichever lands, the current behaviour must stop being silent.** A node
    re-inserted with dead bindings has no signal at all today; in checked mode
    it should warn.
  - Document disposal as a state machine in README and llms.txt —
    bound → removed → (window) → disposed — and what re-insertion does at each
    point. Delete the text-node limitation section.

HOT PATH
  Bindings are created and torn down once each; the observer runs per mutation
  batch. Correctness wins here — but the observer callback must still not
  allocate per removed node, because a large list teardown is exactly when it
  runs.

ASSERTIONS
  - `el.className = 'anything'` after binding does not affect disposal. **Fails
    on 1.0.1** — prove both directions.
  - `bindText` on a raw `Text` node is disposed when an ancestor is removed.
    **Fails on 1.0.1** — prove both directions.
  - `getAttribute('class')` on a bound element with no user classes is `null`.
  - Detach and re-attach across a task boundary: the binding is live afterwards,
    or the documented contract fired and said so.
  - The same-tick recycle guard still works — it does today, do not regress it.
  - Nested bound descendants at depth 3+ all tear down, with and without user
    classes on intermediate nodes, and with text nodes interleaved.
  - Manual disposers remain idempotent; disposing before removal does not
    double-dispose when the observer fires.
  - Zero allocation in the observer callback for a 1000-node subtree removal.

DONE WHEN
  the disposer depends on nothing the application can overwrite, text nodes are
  first-class, and all four symptoms have a test that failed before the fix
```

===============================================================================
# SD2 — lite-signal-dom v1.2.0 — hardening & protocol alignment
===============================================================================

```markdown
---
package: "@zakkster/lite-signal-dom"
version_target: 1.2.0
status: planned
depends_on: [SD1]
blocks: [SD3]
---

# lite-signal-dom — the infrastructure release, now testing a fixed disposer

Their v1.1, with the torture list sharpened by what SD1 found.

TASKS
  - **Bench protocol v3 adoption.** Machine-stamped provenance, cold-process
    isolation, IQR spread flagging, VersionMatrix publish gate. Both machines —
    M4 Pro for throughput, Intel for small-regression resolution.
    `bench/bench-results.json` becomes protocol-conformant.
  - **Torture suite.**
      * **Fuzzed keyed streams** — random interleavings of permute / insert /
        remove / duplicate-key / empty / regrow against a naive reference
        reconciler for final DOM order equality. 10k+ ops per seed, multiple
        seeds, seed printed on failure.
      * **MutationObserver storm** — mass synchronous removals, nested subtree
        teardowns, detach→reattach chains across multiple tasks. **Pool-return
        count must equal binding count exactly.** Now regression tests for SD1
        rather than discovery.
      * **Text-node coverage** replaces the old limitation-pinning test: bound
        text nodes interleaved with elements at every depth, all disposed.
      * **The className-clobber case** as a permanent regression test.
  - **SPP probe via `@zakkster/lite-scope`.** Export `stats()`: live bindings by
    type, keyed view counts, pool depth per list, observer teardown counter.
    **Add the observer-count assertion** on top: after tearing down N bindings,
    `hasObservers(sig)` is false. That names the leak instead of inferring it
    from a heap number, and it is the gate LR1 and SG1 reuse.
  - **Leak soak**: 4096 mount/unmount cycles, observer count returns to zero
    every cycle, heap flat across cycles. A control with disposal disabled must
    fail it.
  - **SVG namespace support.** Verify `bindAttr` against SVG; add namespaced
    handling (`xlink:href` legacy) if needed. Expected: a few cold-path lines or
    a doc note.
  - **Recipes.** Forms (`bindProp` + `bindOn`), nested keyed, lite-router
    integration (route-driven views), FLIP-style move animation via
    lite-signal-gsap — recipe, explicitly not an API.

GATE
  Torture green on both machines, VersionMatrix pass, README claim
  re-verification (`npm run verify` mirroring lite-router's).

DONE WHEN
  the instruments exist, SD1's fixes have permanent regression tests, and the
  observer-count leak gate is reusable by the other two packages
```

===============================================================================
# SD3 — lite-signal-dom v1.3.0 — Reconciler II: minimal moves + delegation
===============================================================================

```markdown
---
package: "@zakkster/lite-signal-dom"
version_target: 1.3.0
status: planned
depends_on: [SD2]
---

# lite-signal-dom — LIS placement and event delegation

Their v1.2, unchanged in scope. Both items are correctly argued; the additions
are sequencing and one disposal interaction.

TASKS
  - **LIS minimal-move placement (pass 3 upgrade).** Longest increasing
    subsequence of surviving positions in preallocated grow-only `Int32Array`
    scratch, power-of-2 sizing, bitmask indexing; move only nodes outside it.
    Constraints as written: zero allocation per update, and the no-move case
    byte-identical in cost with the LIS pass skipped when pass 1 detects order
    preservation.
    **Sequencing note:** this touches the same pass as SD1's disposal rewrite
    and interacts with node pooling. SD1 first is not negotiable — an LIS diff
    landing on top of a disposer rewrite makes a bisect impossible.
  - **Event delegation for keyed rows.** One container listener instead of N
    per-row `bindOn` handlers. `WeakMap` element→item populated at claim time
    (cold path), `delegateOn(listHandle, event, (item, e) => …)`, manual
    container-relative walk with no allocation.
    **One addition:** delegation changes the disposal story — a delegated
    listener is owned by the container, not the row, so removing a row must not
    leave a stale `WeakMap` entry reachable through the item. Assert that a
    row's item is collectable after removal.
  - **`bindValue(input, sig)`** — ledger-reviewed, pure `bindProp` + `bindOn`,
    ~10 cold-path lines. Accept if forms show up in REFORGE/RESEAM dogfooding;
    otherwise a recipe.

GATE
  krausest-style local workloads (create-1k, swap, shuffle, select-row) added to
  the bench harness as the acceptance battery for the LIS work. Bench
  shuffle-64, swap-2, rotate-1 before/after; accept only if shuffle improves
  without regressing append/no-move.

DONE WHEN
  LIS passes its own accept-condition or is rejected on its own numbers
```

===============================================================================
# SD4 — lite-signal-dom v1.4.0 — proof & visibility
===============================================================================

```markdown
---
package: "@zakkster/lite-signal-dom"
version_target: 1.4.0
status: planned
depends_on: [SD3]
---

# lite-signal-dom — the krausest entry

Their v1.3, unchanged. Highest-leverage visibility item in the package, and the
framing is right: the DOM analogue of what js-reactivity-benchmark did for
lite-signal, which currently sits 4th of 21.

TASKS
  - **Official js-framework-benchmark (krausest) keyed implementation** using
    lite-signal + lite-signal-dom. A maintained fork with published numbers
    validates the reconciler claims externally even without a merged PR.
    Run it **after** SD3's LIS work — the benchmark is the argument for LIS, so
    publishing pre-LIS numbers spends the visibility on the weaker result.
  - **`keyedRange` / multi-list coexistence.** Verify the anchor comment's
    implication that multiple keyed lists plus static siblings can share a
    parent; formalize the guarantee; add tests. A second anchor for range end is
    one allocation at registration.
  - **mock-dom extraction (evaluate).** Candidate internal
    `@zakkster/lite-mock-dom` devDep for allocation-honest benches in
    lite-router and future DOM packages. Rejection-eligible — decide after a
    second consumer appears, which the roadmap already says.

DONE WHEN
  external numbers are published, or the fork exists and is maintained
```

**v2.0 horizon:** keep the roadmap's position exactly — no speculative breaking
changes; v2 exists only if dogfooding surfaces API-shape friction that cannot be
fixed additively, with `KeyedView`'s return shape the likeliest candidate.

---

## 3. lite-router

**Verdict: approve, essentially unchanged.** Best-structured of the three. All
three audit findings land *inside* items it already plans — the sign of a
roadmap that mapped its own surface correctly.

### 3.1 What it already got right

- **It independently found the `queryParam` cache hazard**, and the decision is
  already leaning correctly: *"either pin 'keys must be statically enumerable'
  as a documented invariant with a test, or add `disposeQueryParam(key)`.
  Leaning invariant + test (an eviction API invites misuse on live graphs)."*
  That reasoning is right — an eviction API on a live reactive graph is a
  footgun, and the memo cache itself is good design.
- **The ledger section is the strongest in the ecosystem.** *"Path-ranking trie
  — rejected by design; independent per-route computeds ARE the model; ranking
  implies the router owns match priority, which it deliberately doesn't."* A
  positioning argument doing real work, not a shrug.
- **"Positioning to protect"** — the URL as a fine-grained reactive graph,
  nothing else — is what makes every rejection self-evident. Keep verbatim.
- The `configure` lock borrowing lite-signal-gsap's pattern is exactly the kind
  of cross-package consistency that should be deliberate.

### 3.2 Three insertions, all inside planned items

- **LR-01 → goes with `setQuery`.** `query()` returns a `URLSearchParams` —
  correct, deliberate, documented in the source, and still a trap:
  `JSON.stringify(query())` is `{}`, `{...query()}` is `{}`, `query().sort` is
  `undefined`, and only `query().get('sort')` works. **I mis-read it as a bug on
  first pass**, which is the argument for documenting it loudly rather than
  against. `setQuery` is the natural companion release for a `queryObject()`
  convenience — decide whether it allocates per read or memoizes.
- **LR-03 → goes with `configure({ url })`.** `_resetRouter` is marked
  `@internal test-isolation utility` in the barrel comment and exported from the
  public barrel and the `.d.ts`. Since v1.1 already adds a test/SSR-oriented
  `configure({ url })`, that is the release to move `_resetRouter` to a
  `./testing` subpath (the pattern lite-ambient-fx uses for `./worker`) — or to
  keep it, drop `@internal`, and document it as supported. Simultaneously
  internal and exported is neither.
- **LR-04 → goes with `setQuery({ replace })`.** Two identical `navigate()`
  calls push two history entries; the back button then needs two presses to
  move. `{ replace }` is exactly the mechanism — decide whether an unchanged URL
  becomes a no-op, a `replaceState`, or stays as-is and is documented.

### 3.3 Merged ladder

The roadmap's own v1.1 / v1.2 / v1.3 structure survives intact. Only the task
lists grow.

===============================================================================
# LR1 — lite-router v1.1.0 — write-side ergonomics + typed params
===============================================================================

```markdown
---
package: "@zakkster/lite-router"
version_target: 1.1.0
status: planned
findings: [LR-01, LR-03, LR-04]
depends_on: [X-PEER]
---

# lite-router — v1.0 made reading surgical; make writing surgical too

TASKS (their list; insertions marked +)
  - **`setQuery(patch, { replace })`.** Surgical query writes preserving
    untouched keys; `null`/`undefined` deletes, everything else stringifies. One
    URLSearchParams build + one string per call — cold path, navigation
    frequency not frame frequency. The write-side mirror of `queryParam`.
  - **+ Decide what `{ replace }` means for an unchanged URL** (LR-04). Two
    identical `navigate()` calls currently push two history entries. Collapse to
    a no-op, `replaceState`, or document that the caller guards. Assert
    `history.length` either way.
  - **+ `queryObject()` and the URLSearchParams trap** (LR-01). Put the trap in
    the first paragraph about `query` in README and llms.txt, with the
    wrong-and-right lines side by side. Then decide whether `queryObject()`
    ships and whether it allocates per read or memoizes.
  - **Template-literal param inference (.d.ts only).**
    `route('/users/:id/posts/:postId')` infers
    `Computed<{ id: string; postId: string } | null>`; catch-all `*` and
    no-param patterns infer `Computed<{} | null>`. Zero runtime bytes, pure
    recursive template-literal types. Highest DX-per-byte item on the roadmap.
  - **`configure({ url })`** for SSR and tests, locking after listeners attach —
    same lock pattern as lite-signal-gsap's `configure`.
  - **+ Relocate `_resetRouter`** (LR-03) in the same release, same concern: a
    `./testing` subpath export, or keep it, document it as supported, and drop
    the `@internal` marker.
  - **`basePath`** — prefix stripped from `pathname` on read, prepended by
    `navigate` on write. Needed for GitHub Pages demos and Twitch extension
    iframes served under a subpath. One config field, cold path.

ASSERTIONS
  - `setQuery` preserves untouched keys; `null` deletes; numbers and booleans
    stringify per the documented rule; `{ replace }` behaves per the decision.
  - Typed-param inference verified against **every pattern form in the README's
    pattern table** — the roadmap's own publish gate, kept.
  - `configure({ url })` seeds a full URL with no window; locks after listeners
    attach; a late call behaves per the recorded contract.
  - `basePath` round-trips: `navigate('/x')` under base `/app` produces `/app/x`
    in the URL and `/x` in the `pathname` signal.
  - Named tests for the three `URLSearchParams` forms that return empty, so the
    documented trap is executable.
  - `_resetRouter` is where the decision says it is, and the `.d.ts` agrees.
  - SD2's observer-count gate: after `interceptLinks()`'s disposer runs, no
    listeners and no observers remain; after `_resetRouter`, `paramCache` is
    empty and the trunk signals have no observers.

DONE WHEN
  writing the URL is as surgical as reading it, the types infer, and the three
  edges are decided and documented
```

===============================================================================
# LR2 — lite-router v1.2.0 — hash mode + a single guard
===============================================================================

```markdown
---
package: "@zakkster/lite-router"
version_target: 1.2.0
status: planned
depends_on: [LR1]
---

# lite-router — run everywhere the ecosystem's demos run

Their v1.2, unchanged. The motivation is concrete and correct: `file://` demos,
Twitch overlay iframes, and static hosting without rewrite rules are exactly the
environments the lite-* demo culture targets.

TASKS
  - **`mode: 'hash'`.** Full route + query surface after `#`
    (`#/users/42?sort=desc`). Same public signal API; only the sync layer
    differs (`hashchange`-driven, no history rewrites). The `hash` trunk signal
    is repurposed as the fragment-within-fragment — document those semantics
    precisely, because that is the one place the two modes' public surface
    diverges in meaning rather than in mechanism.
  - **`beforeNavigate(guard)`.** One synchronous slot: `false` cancels, a string
    redirects. Covers unsaved-changes and auth-redirect without a middleware
    pipeline. **Ledger constraint, kept verbatim:** it stays *one* hook (or a
    tiny array at most) — the moment it grows ordering semantics it is a
    framework and gets rejected.
  - **`queryParamAll(key) → Computed<string[]>`** — evaluate. The equality
    problem is the interesting part: array identity breaks the `Object.is` gate,
    so it needs a custom equals (length + element compare) or a join-string
    intermediate to preserve surgical propagation. If the equals machinery costs
    more bytes than the feature is worth, reject and document the `query()`
    full-parse escape hatch.

ASSERTIONS
  - Every LR1 assertion passes in **both** modes — the public API claim is that
    only the sync layer differs, so the suite must run twice.
  - `hash` semantics in hash mode pinned by name.
  - `beforeNavigate` returning `false`, a string, and `undefined` each behave as
    documented; a guard that throws does not wedge the router.
  - `queryParamAll` (if it ships) does not re-run on an unrelated key change —
    the whole point of the custom equals.

GATE
  **Hash mode ships only after at least one `file://`-opened demo in the
  ecosystem actually runs on it.** The roadmap's gate, kept — the right one,
  because hash mode's justification is entirely about environments that are hard
  to test in CI.

DONE WHEN
  both modes pass the same suite and a real file:// demo runs
```

===============================================================================
# LR3 — lite-router v1.3.0 — protocol, torture, proof
===============================================================================

```markdown
---
package: "@zakkster/lite-router"
version_target: 1.3.0
status: planned
findings: [LR-02]
depends_on: [LR2]
---

# lite-router — the discipline pass before the surface grows further

Their v1.3, unchanged, with LR-02's decision now explicit.

TASKS
  - **Bench protocol v3 + VersionMatrix publish gate.** Two-machine provenance;
    `bench-results.json` protocol-conformant. Extend the surgical-update
    benchmark to 50 and 100 widgets and publish the scaling curve — the ~N×
    claim deserves the plot.
  - **Torture suite.**
      * **Percent-encoding fuzz** — malformed escapes, unicode, `+`/space
        semantics, mixed-encoding params, asserting the never-throws fallback
        across thousands of generated URLs.
      * **Pattern fuzz** — generated patterns with regex metacharacters
        validated against a naive reference matcher for match/params equality.
      * **Event-storm ordering** — interleaved `popstate` / `hashchange` /
        `navigate` bursts; trunk signals must converge to `window.location`
        truth with no intermediate consumer seeing a torn state. Run in both
        modes after LR2.
      * **`queryParam` cache growth under dynamic keys** (LR-02). The roadmap's
        lean is correct: **pin "keys must be statically enumerable" as a
        documented invariant with a test**, rather than shipping
        `disposeQueryParam` — an eviction API on a live graph invites exactly
        the misuse it looks like it prevents. The test asserts growth is
        proportional to distinct keys and documents the consequence; 10k
        distinct keys is the scenario to measure and write down.
  - **Recipe docs.** lite-signal-dom integration (route-driven keyed views, nav
    highlighting via `route()` + `bindClass`), lazy view loading via dynamic
    `import()` inside a route effect, `whenAsync` guard/redirect patterns.

DONE WHEN
  the fuzzers are green, the scaling curve is published, and the cache invariant
  is a documented, tested contract rather than a property
```

**Ledger candidates: approve all five rejections as written** — nested route
resolver / outlets, path-ranking trie, async loaders, scroll restoration,
history `state` passthrough. The reasoning on each is sound and FAQ-as-ledger is
the right home.

---

## 4. lite-signal-gsap

**Verdict: approve, one state correction.** The most technically disciplined of
the three roadmaps — v1.4's ledger check in particular.

### 4.1 What it already got right — and one thing verified

- **The torture item is already correct about the pool.** *"Pool exhaustion
  under both growth policies — `throw` recoverability (no leaked proxy on the
  throwing path, already claimed but pin it under stress)."* **Verified: it is
  clean.** The 65th `tweenSignal` throws
  `"proxy pool exhausted (64). Use configure({ growthPolicy: 'grow' })"`, and:

  ```
  after throw          : liveTweens 64, pooledProxies 0     <- exactly 64, not 65
  after killTweensOf   : liveTweens 0,  pooledProxies 64
  recovery tween       : OK
  ```

  That is the atomic-capacity behaviour **lite-bvh's `insertLeaf` gets wrong**
  (finding B-01: throws with a node already consumed and orphaned, `nodeCount`
  corrupted, slot lost permanently). The roadmap's "already claimed but pin it"
  instinct is right, and there is a second deliverable in it — see SG1.
- **v1.4's ledger check is the best-disciplined item in any of the three
  roadmaps:** *"measure whether the constraint is actually reachable in real
  workloads … if unmeasurable even in a constructed worst case, reject and keep
  the doc note — a Map layer nobody needs is bytes."* A feature with a
  pre-declared rejection condition, which is exactly what lite-particles' SoA
  gate needed and what most rewrites lack.
- **Rejecting non-numeric interpolation** because *"pushing strings through
  `signal.set` per frame allocates per frame — a direct zero-GC violation"* is
  right, and redirecting to OKLCH numeric channels is the correct alternative.
- **`stats()` is the best pool telemetry in the ecosystem.**
  `poolHighWaterMark` is the number that tells a user what to set `capacity`
  to — precisely what a pool should expose and most do not.

### 4.2 Merged ladder

Version numbers below assume the state correction resolves to 1.0.1 as the
baseline. If v1.1 turns out to be real local work, shift each up one.

===============================================================================
# SG1 — lite-signal-gsap v1.1.0 — quickTo retarget backend (flagship)
===============================================================================

```markdown
---
package: "@zakkster/lite-signal-gsap"
version_target: 1.1.0   (see state correction)
status: planned
findings: [XS-02]
depends_on: [X-PEER]
---

# lite-signal-gsap — remove the one allocation the bridge could not

PURPOSE
  Their v1.2, unchanged in intent. `gsap.quickTo` exists precisely for
  high-frequency retargeting: one persistent tween whose target mutates,
  instead of a fresh tween per `overwrite: "auto"` cycle. Wiring the proxy pool
  to a quickTo setter eliminates the GSAP-internal tween construction the
  README documents as "outside our control."

TASKS
  - **quickTo path for `tweenToSignal`**, auto-selected, with an explicit
    `quick: false` escape hatch. Keep the overwrite path for vars quickTo cannot
    express — `repeat`, `yoyo`, `keyframes`, `delay`.
  - Generation guards simplify: one stable tween identity per follower, so the
    stale-fire window shrinks to quickTo's own semantics. The documented
    `stop.tween` staleness gotcha ("re-read after retargets") largely
    disappears — document the improvement rather than deleting the note, so a
    reader of the old docs understands what changed.
  - **+ Completion semantics.** quickTo's tween is persistent, so `onComplete`
    fires differently from a per-retarget tween — and `isTweening` and the
    unconditional `onCleanup(stop)` both read that state. Decide and pin what
    "complete" means on the quickTo path, per branch. This is the one place the
    two backends' observable behaviour can diverge and it is not in the original
    task list.
  - **+ Write up the capacity pattern as a reusable decision record.**
    Atomic-reserve-then-mutate, an error message carrying the remedy, and a
    high-water mark for sizing. Three packages in the ecosystem are about to
    implement capacity limits and **lite-bvh's B1 brief is fixing the version of
    this that got it wrong.** Cross-reference from there. One document; saves
    the reasoning being rediscovered.
  - **+ Document `growthPolicy` outside the exception message.** The error
    advertises `configure({ growthPolicy: 'grow' })`; the README should explain
    both modes, what growing costs, and why the default is fail-closed. A remedy
    mentioned only in an exception is one most users meet at the worst possible
    moment.
  - **+ Pin the `configure` lock.** There is a `configLocked` flag; the exact
    contract — what may be configured, when the lock arms, what a late
    `configure` does — needs a named test per branch.

BENCH
  Retargets/s and heap growth over 100k retargets, overwrite vs quickTo, both
  machines, protocol v3 provenance. **The headline number of the release**, and
  the roadmap's own publish gate: no ship without the A/B numbers from both
  machines in the README's benchmark section.

DEMO
  Phase-chase gains an overwrite/quickTo A/B toggle in the HUD; `stats()` gains
  a `backend` field per live follower so the split is visible live.

ASSERTIONS
  - quickTo path produces identical final values to the overwrite path for the
    same retarget sequence — compared numerically over a seeded corpus.
  - Fallback auto-selection: each of `repeat`, `yoyo`, `keyframes`, `delay`
    routes to the overwrite path; `quick: false` forces it.
  - Completion, `isTweening` and `onCleanup` behave per the pinned contract on
    **both** backends.
  - Capacity regression tests: 65th tween throws, `liveTweens` is exactly
    capacity, `killTweensOf` restores the pool, the next tween succeeds. All
    four pass today — make them permanent.
  - `growthPolicy: 'grow'` grows, and the CHANGELOG records what it costs.
  - SD2's observer-count gate: after `killTweensOf`, the target signal has no
    observers and `stats().liveTweens` is 0.
  - Suite green against GSAP at both ends of the peer range set in X-PEER — the
    declared range is `^3.0.0` and GSAP's latest is 3.15.0.
  - `.peek()` (used at `SignalGsap.js:152`) present across the whole peer range.
    It exists in lite-signal 1.4.2; assert rather than assume, since the floor
    moves in X-PEER.

DONE WHEN
  the A/B numbers are published from both machines, the fallback is exhaustive,
  and the capacity pattern is a document other packages can copy
```

===============================================================================
# SG2 — lite-signal-gsap v1.2.0 — signalTimeline
===============================================================================

```markdown
---
package: "@zakkster/lite-signal-gsap"
version_target: 1.2.0
status: planned
depends_on: [SG1]
---

# lite-signal-gsap — close the FAQ's admitted gap

Their v1.3, unchanged. The direction call in it is correct and worth keeping
explicit.

TASKS
  - **`signalTimeline(vars)`** returning a callable stop-handle wrapping
    `gsap.timeline()`: `.add(...)` sugar accepting bridge handles, keeping their
    proxies claimed for the timeline's lifetime and releasing all on
    kill/complete; unconditional `onCleanup(stop)` like every other constructor,
    so a timeline built inside an effect dies with the effect.
  - **`stats()` accounting per timeline** — claimed-proxy counts, so a long
    timeline holding N slots is visible against `poolHighWaterMark` instead of
    mysterious. Do not defer this: a timeline is the first thing in the package
    that holds pool slots for seconds rather than milliseconds.
  - **`bindProgress(tl, progressGetter)`** — a signal drives `tl.progress()`,
    for scroll-scrubbed and gesture-scrubbed animation from lite-signal sources.
    The roadmap's direction call is right: this is the valuable direction, and
    the reverse (a computed exposing tween progress as a signal) would require
    per-frame `signal.set` from the ticker for every observer. Evaluate the
    reverse, expect a recipe using an existing tweened signal.
  - **Pool sizing guidance in docs.** Timelines shift the claim-duration profile
    from milliseconds to seconds, changing sensible `proxyPoolSize` defaults for
    timeline-heavy apps. Tie the guidance to `poolHighWaterMark` — already the
    right instrument.

ASSERTIONS
  - A timeline built inside an effect is killed when the effect disposes, and
    every proxy it claimed returns to the pool. Assert via `stats()`, not by
    inference.
  - Killing a timeline mid-flight releases all claimed proxies exactly once; a
    second kill is a no-op.
  - A timeline that completes naturally releases identically to one killed.
  - `bindProgress` drives `progress()` with no per-frame allocation.
  - Pool exhaustion caused by a timeline holding N slots produces the same
    actionable error as SG1's, with the timeline identified.

DONE WHEN
  timelines are first-class, disposal is asserted through stats(), and holding
  pool slots for seconds is visible rather than mysterious
```

===============================================================================
# SG3 — lite-signal-gsap v1.3.0 — shape-keyed record pools (may be rejected)
===============================================================================

```markdown
---
package: "@zakkster/lite-signal-gsap"
version_target: 1.3.0
status: planned
depends_on: [SG2]
---

# lite-signal-gsap — delete the monomorphism constraint, or prove it is theoretical

Their v1.4, unchanged — including the rejection condition, which is the point of
the session.

PURPOSE
  Key the proxy pool on a record shape signature (sorted key join, computed once
  per `tweenRecordSignal` call — cold path, allocation acceptable at creation).
  Each sub-pool then only ever sees one hidden class, so
  `proxy._sigs[key].set(proxy[key])` stays monomorphic per shape automatically,
  with zero hot-path change. The README's "avoid mixing shapes" section becomes
  historical.

THE REJECTION CONDITION COMES FIRST
  The roadmap states it and it should be the first task, not a caveat:
  **measure whether the constraint is actually reachable** in a real workload
  (thousands of simultaneous mixed-shape record tweens) or purely theoretical.
  If it is unmeasurable even in a constructed worst case, **reject the feature
  and keep the doc note** — a Map layer nobody needs is bytes.

  Write the measurement and the threshold down before implementing. A decision
  rule authored after the benchmark is a decision rule that ships whatever was
  built.

TASKS
  - Build the constructed worst case first. Record ops/s with mixed shapes
    versus a single shape, both machines, protocol v3.
  - If the delta clears the recorded threshold: implement sub-pools; assert zero
    hot-path change by diffing the effect body and by `assertOps`.
  - If it does not: write the rejection into the ledger with the numbers, keep
    the doc note, close the session. **That is a successful session.**
  - **`tweenSignalArray(signals, targets, { stagger })`** — evaluate, expect
    rejection as API (a loop with `delay: i * stagger` is four lines of user
    code), accept as a documented recipe in the particle-system section.

ASSERTIONS
  - The worst-case measurement exists and is in the ledger either way.
  - If shipped: every shape gets its own sub-pool; `stats()` reports per-shape
    depth; the hot body is byte-identical; `poolHighWaterMark` still means what
    it meant.
  - REFORGE's stable `{l,c,h,a}` shape is the acceptance case — one shape, so it
    must show no regression whatsoever.

DONE WHEN
  the constraint is deleted with numbers, or the rejection is recorded with
  numbers
```

### 4.3 Parallel track and ledger — approve as written

The **protocol / torture / proof** track lands with whichever release is ready
first, as the roadmap says. Two notes:

- The **deterministic mock ticker** for CI benches is the right call, and
  `tween.progress(1)` fast-forward as the unit-test strategy is what keeps the
  suite fast. Keep both.
- **Gen-guard fuzz against a model checker** — randomized interleavings of
  retarget / kill / natural-complete / `killTweensOf`, asserting no stale write
  ever lands on a reassigned signal — is the highest-value item in the track,
  and SG1's quickTo work changes the state space it explores. Run it after SG1.

All four **ledger candidates stay rejected**: the lite-ease bridge, non-numeric
interpolation, spring/physics followers (lite-tween-pro territory), and the
worker ticker abstraction.

---

## 5. Dogfooding gates — approve all three, one addition

The dogfooding gates are the strongest accountability mechanism in this set and
should be kept verbatim:

- **lite-router:** REFORGE and RESEAM shells route via lite-router — theme and
  tool identity in the path, tool parameters in the query. *"Dragging one slider
  updates one query param and wakes one widget"* is the surgical-update thesis
  as a product, and shareable-URL Hueforge palettes falling out for free is the
  kind of consequence that validates a design.
- **lite-signal-dom:** REFORGE, RESEAM and the Vikings HUD adopt it for all
  reactive DOM; no v1.2+ feature ships without at least one real call site.
- **lite-signal-gsap:** Vikings scratch-FX and `lite-scratch-fx` reveal
  sequences adopt `tweenToSignal` as the highest-frequency retarget consumer
  available; REFORGE theme transitions are the shape-keyed-pool acceptance case.

**One addition, spanning all three:** the dogfooding apps are also the only
realistic test of X-PEER. A REFORGE shell importing lite-router, lite-signal-dom
and lite-signal-gsap simultaneously is exactly the tree where a duplicated
lite-signal would surface — so once X-PEER lands, `npm ls @zakkster/lite-signal`
in each dogfooding app, expecting exactly one line, is a free permanent check
worth adding to their build scripts.

---

## 6. What not to touch

Three things here are better than their equivalents elsewhere in the ecosystem:

- **lite-signal-gsap's capacity handling** — atomic throw, remedy in the
  message, high-water mark for sizing. It is the reference implementation;
  lite-bvh should be changed to match it.
- **lite-router's `queryParam` memoization** — one graph node per key, shared
  across views, propagation stopping at the key. The comment explaining why is
  what will stop a future refactor deleting it.
- **lite-signal-dom's Symbol-keyed disposables** — the instinct to put library
  state where the application cannot reach it is exactly right. SD1 is not a
  correction of that instinct; it is applying it to the one place the design did
  not.

*Roadmaps evaluated against the npm registry and published tarballs,
2026-07-28. Copyright Zahary Shinikchiev.*
