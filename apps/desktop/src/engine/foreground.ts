// Whether Scia's window is the one Windows has in use (#62, ADR 0020). A system that did not
// answer counts as another window in use: the product prefers a notification too many over one
// that never comes (the owner, #62).
export function windowInUse(foreground: bigint | undefined, own: bigint): boolean {
  return foreground !== undefined && foreground === own;
}
