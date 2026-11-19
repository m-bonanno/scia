import { Link } from 'lucide-react';
import { type ReactNode, type SubmitEvent, useState } from 'react';
import { extractLinks } from './links.ts';

interface AddBarProps {
  // Resolves to whether the links were taken: the field is cleared only then.
  readonly onAdd: (urls: string[]) => Promise<boolean>;
}

export function AddBar({ onAdd }: AddBarProps): ReactNode {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const links = extractLinks(text);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (links.length === 0 || busy) return;
    setBusy(true);
    void onAdd(links)
      .then((taken) => {
        // A failed add never clears what was typed.
        if (taken) setText('');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form
      onSubmit={submit}
      className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-surface pr-1.5 pl-4 transition-colors focus-within:border-accent"
    >
      <Link size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        aria-label="Link da scaricare"
        placeholder="Incolla uno o più link"
        autoFocus
        spellCheck={false}
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={links.length === 0 || busy}
        className="h-9 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
      >
        {links.length > 1 ? `Scarica ${String(links.length)} file` : 'Scarica'}
      </button>
    </form>
  );
}
