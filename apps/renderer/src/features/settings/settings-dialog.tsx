import { type Pairing, type Settings, SETTINGS_LIMITS, type SettingsPatch } from '@scia/contracts';
import { FolderChange, isFolderChange } from '@scia/contracts/bridge';
import { Check, Copy, FolderPen, Minus, Plus, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { IconButton } from '@/components/icon-button.tsx';
import { api } from '@/lib/api.ts';
import { bridge } from '@/lib/bridge.ts';
import { FOLDER_REFUSED } from '@/lib/messages.ts';
import { IntegrationsSection } from './integrations.tsx';
import { SpeedLimit } from './speed-limit.tsx';

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onError: (error: unknown) => void;
  // Told every time the dialog learns what the engine keeps: what it read, what it changed.
  readonly onSettings: (settings: Settings) => void;
}

export function SettingsDialog({
  open,
  onClose,
  onError,
  onSettings,
}: SettingsDialogProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const keep = useCallback(
    (kept: Settings) => {
      setSettings(kept);
      onSettings(kept);
    },
    [onSettings],
  );
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [folderRefused, setFolderRefused] = useState(false);
  const shell = bridge();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    // What was said of a folder belongs to the visit in which it was chosen.
    setFolderRefused(false);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    Promise.all([api.settings(), api.pairing()])
      .then(([loadedSettings, loadedPairing]) => {
        if (!current) return;
        keep(loadedSettings);
        setPairing(loadedPairing);
      })
      .catch(onError);
    return () => {
      current = false;
    };
  }, [open, onError, keep]);

  // The page names no folder: main shows the system's dialog and tells the engine, and the
  // page reads back what the engine kept.
  // Main answers what became of the folder; it fails for what is not about a folder (an engine
  // that is silent, or restarting). Either way the settings are read again: an engine that
  // answered main too late may have taken the folder all the same.
  const changeFolder = () => {
    setFolderRefused(false);
    shell
      ?.chooseDownloadFolder()
      .then((change) => {
        if (!isFolderChange(change)) throw new Error('Main did not say what became of the folder.');
        setFolderRefused(change === FolderChange.Refused);
      })
      .catch(onError)
      .then(() => api.settings())
      .then(keep)
      .catch(onError);
  };

  const change = (patch: SettingsPatch) => {
    api.updateSettings(patch).then(keep).catch(onError);
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
          Settings
        </h2>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex flex-col gap-6 px-6 pb-6">
        {settings !== null && (
          <section className="flex flex-col gap-4">
            <Stepper
              label="Simultaneous downloads"
              hint="The others wait in the queue for their turn."
              value={settings.maxConcurrentDownloads}
              {...SETTINGS_LIMITS.maxConcurrentDownloads}
              onChange={(maxConcurrentDownloads) => {
                change({ maxConcurrentDownloads });
              }}
            />
            <Stepper
              label="Connections per download"
              hint="More connections, more speed, as far as the server allows."
              value={settings.connectionsPerDownload}
              {...SETTINGS_LIMITS.connectionsPerDownload}
              onChange={(connectionsPerDownload) => {
                change({ connectionsPerDownload });
              }}
            />
            <SpeedLimit
              value={settings.speedLimitBytesPerSecond}
              onChange={(speedLimitBytesPerSecond) => {
                change({ speedLimitBytesPerSecond });
              }}
            />
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Download folder</p>
                <output
                  className="block truncate text-sm text-muted-foreground"
                  title={settings.downloadDirectory}
                >
                  {settings.downloadDirectory}
                </output>
                {folderRefused && (
                  <p role="alert" className="text-sm text-destructive">
                    {FOLDER_REFUSED}
                  </p>
                )}
              </div>
              {shell !== undefined && (
                <IconButton label="Change folder" className="shrink-0" onClick={changeFolder}>
                  <FolderPen size={16} aria-hidden="true" />
                </IconButton>
              )}
            </div>
          </section>
        )}
        <IntegrationsSection open={open} onError={onError} />
        {pairing !== null && <PairingSection pairing={pairing} onError={onError} />}
        <p className="text-sm text-muted-foreground">Scia {shell?.version ?? 'development'}</p>
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
          label="Decrease"
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
          label="Increase"
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
        <p className="text-sm font-medium">Browser extension</p>
        <p className="text-sm text-muted-foreground">
          Paste this code into the extension’s options. From then on, the extension sends Scia the
          links and the media of your pages.
        </p>
      </div>
      <div className="flex h-10 items-center gap-1 rounded-xl bg-tonal pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate text-sm">{pairing.token}</code>
        <IconButton
          label={copied ? 'Copied' : 'Copy the code'}
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
