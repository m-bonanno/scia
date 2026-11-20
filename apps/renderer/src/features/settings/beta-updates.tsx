import { type ReactNode, useId } from 'react';

interface BetaUpdatesProps {
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}

// Whether Scia updates itself to the betas too (#82). Off, the stables only.
export function BetaUpdates({ value, onChange }: BetaUpdatesProps): ReactNode {
  const labelId = useId();
  const hintId = useId();
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="min-w-0">
        <span id={labelId} className="block text-sm font-medium">
          Beta versions
        </span>
        <span id={hintId} className="block text-sm text-muted-foreground">
          Also update to versions still being tried. Scia updates itself when you quit it.
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
