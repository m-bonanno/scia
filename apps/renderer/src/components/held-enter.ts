// Enter held on a button that moves the focus would press whatever the focus goes to next. Armed
// by a press of Enter, it swallows the repeats wherever they land until the key is let go. A held
// Tab is not touched: it walks on. Nor is a fresh press: the release of the one before may never
// have come, the key held as the window lost the focus and let go in another window.
let armed = false;

function swallow(event: KeyboardEvent): void {
  if (armed && event.key === 'Enter' && event.repeat) event.preventDefault();
}

function release(event: KeyboardEvent): void {
  if (event.key === 'Enter') armed = false;
}

// The keydown of a control whose press moves the focus.
export function swallowHeldEnter(event: { readonly key: string }): void {
  if (event.key !== 'Enter') return;
  armed = true;
  // A listener already there is not added again.
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', release, true);
}
