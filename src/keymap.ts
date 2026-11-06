// Keyboard shortcuts are matched on the Latin letter or digit of the physical key, so they keep working when the active keyboard
// layout is Persian, Arabic, Russian...: there `event.key` is a non-Latin character (ش instead of A, ۵ instead of 5).
// A Latin layout (including AZERTY or Dvorak) is left alone: its `key` already says what the user means.
const PUNCT: Record<string, string> = { Slash: '/', Period: '.', Comma: ',' };

export function latinKey(e: { key: string; code: string }): string {
  if (e.key.length !== 1 || /[\x20-\x7e]/.test(e.key)) return e.key;   // named keys (Tab, ArrowUp) and ASCII characters as typed
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
  return m ? (m[1] ?? m[2]) : PUNCT[e.code] ?? e.key;
}
