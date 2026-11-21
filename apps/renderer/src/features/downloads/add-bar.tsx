import { Link } from 'lucide-react';
import { type ReactNode, type Ref, type SubmitEvent, useId, useRef, useState } from 'react';
import { extractLinks } from '@scia/contracts/links';

// What became of the links sent from the field. A refusal of the text itself is the field's to
// say; any other failure the page says elsewhere.
export type Added =
  { readonly taken: true } | { readonly taken: false; readonly refusal: string | null };

interface AddBarProps {
  readonly onAdd: (urls: string[]) => Promise<Added>;
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function AddBar({ onAdd, inputRef }: AddBarProps): ReactNode {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // What the field holds now: an answer about text it no longer holds is not said under it.
  const holds = useRef('');
  const refusalId = useId();
  const links = extractLinks(text);

  const edit = (value: string) => {
    holds.current = value;
    setText(value);
    setRefusal(null);
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (links.length === 0 || busy) return;
    setBusy(true);
    const sent = text;
    void onAdd(links)
      .then((added) => {
        // What was typed while the links were on their way is kept, and a failed add never clears
        // what was typed.
        const same = holds.current === sent;
        if (added.taken) {
          if (same) edit('');
        } else if (same) {
          setRefusal(added.refusal);
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={submit}
        className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-surface pr-1.5 pl-4 transition-colors focus-within:border-accent"
      >
        <Link size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(event) => {
            edit(event.target.value);
          }}
          aria-label="Links to download"
          aria-invalid={refusal === null ? undefined : true}
          aria-describedby={refusal === null ? undefined : refusalId}
          placeholder="Paste one or more links"
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
          {links.length > 1 ? `Download ${String(links.length)} files` : 'Download'}
        </button>
      </form>
      {refusal !== null && (
        <p id={refusalId} role="alert" className="px-1 text-sm text-destructive">
          {refusal}
        </p>
      )}
    </div>
  );
}
