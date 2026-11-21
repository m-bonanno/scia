import {
  type Integration,
  type IntegrationCode,
  IntegrationCodeFailure,
  IntegrationCodeStatus,
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

export function IntegrationsSection({ open, onError }: IntegrationsSectionProps): ReactNode {
  const titleId = useId();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    api
      .integrations()
      .then((listed) => {
        if (current) setIntegrations(listed);
      })
      .catch(onError);
    return () => {
      current = false;
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
          Services Scia can use. Each is connected once, with the key of your account.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {integrations.map((integration) => (
          <IntegrationRow
            key={integration.id}
            integration={integration}
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
  readonly onChange: (integration: Integration) => void;
}

function IntegrationRow({ integration, onChange }: IntegrationRowProps): ReactNode {
  const { id } = integration;
  const name = SERVICE_NAME[id];
  const fieldId = useId();
  const hintId = useId();
  const alertId = useId();
  // A code to confirm on the service's site is the main way to connect; a key is the other (#136).
  const [mode, setMode] = useState<'idle' | 'code' | 'key'>('idle');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<IntegrationCode | null>(null);
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const entering = mode === 'key';
  // Set when what the focus is on is about to leave the page: the control named here takes the
  // focus as it arrives.
  const handFocusOn = useRef<FocusTarget | null>(null);
  // The engine holds a code for this row: it is cancelled when the row leaves the page.
  const holdsCode = useRef(false);
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

  // Settings closed, or the row left: a code nobody can see is not waited for.
  useEffect(
    () => () => {
      if (holdsCode.current) void api.cancelIntegrationCode(id).catch(() => undefined);
    },
    [id],
  );

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
    setCode(now);
  });
  // An engine that no longer knows the code — it was started again — has none to wait for.
  // Anything else is an engine that is restarting: the next reading tells.
  const codeNotRead = useEffectEvent((error: unknown) => {
    if (!(error instanceof ApiError && error.status === 404)) return;
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
    if (asking) return;
    setAsking(true);
    setRefusal(null);
    api
      .startIntegrationCode(id)
      .then((given) => {
        holdsCode.current = true;
        handFocusTo('code-action');
        setCode(given);
        setMode('code');
      })
      .catch((error: unknown) => {
        setRefusal(codeNotGivenMessage(error, id));
      })
      .finally(() => {
        setAsking(false);
      });
  };

  const cancelCode = () => {
    holdsCode.current = false;
    void api.cancelIntegrationCode(id).catch(() => undefined);
    handFocusOn.current = 'connect-code';
    setMode('idle');
    setCode(null);
    setRefusal(null);
  };

  const openCodePage = (shown: IntegrationCode) => {
    setRefusal(null);
    bridge()
      ?.openCodePage(id)
      .catch(() => {
        setRefusal(`Scia could not open your browser. Go to ${placeOf(shown)} and enter the code.`);
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
    api
      .disconnectIntegration(id)
      .then(() => {
        handFocusTo('connect-code');
        onChange({ id, connected: false, account: null, failure: null });
      })
      .catch((error: unknown) => {
        setRefusal(errorMessage(error));
      });
  };

  const alert = refusal !== null && (
    <p id={alertId} role="alert" className="text-sm text-destructive">
      {refusal}
    </p>
  );

  return (
    <li ref={row} className="flex flex-col gap-3">
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
                className={QUIET_BUTTON}
                onClick={() => {
                  setRefusal(null);
                  setMode('key');
                }}
              >
                Use an API key
              </button>
              {/* While a code is asked for it does nothing, and keeps the focus a press gave it. */}
              <button
                type="button"
                ref={takeFocus('connect-code')}
                aria-disabled={asking}
                className={TEXT_BUTTON}
                onClick={startCode}
              >
                {asking ? 'Getting a code…' : 'Connect with a code'}
              </button>
            </div>
          )
        )}
      </div>
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
            autoFocus
            autoComplete="off"
            // What is being checked is what the field says: it is not changed meanwhile.
            readOnly={busy}
            spellCheck={false}
            aria-invalid={refusal !== null}
            aria-describedby={refusal === null ? hintId : `${alertId} ${hintId}`}
            className={cn(
              'h-9 w-full rounded-lg border border-border bg-transparent px-3 text-sm',
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
          code={code}
          name={name}
          alert={alert}
          failure={code.failure === null ? null : codeFailedMessage(code.failure, id)}
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
  canOpen,
  actionRef,
  onOpen,
  onAgain,
  onCancel,
}: CodePanelProps): ReactNode {
  const waiting = code.status === IntegrationCodeStatus.Waiting;
  // How long it lasts, said once and in whole minutes: a clock that ticks would be read aloud at
  // every tick, and the code was given a moment ago.
  const [lasts] = useState(
    () => Math.round((Date.parse(code.expiresAt) - Date.now()) / 60_000) * 60,
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        On <span className="font-medium">{placeOf(code)}</span>, enter this code:
      </p>
      <p className="font-mono text-2xl font-medium tracking-widest select-all">{code.code}</p>
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
        <button type="button" className={QUIET_BUTTON} onClick={onCancel}>
          Cancel
        </button>
        {!waiting ? (
          <button type="button" ref={actionRef} className={TEXT_BUTTON} onClick={onAgain}>
            Get a new code
          </button>
        ) : (
          canOpen && (
            <button type="button" ref={actionRef} className={TEXT_BUTTON} onClick={onOpen}>
              Open {name}
            </button>
          )
        )}
      </div>
      {/* Said to who does not see the page change. */}
      <p role="status" className="sr-only">
        {waiting ? `Waiting for you to confirm the code on ${name}…` : ''}
      </p>
    </div>
  );
}
