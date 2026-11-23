import { type Settings, SETTINGS_LIMITS, type SettingsPatch } from '@scia/contracts';
import { FolderChange, isFolderChange, SELF_UPDATING_PLATFORMS } from '@scia/contracts/bridge';
import { FolderPen, Minus, Plus, X } from 'lucide-react';
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { IconButton } from '@/components/icon-button.tsx';
import { api } from '@/lib/api.ts';
import { bridge } from '@/lib/bridge.ts';
import { FOLDER_REFUSED } from '@/lib/messages.ts';
import { SettingSwitch } from './setting-switch.tsx';
import { IntegrationsSection } from './integrations.tsx';
import { SpeedLimit } from './speed-limit.tsx';
import { ThemeChoice } from './theme-choice.tsx';

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onError: (error: unknown) => void;
  // Told every time the dialog learns what the engine keeps: what it read, what it changed.
  readonly onSettings: (settings: Settings) => void;
  readonly ref?: Ref<SettingsLayer | null>;
}

// What the page draws over Settings while it is open — its notices — needs the dialog, and the
// top of it for a focus left on nothing there.
export interface SettingsLayer {
  readonly element: HTMLDialogElement;
  readonly top: () => HTMLElement | null;
}

export function SettingsDialog({
  open,
  onClose,
  onError,
  onSettings,
  ref,
}: SettingsDialogProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useImperativeHandle<SettingsLayer | null, SettingsLayer | null>(
    ref,
    () => (dialog.current === null ? null : { element: dialog.current, top: () => close.current }),
    [],
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const keep = useCallback(
    (kept: Settings) => {
      setSettings(kept);
      onSettings(kept);
    },
    [onSettings],
  );
  // The engine is asked what it keeps at every opening, at every change, and after a folder was
  // chosen. An answer is kept only when nothing was asked after it: a read asked before a change
  // says what was there before it, whenever it arrives.
  const asked = useRef(0);
  const learn = useCallback(
    (ask: Promise<Settings>): Promise<void> => {
      asked.current += 1;
      const mine = asked.current;
      return ask.then((answer) => {
        if (mine === asked.current) keep(answer);
      });
    },
    [keep],
  );
  const [folderRefused, setFolderRefused] = useState(false);
  const shell = bridge();
  // The betas are offered where Scia updates itself: in the app, on a system with an installer.
  const updatesItself =
    shell !== undefined && (SELF_UPDATING_PLATFORMS as readonly string[]).includes(shell.platform);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    // What was said of a folder belongs to the visit in which it was chosen.
    setFolderRefused(false);
  }, [open]);

  useEffect(() => {
    if (open) learn(api.settings()).catch(onError);
  }, [open, onError, learn]);

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
      .then(() => learn(api.settings()))
      .catch(onError);
  };

  const change = (patch: SettingsPatch) => {
    learn(api.updateSettings(patch)).catch(onError);
  };

  // No `p-0`: Tailwind writes it after `room-under-notices`, and it would take the room away.
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="settings-title"
      className="room-under-notices m-auto w-[30rem] max-w-[calc(100vw-2rem)] rounded-2xl bg-surface px-0 pt-0 text-foreground backdrop:bg-overlay"
    >
      <div className="flex items-center justify-between py-3 pr-3 pl-6">
        <h2 id="settings-title" className="text-base font-semibold">
          Settings
        </h2>
        <IconButton ref={close} label="Close" onClick={onClose}>
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
            <ThemeChoice
              value={settings.theme}
              onChange={(theme) => {
                change({ theme });
              }}
            />
            {/* Main reads the clipboard: a browser tab has no main to do it. */}
            {shell !== undefined && (
              <SettingSwitch
                label="Take links from the clipboard"
                hint="Links to files and videos you copy appear in the list, ready to start."
                value={settings.watchClipboard}
                onChange={(watchClipboard) => {
                  change({ watchClipboard });
                }}
              />
            )}
          </section>
        )}
        <IntegrationsSection open={open} onError={onError} />
        {settings !== null && updatesItself && (
          <SettingSwitch
            label="Beta versions"
            hint="Also update to versions still being tried. Scia updates itself when you quit it."
            value={settings.betaUpdates}
            onChange={(betaUpdates) => {
              change({ betaUpdates });
            }}
          />
        )}
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
