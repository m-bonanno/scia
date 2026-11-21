import { type ReactNode, useId } from 'react';

interface SettingSwitchProps {
  readonly label: string;
  // What turning it on does, in a sentence.
  readonly hint: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}

// A setting that is on or off: the betas (#82), the links of the clipboard (#128).
export function SettingSwitch({ label, hint, value, onChange }: SettingSwitchProps): ReactNode {
  const labelId = useId();
  const hintId = useId();
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="min-w-0">
        <span id={labelId} className="block text-sm font-medium">
          {label}
        </span>
        <span id={hintId} className="block text-sm text-muted-foreground">
          {hint}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={value}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-tonal transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-muted-foreground before:transition-transform checked:bg-accent checked:before:translate-x-4 checked:before:bg-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:before:transition-none"
      />
    </label>
  );
}
