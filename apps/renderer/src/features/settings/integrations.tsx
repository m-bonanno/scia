import {
  type Integration,
  type IntegrationCode,
  IntegrationCodeFailure,
  IntegrationCodeStatus,
  type IntegrationId,
} from '@scia/contracts';
import { Unplug } from 'lucide-react';
import {
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { FOCUS_RING, QUIET_BUTTON, TEXT_BUTTON } from '@/components/button-styles.ts';
import { ConfirmButton } from '@/components/confirm-button.tsx';
import { swallowHeldEnter } from '@/components/held-enter.ts';
import { api, ApiError } from '@/lib/api.ts';
import { bridge } from '@/lib/bridge.ts';
import { cn } from '@/lib/cn.ts';
import { formatDate, formatDuration, SEPARATOR } from '@/lib/format.ts';
import {
  codeFailedMessage,
  codeNotGivenMessage,
  connectFailureMessage,
  errorMessage,
  SERVICE_NAME,
  serviceTroubleMessage,
} from '@/lib/messages.ts';

interface IntegrationsSectionProps {
  // Settings is on screen: the services are read again at every visit, and nothing of a visit
  // — a key half typed, a refusal — is there at the next.
  readonly open: boolean;
  readonly onError: (error: unknown) => void;
}

// The services, and the code each row left waiting when Settings last closed, if it still waits:
// the engine waits for it as long as it works (#146), and the row shows it again.
async function readServices(
  left: ReadonlySet<IntegrationId>,
): Promise<{ integrations: Integration[]; waiting: ReadonlyMap<IntegrationId, IntegrationCode> }> {
  const integrations = await api.integrations();
  const waiting = new Map<IntegrationId, IntegrationCode>();
  await Promise.all(
    integrations
      .filter((integration) => !integration.connected && left.has(integration.id))
      .map(async ({ id }) => {
        // A code the engine no longer has, or cannot say, is not shown: a new one is asked for.
        const code = await api.integrationCode(id).catch(() => null);
        if (code?.status === IntegrationCodeStatus.Waiting) waiting.set(id, code);
      }),
  );
  return { integrations, waiting };
}

export function IntegrationsSection({ open, onError }: IntegrationsSectionProps): ReactNode {
  const titleId = useId();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [waiting, setWaiting] = useState<ReadonlyMap<IntegrationId, IntegrationCode>>(new Map());
  // The rows that left a code waiting when Settings closed: asked about at the next visit alone.
  const leftWaiting = useRef(new Set<IntegrationId>());

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    const left = new Set(leftWaiting.current);
    leftWaiting.current.clear();
    readServices(left)
      .then((read) => {
        if (!current) return;
        setWaiting(read.waiting);
        setIntegrations(read.integrations);
      })
      .catch(onError);
    return () => {
      current = false;
      // Nothing of a visit is drawn at the next before the engine has said it again: a row drawn
      // from the last visit's list would not show the code it left.
      setIntegrations(null);
    };
  }, [open, onError]);

  if (!open || integrations === null) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={titleId}>
      <div>
        <h3 id={titleId} className="text-sm font-medium">
          Integrations
        </h3>
        <p className="text-sm text-muted-foreground">
          Services Scia can use. Each is connected once, with your account.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {integrations.map((integration) => (
          <IntegrationRow
            key={integration.id}
            integration={integration}
            waitingCode={waiting.get(integration.id)}
            onLeftWaiting={() => {
              leftWaiting.current.add(integration.id);
            }}
            onChange={(changed) => {
              setIntegrations((listed) =>
                (listed ?? []).map((other) => (isSameService(other, changed) ? changed : other)),
              );
            }}
          />
        ))}
      </ul>
    </section>
  );
}

// While a code waits to be confirmed on the service's site, the engine is asked this often what
// became of it: the engine itself asks the service every five seconds.
export const CODE_READ_MS = 2000;

// Where the code is confirmed, as a person would type it: the site and the page, no query.
function placeOf(code: IntegrationCode): string {
  const page = URL.parse(code.url);
  return page === null ? code.url : `${page.host}${page.pathname.replace(/\/$/, '')}`;
}

