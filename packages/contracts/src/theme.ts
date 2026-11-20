// The themes a person chooses from, in the order they are offered. Each is one of the "Minimal"
// palettes of color-hex.com (5244 and the eight it lists beside it), worn in a light and a dark
// variant: which of the two is the system's choice, not the person's.
export const Theme = {
  BlackTie: 'black-tie',
  Brick: 'brick',
  RoadTrip: 'road-trip',
  Earth: 'earth',
  Bookstore: 'bookstore',
  NewCar: 'new-car',
  WoodFloor: 'wood-floor',
  Ice: 'ice',
  Space: 'space',
} as const;
export type Theme = (typeof Theme)[keyof typeof Theme];

export const THEMES: readonly Theme[] = Object.values(Theme);
export const DEFAULT_THEME: Theme = Theme.BlackTie;

export const ColourScheme = { Light: 'light', Dark: 'dark' } as const;
export type ColourScheme = (typeof ColourScheme)[keyof typeof ColourScheme];

export interface WindowColours {
  readonly background: string;
  readonly foreground: string;
  readonly inactiveForeground: string;
}

// What main paints before the page does, and the colours of the window's own buttons. They mirror
// --background, --foreground and --muted-foreground of apps/renderer/src/themes.css: a spec
// fails when the two drift (apps/desktop/src/theme-colours.test.ts).
export const WINDOW_COLOURS: Readonly<
  Record<Theme, Readonly<Record<ColourScheme, WindowColours>>>
> = {
  'black-tie': {
    dark: { background: '#111111', foreground: '#e3e3e3', inactiveForeground: '#9e9e9e' },
    light: { background: '#e3e3e3', foreground: '#111111', inactiveForeground: '#424242' },
  },
  brick: {
    dark: { background: '#190804', foreground: '#dfccaf', inactiveForeground: '#b4a389' },
    light: { background: '#dfccaf', foreground: '#511301', inactiveForeground: '#5f3f35' },
  },
  'road-trip': {
    dark: { background: '#2f2f2f', foreground: '#f0f0f0', inactiveForeground: '#b6b6b6' },
    light: { background: '#f2f2f2', foreground: '#2f2f2f', inactiveForeground: '#565656' },
  },
  earth: {
    dark: { background: '#120e05', foreground: '#e9ead7', inactiveForeground: '#aca48e' },
    light: { background: '#f1f2e2', foreground: '#2b2005', inactiveForeground: '#544218' },
  },
  bookstore: {
    dark: { background: '#3e1000', foreground: '#f6efd5', inactiveForeground: '#d3b7a7' },
    light: { background: '#f6f0dc', foreground: '#3e1000', inactiveForeground: '#653719' },
  },
  'new-car': {
    dark: { background: '#08101a', foreground: '#ececec', inactiveForeground: '#a7a7a7' },
    light: { background: '#f2f2f2', foreground: '#1c1c1c', inactiveForeground: '#676767' },
  },
  'wood-floor': {
    dark: { background: '#180904', foreground: '#f7e4d6', inactiveForeground: '#b9a392' },
    light: { background: '#fbede3', foreground: '#391605', inactiveForeground: '#684b3e' },
  },
  ice: {
    dark: { background: '#011021', foreground: '#d5d8f0', inactiveForeground: '#9cadbd' },
    light: { background: '#ebedfc', foreground: '#003d6b', inactiveForeground: '#40586f' },
  },
  space: {
    dark: { background: '#000000', foreground: '#ece9f6', inactiveForeground: '#ada6c0' },
    light: { background: '#f1eef9', foreground: '#1c1936', inactiveForeground: '#59586d' },
  },
};
