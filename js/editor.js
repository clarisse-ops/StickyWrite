// Editor: plain-text contenteditable with CSS Custom Highlight underlines.
// The DOM inside #editor is kept as text nodes only (newlines are literal \n),
// so character offsets map 1:1 between the string and the DOM.

export class Editor {
  constructor(el) {
    this.el = el;
    this.onChange = null;      // fired (debounced by caller) after text changes
    this.onCaretOnLint = null; // fired with (finding, rect) when caret/click lands on a lint
    this.findings = [];        // current findings painted
    this._wireEvents();
  }

  // ----- text model -----

  getText() {
    return this.el.textContent;
  }

  setText(text) {
    this.el.textContent = text;
    this._ensureTrailingBr();
    this._updateEmpty();
    this.clearHighlights();
  }

  // A trailing <br> makes a document-final newline actually render as a new
  // line (otherwise Enter at the end of the doc looks like it did nothing).
  // textContent ignores <br>, so text offsets are unaffected.
  _ensureTrailingBr() {
    const last = this.el.lastChild;
    if (!last || last.nodeName !== 'BR') this.el.appendChild(document.createElement('br'));
  }

  _updateEmpty() {
    if (this.getText() === '') this.el.setAttribute('data-empty', '');
    else this.el.removeAttribute('data-empty');
  }

  // Walk text nodes, returning [node, offsetInNode] for a global char offset.
  _locate(offset) {
    const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT);
    let pos = 0, node;
    while ((node = walker.nextNode())) {
      const len = node.data.length;
      if (offset <= pos + len) return [node, offset - pos];
      pos += len;
    }
    return null;
  }

  rangeFor(start, end) {
    const a = this._locate(start);
    const b = this._locate(end);
    if (!a || !b) return null;
    const r = document.createRange();
    try {
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1]);
    } catch { return null; }
    return r;
  }

  // Global char offset for a DOM point inside the editor.
  offsetAt(node, nodeOffset) {
    if (!this.el.contains(node)) return null;
    const r = document.createRange();
    r.setStart(this.el, 0);
    try { r.setEnd(node, nodeOffset); } catch { return null; }
    return r.toString().length;
  }

  // ----- edits (undo-friendly via execCommand) -----

  replaceRange(start, end, newText) {
    const r = this.rangeFor(start, end);
    if (!r) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    this.el.focus();
    document.execCommand('insertText', false, newText);
    return true;
  }

  insertAt(offset, newText) {
    return this.replaceRange(offset, offset, newText);
  }

  // ----- highlights -----

  clearHighlights() {
    for (const name of ['sw-correctness', 'sw-clarity', 'sw-engagement', 'sw-delivery', 'sw-focus']) {
      CSS.highlights.delete(name);
    }
  }

  paint(findings) {
    this.findings = findings;
    if (!('highlights' in CSS)) return; // very old browser: cards still work
    const byCat = { correctness: [], clarity: [], engagement: [], delivery: [] };
    for (const f of findings) {
      const r = this.rangeFor(f.start, f.end);
      if (r) byCat[f.category]?.push(r);
    }
    for (const [cat, ranges] of Object.entries(byCat)) {
      CSS.highlights.set('sw-' + cat, new Highlight(...ranges));
    }
  }

  focusFinding(f) {
    const r = this.rangeFor(f.start, f.end);
    if (!r) return;
    CSS.highlights.set('sw-focus', new Highlight(r));
    const rect = r.getBoundingClientRect();
    const scroller = this.el.closest('.page-scroll');
    if (rect.top < 80 || rect.bottom > window.innerHeight - 120) {
      scroller.scrollBy({ top: rect.top - window.innerHeight / 2.6, behavior: 'smooth' });
    }
  }

  unfocus() {
    CSS.highlights.delete('sw-focus');
  }

  findingRect(f) {
    const r = this.rangeFor(f.start, f.end);
    return r ? r.getBoundingClientRect() : null;
  }

  // ----- events -----

  _wireEvents() {
    // Keep content plain text: Enter inserts \n, paste inserts plain text.
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Chrome can leave the caret BEFORE a newline inserted at the end of
        // the document, which makes Enter feel broken. Place it explicitly.
        const before = this._caretOffset();
        document.execCommand('insertText', false, '\n');
        if (before != null && this._caretOffset() !== before + 1) {
          this._setCaret(before + 1);
        }
        return;
      }
      // Plain-text editor: swallow rich-formatting shortcuts (Ctrl/Cmd+B/I/U).
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    });
    this.el.addEventListener('beforeinput', (e) => {
      if (e.inputType && e.inputType.startsWith('format')) e.preventDefault();
    });
    this.el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text.replace(/\r\n/g, '\n'));
    });
    // Some browsers still sneak elements in (drag-drop etc.): normalize lazily.
    this.el.addEventListener('input', () => {
      if (this.el.querySelector(':scope > :not(br)') || this.el.querySelector('div, span, p, b, i')) {
        const caret = this._caretOffset();
        const text = this._extractText();
        this.el.textContent = text;
        if (caret != null) this._setCaret(Math.min(caret, text.length));
      }
      this._ensureTrailingBr();
      this._updateEmpty();
      this.onChange?.();
    });
    this.el.addEventListener('click', (e) => {
      const off = this._pointOffset(e.clientX, e.clientY);
      if (off == null) return;
      const hit = this.findings.find(f => off >= f.start && off <= f.end);
      if (hit) this.onCaretOnLint?.(hit);
      else this.onCaretOnLint?.(null);
    });
  }

  // Fallback text extraction if non-text nodes appear (e.g. from drag-drop).
  _extractText() {
    let out = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) out += child.data;
        else if (child.nodeName === 'BR') out += '\n';
        else {
          const block = /^(DIV|P|LI|H[1-6])$/.test(child.nodeName);
          if (block && out && !out.endsWith('\n')) out += '\n';
          walk(child);
          if (block && !out.endsWith('\n')) out += '\n';
        }
      }
    };
    walk(this.el);
    return out.replace(/\n$/, '');
  }

  _caretOffset() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    return this.offsetAt(r.startContainer, r.startOffset);
  }

  _setCaret(offset) {
    const loc = this._locate(offset);
    if (!loc) return;
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(loc[0], loc[1]);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Public: char offset for a viewport point (used for hover cards).
  offsetAtPoint(x, y) {
    return this._pointOffset(x, y);
  }

  _pointOffset(x, y) {
    let node, off;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      node = p.offsetNode; off = p.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer; off = r.startOffset;
    } else return null;
    return this.offsetAt(node, off);
  }
}
