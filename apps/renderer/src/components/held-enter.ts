// Enter held on a button that moves the focus would press whatever the focus goes to next. Armed
// by that first press, it swallows the repeats wherever they land until the key is let go. A held
// Tab is not touched: it walks on.
let swallowing = false;

export function swallowHeldEnter(): void {
  if (swallowing) return;
  swallowing = true;
  const swallow = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.repeat) event.preventDefault();
  };
  const release = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    swallowing = false;
    window.removeEventListener('keydown', swallow, true);
    window.removeEventListener('keyup', release, true);
  };
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', release, true);
}
