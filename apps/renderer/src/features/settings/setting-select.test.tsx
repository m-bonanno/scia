import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingSelect } from './setting-select.tsx';

const OPTIONS = [
  { value: 'black-tie', label: 'Black Tie' },
  { value: 'ice', label: 'Ice' },
];

describe('SettingSelect', () => {
  it('is a menu named by its label, which says what was chosen', async () => {
    const onChange = vi.fn();
    render(
      <SettingSelect
        label="Theme"
        hint="A hint."
        value="black-tie"
        options={OPTIONS}
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'Ice');

    expect(onChange).toHaveBeenCalledExactlyOnceWith('ice');
  });

  // The system's own arrow is not one of the app's icons (#153): the menu draws lucide's, which
  // a screen reader does not read, the menu saying what it is.
  it('wears the app’s chevron, not the system’s', () => {
    render(
      <SettingSelect
        label="Theme"
        hint="A hint."
        value="ice"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const menu = screen.getByRole('combobox', { name: 'Theme' });

    expect(menu).toHaveClass('appearance-none');
    const chevron = menu.parentElement?.querySelector('svg.lucide-chevron-down');
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
  });
});
