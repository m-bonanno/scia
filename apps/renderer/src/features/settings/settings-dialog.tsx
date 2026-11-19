import { type Pairing, type Settings, SETTINGS_LIMITS, type SettingsPatch } from '@scia/contracts';
import { Check, Copy, Minus, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { IconButton } from '@/components/icon-button.tsx';
import { api } from '@/lib/api.ts';
import { bridge } from '@/lib/bridge.ts';

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onError: (error: unknown) => void;
}

export function SettingsDialog({ open, onClose, onError }: SettingsDialogProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    Promise.all([api.settings(), api.pairing()])
      .then(([loadedSettings, loadedPairing]) => {
        if (!current) return;
        setSettings(loadedSettings);
        setPairing(loadedPairing);
      })
      .catch(onError);
    return () => {
      current = false;
    };
  }, [open, onError]);

  const change = (patch: SettingsPatch) => {
    api.updateSettings(patch).then(setSettings).catch(onError);
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="settings-title"
      className="m-auto w-[30rem] max-w-[calc(100vw-2rem)] rounded-2xl bg-surface p-0 text-foreground backdrop:bg-overlay"
    >
      <div className="flex items-center justify-between py-3 pr-3 pl-6">
        <h2 id="settings-title" className="text-base font-semibold">
          Impostazioni
        </h2>
        <IconButton label="Chiudi" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex flex-col gap-6 px-6 pb-6">
        {settings !== null && (
          <section className="flex flex-col gap-4">
            <Stepper
              label="Download contemporanei"
              hint="Gli altri aspettano in coda il loro turno."
              value={settings.maxConcurrentDownloads}
              {...SETTINGS_LIMITS.maxConcurrentDownloads}
              onChange={(maxConcurrentDownloads) => {
                change({ maxConcurrentDownloads });
              }}
            />
            <Stepper
              label="Connessioni per download"
              hint="Più connessioni, più velocità, finché il server lo consente."
              value={settings.connectionsPerDownload}
              {...SETTINGS_LIMITS.connectionsPerDownload}
              onChange={(connectionsPerDownload) => {
                change({ connectionsPerDownload });
              }}
            />
            <div>
              <p className="text-sm font-medium">Cartella dei download</p>
              <p
                className="truncate text-sm text-muted-foreground"
                title={settings.downloadDirectory}
              >
                {settings.downloadDirectory}
              </p>
            </div>
          </section>
        )}
        {pairing !== null && <PairingSection pairing={pairing} onError={onError} />}
        <p className="text-sm text-muted-foreground">Scia {bridge()?.version ?? 'sviluppo'}</p>
      </div>
    </dialog>
  );
}

interface StepperProps {
  readonly label: string;
  readonly hint: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}

function Stepper({ label, hint, value, min, max, onChange }: StepperProps): ReactNode {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium">
          {label}
        </p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-labelledby={labelId}>
        <IconButton
          label="Riduci"
          disabled={value <= min}
          onClick={() => {
            onChange(value - 1);
          }}
        >
          <Minus size={16} aria-hidden="true" />
        </IconButton>
        <output className="w-7 text-center text-[0.9375rem] font-medium tabular-nums">
          {value}
        </output>
        <IconButton
          label="Aumenta"
          disabled={value >= max}
          onClick={() => {
            onChange(value + 1);
          }}
        >
          <Plus size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

const COPIED_FOR_MS = 2000;

function PairingSection({
  pairing,
  onError,
}: {
  readonly pairing: Pairing;
  readonly onError: (error: unknown) => void;
}): ReactNode {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_FOR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  return (
    <section className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium">Estensione del browser</p>
        <p className="text-sm text-muted-foreground">
          Copia questo codice nelle opzioni dell’estensione: da quel momento manda a Scia i link e i
          media delle pagine.
        </p>
      </div>
      <div className="flex h-10 items-center gap-1 rounded-xl bg-tonal pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate text-sm">{pairing.token}</code>
        <IconButton
          label={copied ? 'Copiato' : 'Copia il codice'}
          onClick={() => {
            navigator.clipboard
              .writeText(pairing.token)
              .then(() => {
                setCopied(true);
              })
              .catch(onError);
          }}
        >
          {copied ? (
            <Check size={16} aria-hidden="true" className="text-accent" />
          ) : (
            <Copy size={16} aria-hidden="true" />
          )}
        </IconButton>
      </div>
    </section>
  );
}