// Asked of two ids as text: with one service known, their type alone would say yes.
function isSameService(one: { readonly id: string }, other: { readonly id: string }): boolean {
  return one.id === other.id;
}

function accountLine(integration: Integration): string {
  if (!integration.connected) return 'Not connected';
  const { account } = integration;
  if (account === null) return 'Connected';
  const premium = !account.premium
    ? 'not premium'
    : account.premiumUntil === null
      ? 'premium'
      : `premium until ${formatDate(account.premiumUntil)}`;
  return [`Connected as ${account.name}`, premium].join(SEPARATOR);
}

interface IntegrationRowProps {
  readonly integration: Integration;
  // A code this row left waiting at the visit before, which still waits: shown from the start.
  readonly waitingCode: IntegrationCode | undefined;
  // The row leaves with a code shown that waits: the engine goes on waiting for it (#146).
  readonly onLeftWaiting: () => void;
  readonly onChange: (integration: Integration) => void;
}

function IntegrationRow({
  integration,
  waitingCode,
  onLeftWaiting,
  onChange,
}: IntegrationRowProps): ReactNode {
  const { id } = integration;
  const name = SERVICE_NAME[id];
  const fieldId = useId();
  const hintId = useId();
  const alertId = useId();
  // A code to confirm on the service's site is the main way to connect; a key is the other (#136).
  const [mode, setMode] = useState<'idle' | 'code' | 'key'>(
    waitingCode === undefined ? 'idle' : 'code',
  );
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<IntegrationCode | null>(waitingCode ?? null);
  const [asking, setAsking] = useState(false);
  // A disconnection is on its way: no way to connect opens before it answers, so that a refusal
  // that comes back is said by the row, never by a form or a code opened meanwhile.
  const [disconnecting, setDisconnecting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const entering = mode === 'key';
  // Set when what the focus is on is about to leave the page: the control named here takes the
  // focus as it arrives.
  const handFocusOn = useRef<FocusTarget | null>(null);
  // The engine holds a code for this row, or is being asked for one.
  const holdsCode = useRef(waitingCode !== undefined);
  // Moved on whenever the person leaves the code — Cancel, "Use an API key", Settings closed — and
  // at every new ask: an answer to an ask that is no longer the last one is not shown.
  const askTurn = useRef(0);
  const row = useRef<HTMLLIElement>(null);
  // Only a focus that is on what leaves is handed on: one that went elsewhere stays there.
  const focusIsHere = () => row.current?.contains(document.activeElement) ?? false;
  const handFocusTo = (target: FocusTarget) => {
    handFocusOn.current = focusIsHere() ? target : null;
  };
  const takeFocus = (target: FocusTarget) => (control: { focus(): void } | null) => {
    if (control === null || handFocusOn.current !== target) return;
    handFocusOn.current = null;
    control.focus();
  };

  // What a reading of the code says, with what the row knows now, not when the wait began.
  const learnCode = useEffectEvent((now: IntegrationCode, connected: Integration | undefined) => {
    if (now.status === IntegrationCodeStatus.Connected) {
      holdsCode.current = false;
      handFocusTo('disconnect');
      setMode('idle');
      setCode(null);
      if (connected !== undefined) onChange(connected);
      return;
    }
    // A sentence about the page not opened is not true of a code that no longer connects.
    if (now.status === IntegrationCodeStatus.Failed) setRefusal(null);
    setCode(now);
  });
  // An engine that no longer knows the code — it was started again — has none to wait for.
  // Anything else is an engine that is restarting: the next reading tells.
  const codeNotRead = useEffectEvent((error: unknown) => {
    if (!(error instanceof ApiError && error.status === 404)) return;
    setRefusal(null);
    setCode((shown) =>
      shown === null
        ? null
        : {
            ...shown,
            status: IntegrationCodeStatus.Failed,
            failure: IntegrationCodeFailure.Expired,
          },
    );
  });

  const waiting = mode === 'code' && code?.status === IntegrationCodeStatus.Waiting;

  // Settings closed, or the row left: a code on screen that waits is waited for by the engine as long
  // as it works, and confirmed later it connects (#146); one still being asked for, which nobody has
  // seen, or one that failed, is forgotten.
  const leaveRow = useEffectEvent(() => {
    askTurn.current += 1;
    if (waiting) onLeftWaiting();
    else if (holdsCode.current) void api.cancelIntegrationCode(id).catch(() => undefined);
  });
  useEffect(
    () => () => {
      leaveRow();
    },
    [],
  );
  useEffect(() => {
    if (!waiting) return undefined;
    let current = true;
    // Read through a function: the flag changes in a callback, after an await.
    const gone = () => !current;
    const read = async () => {
      const now = await api.integrationCode(id);
      const connected =
        now.status === IntegrationCodeStatus.Connected
          ? (await api.integrations()).find((other) => isSameService(other, { id }))
          : undefined;
      if (!gone()) learnCode(now, connected);
    };
    const timer = setInterval(() => {
      read().catch((error: unknown) => {
        if (!gone()) codeNotRead(error);
      });
    }, CODE_READ_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [waiting, id]);

  const startCode = () => {
    if (asking || disconnecting) return;
    askTurn.current += 1;
    const turn = askTurn.current;
    // From the moment it is asked for, the engine may hold a code: leaving cancels it.
    holdsCode.current = true;
    setAsking(true);
    setRefusal(null);
    api
      .startIntegrationCode(id)
      .then((given) => {
        if (turn !== askTurn.current) {
          // The person left while it came: the engine is told to forget it — that code, by
          // name, so that a newer one is not forgotten with it.
          void api.cancelIntegrationCode(id, given.code).catch(() => undefined);
          return;
        }
        handFocusTo('code-action');
        setCode(given);
        setMode('code');
      })
      .catch((error: unknown) => {
        if (turn !== askTurn.current) return;
        holdsCode.current = false;
        setRefusal(codeNotGivenMessage(error, id));
      })
      .finally(() => {
        if (turn === askTurn.current) setAsking(false);
      });
  };

  // The person leaves the code, shown or still coming: the engine forgets it.
  const leaveCode = () => {
    askTurn.current += 1;
    setAsking(false);
    if (holdsCode.current) void api.cancelIntegrationCode(id).catch(() => undefined);
    holdsCode.current = false;
    setCode(null);
    setRefusal(null);
  };

  const cancelCode = () => {
    leaveCode();
    handFocusOn.current = 'connect-code';
    setMode('idle');
  };

  const openCodePage = (shown: IntegrationCode) => {
    setRefusal(null);
    bridge()
      ?.openCodePage(id)
      .catch(() => {
        // Main says only that it failed: the browser, or an engine that no longer has the code.
        setRefusal(`Scia could not open the page. Go to ${placeOf(shown)} and enter the code.`);
      });
  };

  const connect = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Enter in the field while the key is checked: the button that would send it does nothing.
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    api
      .connectIntegration(id, apiKey)
      .then((connected) => {
        handFocusTo('disconnect');
        setMode('idle');
        setApiKey('');
        onChange(connected);
      })
      .catch((error: unknown) => {
        setRefusal(connectFailureMessage(error, id));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const disconnect = () => {
    setRefusal(null);
    setDisconnecting(true);
    api
      .disconnectIntegration(id)
      .then(() => {
        handFocusTo('connect-code');
        onChange({ id, connected: false, account: null, failure: null, keyNotRead: false });
      })
      .catch((error: unknown) => {
        setRefusal(errorMessage(error));
      })
      .finally(() => {
        setDisconnecting(false);
      });
  };

  const alert = refusal !== null && (
    <p id={alertId} role="alert" className="text-sm text-destructive">
      {refusal}
    </p>
  );

  return (
    // Most presses here move the focus — to the code's buttons, to Cancel, back to the row:
    // Enter held on one would press the next (#136).
    <li
      ref={row}
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.repeat) swallowHeldEnter();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          <p role="status" className="text-sm text-muted-foreground">
            {accountLine(integration)}
          </p>
          {integration.connected && integration.failure !== null && (
            <p className="text-sm text-destructive">
              {serviceTroubleMessage(integration.failure, id)}
            </p>
          )}
        </div>
        {integration.connected ? (
          <ConfirmButton
            ref={takeFocus('disconnect')}
            label="Disconnect"
            // The key is removed from this computer: it asks once more.
            confirmLabel="Disconnect"
            destructive
            onConfirm={disconnect}
          >
            <Unplug size={16} aria-hidden="true" />
          </ConfirmButton>
        ) : (
          mode === 'idle' && (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                ref={takeFocus('connect-key')}
                aria-disabled={disconnecting}
                className={QUIET_BUTTON}
                onClick={() => {
                  if (disconnecting) return;
                  // A code still being asked for is left for the key.
                  leaveCode();
                  setMode('key');
                }}
              >
                Use an API key
              </button>
              {/* While a code is asked for, or a disconnection is on its way, it does nothing, and
                  keeps the focus a press gave it. */}
              <button
                type="button"
                ref={takeFocus('connect-code')}
                aria-disabled={asking || disconnecting}
                className={TEXT_BUTTON}
                onClick={startCode}
              >
                {asking ? 'Getting a code…' : 'Connect with a code'}
              </button>
            </div>
          )
        )}
      </div>
      {/* Across the row, under its head: beside the buttons it was a column three words wide.
          Disconnect is the way out for a person who will not connect again (ADR 0023) — offered,
          as the ways to connect are, only while none is open or being asked for: its failure would be
          said by the key's field or the code, and its success would leave the focus on nothing. */}
      {integration.keyNotRead && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-destructive">
            Scia could not read back the key it kept for {name}. Connect it again.
          </p>
          {mode === 'idle' && !asking && (
            <ConfirmButton
              ref={takeFocus('disconnect')}
              label="Disconnect"
              // The key Scia cannot read is removed from this computer: it asks once more.
              confirmLabel="Disconnect"
              destructive
              onConfirm={disconnect}
            >
              <Unplug size={16} aria-hidden="true" />
            </ConfirmButton>
          )}
        </div>
      )}
      {entering && !integration.connected && (
        <form onSubmit={connect} className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-sm font-medium">
            {name} API key
          </label>
          <input
            id={fieldId}
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
            }}
            // What draws the field at rest: its boundary is held to no contrast (#66).
            placeholder="Paste your API key"
            autoFocus
            autoComplete="off"
            // What is being checked is what the field says: it is not changed meanwhile.
            readOnly={busy}
            spellCheck={false}
            aria-invalid={refusal !== null}
            aria-describedby={refusal === null ? hintId : `${alertId} ${hintId}`}
            className={cn(
              'h-9 w-full rounded-lg border border-border bg-transparent px-3 text-sm placeholder:text-muted-foreground',
              FOCUS_RING,
            )}
          />
          {/* By the field it is about, before anything else. */}
          {alert}
          <p id={hintId} className="text-sm text-muted-foreground">
            Create one in your {name} account, under API keys. Scia keeps it where this computer
            protects it.
          </p>
          <div className="flex justify-end gap-2">
            {/* It does nothing while the key is being checked: the check cannot be taken back,
                and a key the service accepts meanwhile is kept. */}
            <button
              type="button"
              aria-disabled={busy}
              className={QUIET_BUTTON}
              onClick={() => {
                if (busy) return;
                handFocusOn.current = 'connect-key';
                setMode('idle');
                setApiKey('');
                setRefusal(null);
              }}
            >
              Cancel
            </button>
            {/* While the key is checked it does nothing, and keeps the focus a press gave it:
                a button the system disables drops the focus on the page. */}
            <button
              type="submit"
              disabled={apiKey.trim() === ''}
              aria-disabled={busy}
              className={TEXT_BUTTON}
            >
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </div>
          {/* Said to who does not see the button change. */}
          <p role="status" className="sr-only">
            {busy ? `Checking the key with ${name}…` : ''}
          </p>
        </form>
      )}
      {mode === 'code' && code !== null && !integration.connected && (
        <CodePanel
          // A new code is a new panel: what it says of its lifetime is its own.
          key={code.code}
          code={code}
          name={name}
          alert={alert}
          // A newer refusal — no new code given — is the one said.
          failure={
            code.failure === null || refusal !== null ? null : codeFailedMessage(code.failure, id)
          }
          asking={asking}
          canOpen={bridge() !== undefined}
          actionRef={takeFocus('code-action')}
          onOpen={() => {
            openCodePage(code);
          }}
          onAgain={startCode}
          onCancel={cancelCode}
        />
      )}
      {mode === 'idle' && alert}
      {/* Said to who does not see the page change, from a line that is always there: a live
          region, not a second status of the row, which is the account line. */}
      <p aria-live="polite" className="sr-only">
        {asking
          ? `Getting a code from ${name}…`
          : mode === 'code' && code?.status === IntegrationCodeStatus.Waiting
            ? `Enter the code ${code.code} on ${placeOf(code)}. Waiting for you to confirm it on ${name}…`
            : ''}
      </p>
    </li>
  );
}

type FocusTarget = 'disconnect' | 'connect-code' | 'connect-key' | 'code-action';

interface CodePanelProps {
  readonly code: IntegrationCode;
  readonly name: string;
  readonly alert: ReactNode;
  // What the code said when it connected nothing.
  readonly failure: string | null;
  // A new code is being asked for.
  readonly asking: boolean;
  // Main opens the service's page; a page in a plain browser has nobody to ask.
  readonly canOpen: boolean;
  readonly actionRef: (control: { focus(): void } | null) => void;
  readonly onOpen: () => void;
  readonly onAgain: () => void;
  readonly onCancel: () => void;
}

function CodePanel({
  code,
  name,
  alert,
  failure,
  asking,
  canOpen,
  actionRef,
  onOpen,
  onAgain,
  onCancel,
}: CodePanelProps): ReactNode {
  const waiting = code.status === IntegrationCodeStatus.Waiting;
  const whereId = useId();
  // How long it lasts, said once and in whole minutes — one at least: a clock that ticks would be
  // read aloud at every tick, and the code was given a moment ago.
  const [lasts] = useState(
    () => Math.max(1, Math.round((Date.parse(code.expiresAt) - Date.now()) / 60_000)) * 60,
  );
  // With no main to open the page, Cancel is what the focus goes to.
  const opens = waiting && canOpen;
  return (
    <div className="flex flex-col gap-2">
      <p id={whereId} className="text-sm">
        On <span className="font-medium">{placeOf(code)}</span>, enter this code:{' '}
        <span className="sr-only">{code.code}</span>
      </p>
      <p aria-hidden="true" className="font-mono text-2xl font-medium tracking-widest select-all">
        {code.code}
      </p>
      {failure !== null && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      {alert}
      {waiting && (
        <p className="text-sm text-muted-foreground">
          Scia connects as soon as you confirm it. The code works for {formatDuration(lasts)}.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          ref={waiting && !canOpen ? actionRef : undefined}
          aria-describedby={waiting && !canOpen ? whereId : undefined}
          className={QUIET_BUTTON}
          onClick={onCancel}
        >
          Cancel
        </button>
        {!waiting ? (
          // While a new code is asked for it does nothing, and keeps the focus a press gave it.
          <button
            type="button"
            ref={actionRef}
            aria-disabled={asking}
            className={TEXT_BUTTON}
            onClick={onAgain}
          >
            {asking ? 'Getting a code…' : 'Get a new code'}
          </button>
        ) : (
          opens && (
            <button
              type="button"
              ref={actionRef}
              aria-describedby={whereId}
              className={TEXT_BUTTON}
              // The second click of a double click opens no second page — also when its first
              // click asked for the code, on the button this one replaced.
              onClick={(event) => {
                if (event.detail > 1) return;
                onOpen();
              }}
            >
              Open {name}
            </button>
          )
        )}
      </div>
    </div>
  );
}
