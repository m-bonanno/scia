import { type Settings, SETTINGS_LIMITS, type SettingsPatch } from '@scia/contracts';
import { FolderChange, isFolderChange, SELF_UPDATING_PLATFORMS } from '@scia/contracts/bridge';
import { Minus, Plus, X } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { TEXT_BUTTON } from '@/components/button-styles.ts';
import { IconButton } from '@/components/icon-button.tsx';
import { api } from '@/lib/api.ts';
import { bridge } from '@/lib/bridge.ts';
import { cn } from '@/lib/cn.ts';
import { FOLDER_REFUSED } from '@/lib/messages.ts';
import { SettingSwitch } from './setting-switch.tsx';
import { IntegrationsSection } from './integrations.tsx';
import { SpeedLimit } from './speed-limit.tsx';
import { SupportScia } from './support-scia.tsx';
import { roomOverDialog } from './room-over-dialog.ts';
import { ThemeChoice } from './theme-choice.tsx';

// What the window keeps above and below the dialog at its tallest — Chromium's own gap, 2em and
// 6 px, made the page's: the room under the notices is measured from it, and a computed
// `max-height` is no number (`calc(100% - 38px)`, read in Chromium in round 2 of #244).
const DIALOG_GAP_PX = 38;

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onError: (error: unknown) => void;
  // Told every time the dialog learns what the engine keeps: what it read, what it changed.
  readonly onSettings: (settings: Settings) => void;
  // How tall the notices at the window's bottom are: 0 while none is shown.
  readonly noticesHeight?: number;
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
  noticesHeight = 0,
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
  const folderLabelId = useId();
  const folderPathId = useId();
  const folderRefusalId = useId();
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

  // The room it keeps under its end, only where the notices would lie over what it shows: a
  // dialog they do not reach does not move. Read again as they, it or the window change size.
  const shown = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const element = dialog.current;
    const content = shown.current;
    if (!open || element === null || content === null) {
      setRoom(0);
      return undefined;
    }
    const measure = () => {
      setRoom(
        roomOverDialog({
          stack: noticesHeight,
          content: content.offsetHeight,
          window: window.innerHeight,
          tallest: window.innerHeight - DIALOG_GAP_PX,
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [open, noticesHeight]);

  const change = (patch: SettingsPatch) => {
    learn(api.updateSettings(patch)).catch(onError);
  };

  // No `p-0`: Tailwind writes it after `room-under-notices`, and it would take the room away.
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="settings-title"
      style={
        {
          '--notices-height': `${String(room)}px`,
          maxHeight: `calc(100vh - ${String(DIALOG_GAP_PX)}px)`,
        } as CSSProperties
      }
      className="room-under-notices m-auto w-[30rem] max-w-[calc(100vw-2rem)] rounded-2xl bg-surface px-0 pt-0 text-foreground backdrop:bg-overlay"
    >
      <div ref={shown}>
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
                  <p id={folderLabelId} className="text-sm font-medium">
                    Download folder
                  </p>
                  {/* Written right to left, the box cuts a long path at its start, so that the
                      name just chosen shows (#40); the path inside keeps its own order, and so
                      does its tooltip, which takes the direction of what carries the title. */}
                  <output
                    id={folderPathId}
                    dir="rtl"
                    className="block truncate text-left text-sm text-muted-foreground"
                  >
                    <bdi dir="ltr" title={settings.downloadDirectory}>
                      {settings.downloadDirectory}
                    </bdi>
                  </output>
                  {folderRefused && (
                    <p id={folderRefusalId} role="alert" className="text-sm text-destructive">
                      {FOLDER_REFUSED}
                    </p>
                  )}
                </div>
                {/* Its one word is told what it changes by the setting beside it, and by the
                    refusal while there is one. The margin sets it in the middle of the label and
                    the path, where the refusal does not move it. */}
                {shell !== undefined && (
                  <button
                    type="button"
                    aria-describedby={
                      folderRefused
                        ? `${folderLabelId} ${folderPathId} ${folderRefusalId}`
                        : `${folderLabelId} ${folderPathId}`
                    }
                    className={cn(TEXT_BUTTON, 'mt-1')}
                    onClick={changeFolder}
                  >
                    Change…
                  </button>
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
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-sm text-muted-foreground">Scia {shell?.version ?? 'development'}</p>
            <SupportScia open={open} />
          </div>
        </div>
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
