import { type Theme, THEMES } from '@scia/contracts/theme';
import type { ReactNode } from 'react';
import { SettingSelect } from './setting-select.tsx';

// The names the palettes have where they come from.
const THEME_NAMES: Readonly<Record<Theme, string>> = {
  'black-tie': 'Black Tie',
  brick: 'Brick',
  'road-trip': 'Road Trip',
  earth: 'Earth',
  bookstore: 'Bookstore',
  'new-car': 'New Car',
  'wood-floor': 'Wood Floor',
  ice: 'Ice',
  space: 'Space',
};

const OPTIONS = THEMES.map((theme) => ({ value: theme, label: THEME_NAMES[theme] }));

interface ThemeChoiceProps {
  readonly value: Theme;
  readonly onChange: (value: Theme) => void;
}

export function ThemeChoice({ value, onChange }: ThemeChoiceProps): ReactNode {
  return (
    <SettingSelect
      label="Theme"
      hint="Light or dark, as your system is."
      value={value}
      options={OPTIONS}
      onChange={(chosen) => {
        const theme = THEMES.find((known) => known === chosen);
        if (theme !== undefined) onChange(theme);
      }}
    />
  );
}
