/**
 * @zakkster/lite-signal-dom
 * Zero-GC, vanilla-first reactive DOM bindings for @zakkster/lite-signal.
 *
 * Every binding returns an idempotent dispose handle. Bindings are also torn
 * down automatically when their node leaves the DOM, via a single document-level
 * MutationObserver.
 */

/** Package version constant. In three-place sync with package.json and CHANGELOG.md. */
export const VERSION: string;

/** A reactive read function, as produced by lite-signal `signal()` / `computed()`. */
export type Getter<T> = () => T;

/** Idempotent teardown handle returned by every binding. */
export type Dispose = () => void;

/**
 * Bind a node's `textContent` to a reactive getter. The result is coerced to a
 * string by the DOM. Safe for untrusted content.
 */
export function bindText(node: Node, getter: Getter<unknown>): Dispose;

/**
 * Bind a node's `innerHTML` to a reactive getter.
 * WARNING: Unsafe -- never pass unsanitised user input. Use {@link bindText} instead.
 */
export function bindHTMLUnsafe(node: Element, getter: Getter<string>): Dispose;

/**
 * Bind an HTML attribute. `null`/`undefined`/`false` remove the attribute;
 * `true` sets it to `""` (boolean attribute); otherwise the value is stringified.
 */
export function bindAttr(
    node: Element,
    attr: string,
    getter: Getter<string | number | boolean | null | undefined>,
): Dispose;

/**
 * Bind a live DOM property (e.g. `value`, `checked`, `selectedIndex`) -- not an
 * attribute. Use for form state.
 */
export function bindProp(node: Element, prop: string, getter: Getter<unknown>): Dispose;

/** Toggle a single class from a reactive boolean getter. Other classes are untouched. */
export function bindClass(node: Element, className: string, getter: Getter<unknown>): Dispose;

/**
 * Bind a single inline style property. `null`/`undefined` resets it to the
 * stylesheet value.
 */
export function bindStyle(
    node: ElementCSSInlineStyle,
    styleProp: string,
    getter: Getter<string | number | null | undefined>,
): Dispose;

/**
 * Show/hide a node via `style.display`. When shown, `display` is set to
 * `displayStyle` (default `""`); when hidden, to `"none"`.
 */
export function bindShow(
    node: ElementCSSInlineStyle,
    getter: Getter<unknown>,
    displayStyle?: string,
): Dispose;

/**
 * Attach an event listener whose lifetime is tied to the node's presence in
 * the DOM. Touch/wheel events default to `{ passive: true }`; pass `options`
 * to override.
 */
export function bindOn(
    node: EventTarget,
    eventName: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
): Dispose;

/** A rendered item view returned by a {@link keyed} render function. */
export interface KeyedView {
    /** The rendered element. */
    element: Element;
    /** Teardown for this item's own bindings. */
    dispose: Dispose;
    /**
     * Internal mark-sweep stamp. Owned by `keyed` once the view is returned --
     * do not read or write it.
     * @internal
     */
    seen?: number;
}

/**
 * Keyed list reconciler: the reactive analogue of an ECS entity table. Diffs a
 * reactive array by key, reuses surviving elements, and recycles removed ones
 * through an internal pool. Zero JS-heap allocation in steady state.
 *
 * @param parent     Container element.
 * @param listGetter Reactive read returning the list.
 * @param keyFn      Stable, unique-per-render key for an item.
 * @param renderFn   Builds (or resets a recycled) element and returns it with a
 *                   disposer. Receives the recycled element, or `null` when the
 *                   pool is empty.
 * @returns Disposes the whole list (every view, every element, the anchor).
 */
export function keyed<T>(
    parent: Element,
    listGetter: Getter<readonly T[]>,
    keyFn: (item: T) => string | number,
    renderFn: (item: T, recycledElement: Element | null) => KeyedView,
): Dispose;
