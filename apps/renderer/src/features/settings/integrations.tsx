import type { Integration } from '@scia/contracts';
import { Unplug } from 'lucide-react';
import { type ReactNode, type SubmitEvent, useEffect, useId, useRef, useState } from 'react';
import { FOCUS_RING, TEXT_BUTTON } from '@/components/button-styles.ts';
import { ConfirmButton } from '@/components/confirm-button.tsx';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { formatDate, SEPARATOR } from '@/lib/format.ts';
import {
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
          Services Scia can download through. Each is connected once, with the key of your account.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {integrations.map((integration, index) => (
          <IntegrationRow
            key={integration.id}
            integration={integration}
            onChange={(changed) => {
              setIntegrations((listed) =>
                (listed ?? []).map((other, at) => (at === index ? changed : other)),
              );
            }}
          />
        ))}
      </ul>
    </section>
  );
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
  const [entering, setEntering] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Set when what the focus is on is about to leave the page: the control that takes its
  // place takes the focus too, as it arrives.
  const handFocusOn = useRef(false);
  const takeFocus = (control: { focus(): void } | null) => {
    if (control === null || !handFocusOn.current) return;
    handFocusOn.current = false;
    control.focus();
  };

  const connect = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (key === '' || busy) return;
    setBusy(true);
    setRefusal(null);
    api
      .connectIntegration(id, key)
      .then((connected) => {
        handFocusOn.current = true;
        setEntering(false);
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
        handFocusOn.current = true;
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
    <li className="flex flex-col gap-3">
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
            ref={takeFocus}
            label="Disconnect"
            // The key is removed from this computer: it asks once more.
            confirmLabel="Disconnect"
            destructive
            onConfirm={disconnect}
          >
            <Unplug size={16} aria-hidden="true" />
          </ConfirmButton>
        ) : (
          !entering && (
            <button
              type="button"
              ref={takeFocus}
              className={TEXT_BUTTON}
              onClick={() => {
                setEntering(true);
              }}
            >
              Connect
            </button>
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
            <button
              type="button"
              className={TEXT_BUTTON}
              onClick={() => {
                handFocusOn.current = true;
                setEntering(false);
                setApiKey('');
                setRefusal(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" disabled={apiKey.trim() === '' || busy} className={TEXT_BUTTON}>
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </div>
        </form>
      )}
      {!entering && alert}
    </li>
  );
}
