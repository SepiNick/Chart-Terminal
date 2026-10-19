// Undo/redo as a stack of reversible commands. Callers push after applying a change.
export interface Command { label: string; undo: () => void; redo: () => void }

export class History {
  private done: Command[] = [];
  private undone: Command[] = [];
  onChange = () => {};
  private limit: number;
  constructor(limit = 200) { this.limit = limit }

  push(c: Command) {
    this.done.push(c);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    this.onChange();
  }
  undo() { const c = this.done.pop(); if (c) { c.undo(); this.undone.push(c); this.onChange() } return c }
  redo() { const c = this.undone.pop(); if (c) { c.redo(); this.done.push(c); this.onChange() } return c }
  get canUndo() { return this.done.length > 0 }
  get canRedo() { return this.undone.length > 0 }
  peek() { return { undo: this.done.at(-1)?.label, redo: this.undone.at(-1)?.label } }
}

/** Tracks JSON snapshots of a value so a change can be pushed as a before/after command. */
export class Snapshots<K> {
  private last = new Map<K, string>();
  private history: History;
  private read: (k: K) => unknown;
  private write: (k: K, v: unknown) => void;
  constructor(history: History, read: (k: K) => unknown, write: (k: K, v: unknown) => void) { this.history = history; this.read = read; this.write = write }
  /** Remember the current state without recording a command (e.g. after loading). */
  seed(k: K) { this.last.set(k, JSON.stringify(this.read(k))) }
  /** Record a command if the state changed since the last snapshot. */
  commit(k: K, label: string) {
    const before = this.last.get(k) ?? '[]', after = JSON.stringify(this.read(k));
    if (before === after) return;
    this.last.set(k, after);
    this.history.push({
      label,
      undo: () => { this.last.set(k, before); this.write(k, JSON.parse(before)) },
      redo: () => { this.last.set(k, after); this.write(k, JSON.parse(after)) },
    });
  }
}
