// Hidden DOM board for keyboard and screen-reader play.
// It mirrors the 3D board and sends activate/cancel events back to main.js.

const SIDE_WORD = { 0: 'empty', 1: 'black stone', 2: 'white stone' };

export class A11yBoard {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.host        Container (role="grid").
   * @param {number} opts.n                Board size (15).
   * @param {(r:number,c:number)=>number} opts.getCell  Current cell value 0/1/2.
   * @param {()=>('place'|'target'|'idle')} opts.getMode  What an activation means now.
   * @param {(r:number,c:number)=>void} opts.onActivate  Enter/Space on a cell.
   * @param {()=>void} [opts.onCancel]     Escape.
   * @param {(r:number,c:number)=>void} [opts.onFocusCell]  Focus moved to a cell.
   */
  constructor(opts) {
    this.o = opts;
    this.n = opts.n;
    this.cursor = { r: Math.floor(this.n / 2), c: Math.floor(this.n / 2) };
    this.cells = []; // cells[r][c] = button element
    this._build();
  }

  _build() {
    const host = this.o.host;
    host.setAttribute('role', 'grid');
    host.setAttribute('aria-label', `Gomoku board, ${this.n} by ${this.n}`);
    host.innerHTML = '';
    for (let r = 0; r < this.n; r++) {
      const row = document.createElement('div');
      row.setAttribute('role', 'row');
      const rowCells = [];
      for (let c = 0; c < this.n; c++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.setAttribute('role', 'gridcell');
        cell.className = 'a11y-cell';
        cell.tabIndex = -1; // roving tabindex; one cell is 0 at a time
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        cell.addEventListener('keydown', (e) => this._onKey(e, r, c));
        cell.addEventListener('focus', () => this._onFocus(r, c));
        cell.addEventListener('click', () => this._activate(r, c)); // also covers SR "click"
        row.appendChild(cell);
        rowCells.push(cell);
      }
      host.appendChild(row);
      this.cells.push(rowCells);
    }
    this._roving();
    this.refresh();
  }

  // Make exactly the cursor cell tabbable (roving tabindex pattern).
  _roving() {
    for (let r = 0; r < this.n; r++) {
      for (let c = 0; c < this.n; c++) {
        this.cells[r][c].tabIndex = r === this.cursor.r && c === this.cursor.c ? 0 : -1;
      }
    }
  }

  _onFocus(r, c) {
    this.cursor = { r, c };
    this._roving();
    if (this.o.onFocusCell) {
      try { this.o.onFocusCell(r, c); } catch (e) { /* visual cue is optional */ }
    }
  }

  _move(dr, dc) {
    const nr = Math.min(this.n - 1, Math.max(0, this.cursor.r + dr));
    const nc = Math.min(this.n - 1, Math.max(0, this.cursor.c + dc));
    this.cursor = { r: nr, c: nc };
    this._roving();
    this.cells[nr][nc].focus();
  }

  _onKey(e, r, c) {
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); this._move(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); this._move(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); this._move(0, -1); break;
      case 'ArrowRight': e.preventDefault(); this._move(0, 1); break;
      case 'Home': e.preventDefault(); this.cursor = { r, c: 0 }; this._roving(); this.cells[r][0].focus(); break;
      case 'End': e.preventDefault(); this.cursor = { r, c: this.n - 1 }; this._roving(); this.cells[r][this.n - 1].focus(); break;
      case 'Enter':
      case ' ':
      case 'Spacebar': e.preventDefault(); this._activate(r, c); break;
      case 'Escape': if (this.o.onCancel) { e.preventDefault(); try { this.o.onCancel(); } catch (err) { /* noop */ } } break;
      default: break;
    }
  }

  _activate(r, c) {
    try { this.o.onActivate(r, c); } catch (e) { /* main.js validates; ignore */ }
  }

  /** Re-read the board and update every cell's accessible name + state class. */
  refresh() {
    const mode = this.o.getMode ? this.o.getMode() : 'idle';
    for (let r = 0; r < this.n; r++) {
      for (let c = 0; c < this.n; c++) {
        const v = this.o.getCell(r, c);
        const cell = this.cells[r][c];
        const base = `Row ${r + 1}, column ${c + 1}, ${SIDE_WORD[v] || 'empty'}`;
        let action = '';
        if (mode === 'place' && v === 0) action = '. Press Enter to place.';
        else if (mode === 'target' && v !== 0) action = '. Press Enter to target.';
        cell.setAttribute('aria-label', base + action);
        cell.dataset.state = String(v);
        cell.disabled = false; // keep focusable; legality is decided on activate
      }
    }
  }

  /** Briefly flash a cell to signal a rejected action (no popup; R5). */
  flashInvalid(r, c) {
    const cell = this.cells[r] && this.cells[r][c];
    if (!cell) return;
    cell.classList.remove('a11y-invalid');
    void cell.offsetWidth; // restart animation
    cell.classList.add('a11y-invalid');
  }

  focusCursor() { this.cells[this.cursor.r][this.cursor.c].focus(); }
}
