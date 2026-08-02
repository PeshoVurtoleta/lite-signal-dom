/**
 * Allocation-isolation harness — a linked-list DOM with O(1), zero-allocation
 * node operations and NO MutationObserver. Importing the library in this
 * environment leaves its auto-disposer observer null, so a heap measurement
 * reflects ONLY the library's own per-update allocation (the reconcile/bind
 * bookkeeping) and lite-signal's pool-backed effect re-run — never the host
 * DOM's internal allocation (which is native in a real browser, but JS-heavy
 * under jsdom).
 *
 * Install BEFORE importing SignalDom.js. Deliberately does NOT define
 * MutationObserver.
 */
const EMPTY = Object.freeze([]);
const noopClassList = { add() {}, remove() {}, contains() { return false; } };

class MockNode {
    constructor(nodeType) {
        this.nodeType = nodeType;
        this.parentNode = null;
        this.nextSibling = null;
        this.previousSibling = null;
        this.firstChild = null;
        this.lastChild = null;
        this._tc = "";
        this.style = {};
        this.classList = noopClassList;
    }
    get isConnected() { return true; } // observer is null here; never actually read
    get textContent() { return this._tc; }
    set textContent(v) { this._tc = v; }
    getElementsByClassName() { return EMPTY; }
    setAttribute() {}
    removeAttribute() {}
    addEventListener() {}
    removeEventListener() {}

    appendChild(node) { return this.insertBefore(node, null); }

    insertBefore(node, ref) {
        if (node.parentNode) node.parentNode._unlink(node);
        node.parentNode = this;
        if (ref == null) {
            node.previousSibling = this.lastChild;
            node.nextSibling = null;
            if (this.lastChild) this.lastChild.nextSibling = node;
            else this.firstChild = node;
            this.lastChild = node;
        } else {
            node.nextSibling = ref;
            node.previousSibling = ref.previousSibling;
            if (ref.previousSibling) ref.previousSibling.nextSibling = node;
            else this.firstChild = node;
            ref.previousSibling = node;
        }
        return node;
    }
    removeChild(node) { this._unlink(node); return node; }
    _unlink(node) {
        if (node.previousSibling) node.previousSibling.nextSibling = node.nextSibling;
        else if (this.firstChild === node) this.firstChild = node.nextSibling;
        if (node.nextSibling) node.nextSibling.previousSibling = node.previousSibling;
        else if (this.lastChild === node) this.lastChild = node.previousSibling;
        node.parentNode = null;
        node.nextSibling = null;
        node.previousSibling = null;
    }
}

export function installMockDom() {
    globalThis.document = {
        createElement: () => new MockNode(1),
        createComment: () => new MockNode(8),
    };
    return { MockNode };
}

/** Snapshot the in-order child sequence of a mock parent (for assertions). */
export function childSeq(parent, prop = "_tc") {
    const out = [];
    for (let n = parent.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1) out.push(n[prop]);
    }
    return out;
}
