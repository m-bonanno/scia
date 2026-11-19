export const ResolvedTheme = { Light: 'light', Dark: 'dark' } as const;
export type ResolvedTheme = (typeof ResolvedTheme)[keyof typeof ResolvedTheme];

export interface WindowColours {
  readonly background: string;
  readonly foreground: string;
  readonly inactiveForeground: string;
}

// What main paints before the page does, and the colours of the window's own buttons. They mirror
// --background, --foreground and --muted-foreground of apps/renderer/src/styles.css: a test in
// the renderer fails when the two drift.
export const WINDOW_COLOURS: Readonly<Record<ResolvedTheme, WindowColours>> = {
  dark: { background: '#0d0f12', foreground: '#eef0f3', inactiveForeground: '#9198a3' },
  light: { background: '#f7f8fa', foreground: '#14171c', inactiveForeground: '#5b6370' },
};
