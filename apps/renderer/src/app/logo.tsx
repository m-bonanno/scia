import type { ReactNode } from 'react';

// The mark: a download arrow and the wake («scia») it leaves behind.
export function Logo({ size = 18 }: { readonly size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-accent"
    >
      <path d="M12 3v16" />
      <path d="M5.5 13.5 12 20l6.5-6.5" />
      <path d="M5.5 3.5v4" opacity="0.45" />
      <path d="M18.5 3.5v4" opacity="0.45" />
    </svg>
  );
}
