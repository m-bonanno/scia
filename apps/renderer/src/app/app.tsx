import { ApiErrorCode, type Settings } from '@scia/contracts';
import { DownloadStatus, isUnderWay } from '@scia/core';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TEXT_BUTTON } from '@/components/button-styles.ts';
import { AccountMagnets } from '@/features/account/account-magnets.tsx';
import { type Added, AddBar } from '@/features/downloads/add-bar.tsx';
import { type Pasted, pastedIn } from '@/features/downloads/pasted.ts';
import { DownloadList } from '@/features/downloads/download-list.tsx';
import type { RowActions } from '@/features/downloads/download-row.tsx';
import type { BundleActions } from '@/features/downloads/bundle-row.tsx';
import type { MagnetActions } from '@/features/downloads/magnet-row.tsx';
import { FilterTabs, type FilterTabsHandle } from '@/features/downloads/filter-tabs.tsx';
import { countByFilter, Filter, matchesFilter } from '@/features/downloads/filters.ts';
import { Notices } from '@/features/notices/notices.tsx';
import { useNotices } from '@/features/notices/use-notices.ts';
import { SettingsDialog, type SettingsLayer } from '@/features/settings/settings-dialog.tsx';
import { UpdateOffer } from '@/features/update/update-offer.tsx';
import { api, ApiError } from '@/lib/api.ts';
import { bridge } from '@/lib/bridge.ts';
import { Connection, useLive } from '@/lib/live.ts';
import {
  bundleActionMessage,
  ENGINE_UNREACHABLE,
  errorMessage,
  FILE_NOT_OPENED,
  magnetActionMessage,
} from '@/lib/messages.ts';
import { wearTheme } from '@/lib/theme.ts';
import { TitleBar } from './title-bar.tsx';

const PANEL_ID = 'account-magnets';

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function App(): ReactNode {
  const live = useLive();
  const [filter, setFilter] = useState<Filter>(Filter.All);
  const { notices, tell, dismiss } = useNotices();
  const [noticesHeight, setNoticesHeight] = useState(0);
  // Whether a press of the pointer is in this task: the focus it gives is not scrolled.
  const pressing = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLayer, setSettingsLayer] = useState<SettingsLayer | null>(null);
  const [speedLimit, setSpeedLimit] = useState<number | null>(null);
  // Whether AllDebrid is connected, from the last ask: it offers the panel of its magnets, and the
  // field names magnets.
  const [connected, setConnected] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // Each close of Settings, where a key may have been mended: the panel asks again at once.
  const [settingsClosed, setSettingsClosed] = useState(0);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const connectedAsks = useRef(0);

  const report = useCallback(
    (error: unknown) => {
      tell(errorMessage(error));
    },
    [tell],
  );

  // The update a quit would install, as main says it: asked at the start, whenever main says it
  // changed, and whenever the settings are learned — a beta is offered only while its switch is on.
  // Only the last ask is kept.
  const [offered, setOffered] = useState<string | null>(null);
  const offerAsked = useRef(0);
  const askOffer = useCallback(() => {
    const shell = bridge();
    if (shell === undefined) return;
    offerAsked.current += 1;
    const mine = offerAsked.current;
    const keep = (answer: unknown) => {
      if (mine !== offerAsked.current) return;
      setOffered(typeof answer === 'string' && answer !== '' ? answer : null);
    };
    shell.updateOffered().then(keep, () => {
      keep(null);
    });
  }, []);
  useEffect(() => {
    const shell = bridge();
    if (shell === undefined) return undefined;
    askOffer();
    return shell.onUpdateChanged(askOffer);
  }, [askOffer]);

  const keepSettings = useCallback(
    (settings: Settings) => {
      askOffer();
      setSpeedLimit(settings.speedLimitBytesPerSecond);
      wearTheme(settings.theme);
    },
    [askOffer],
  );

  // Learned when the engine is reached, whenever Settings closes, where a service is connected or
  // let go, and when the engine's events say the services changed; an answer to an ask that is no
  // longer the last is not kept.
  const learnConnected = useCallback(() => {
    connectedAsks.current += 1;
    const ask = connectedAsks.current;
    api
      .integrations()
      .then((integrations) => {
        if (ask !== connectedAsks.current) return;
        const on = integrations.some((integration) => integration.connected);
        setConnected(on);
        if (!on) setPanelOpen(false);
      })
      // An engine that did not answer: what was learned last stands, and the notice that the
      // engine is not responding says the rest.
      .catch(() => undefined);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    panelToggle.current?.focus();
  }, []);

  // The limit the title bar names and the theme the page wears are the engine's: read when the
  // engine is reached, and again whenever it comes back. A read that fails all the same is not
  // reported here: the limit still holds, and Settings, which reports its own read, tells this
  // page what it learns.
  const reached = live.connection === Connection.Live;
  useEffect(() => {
    if (!reached) return undefined;
    let current = true;
    api
      .settings()
      .then((settings) => {
        if (current) keepSettings(settings);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [reached, keepSettings]);

  // Asked again when the engine says its services changed: a code confirmed once Settings closed
  // connects one with nobody in Settings (#146).
  const services = live.connectedServices.join(' ');
  useEffect(() => {
    if (reached) learnConnected();
  }, [reached, services, learnConnected]);

  // From the field, a refusal of what was sent is the field's to say; anything else, and any
  // failure of links pasted on the page, is a notice. Links and magnets are sent apart: when one
  // half is refused, the other is taken, and the field keeps only what was refused.
  const add = useCallback(
    async ({ links, magnets }: Pasted, fromField: boolean): Promise<Added> => {
      const halves = [links, magnets] as const;
      const answers = await Promise.allSettled([
        links.length === 0 ? Promise.resolve() : api.addDownloads(links),
        magnets.length === 0 ? Promise.resolve() : api.addMagnets(magnets),
      ]);
      const refused = halves.filter((_, index) => answers[index]?.status === 'rejected').flat();
      if (refused.length < links.length + magnets.length) {
        setFilter((current) => (current === Filter.Completed ? Filter.All : current));
      }
      if (refused.length === 0) return { taken: true };
      let refusal: string | null = null;
      for (const answer of answers) {
        if (answer.status === 'fulfilled') continue;
        const error: unknown = answer.reason;
        const theFields =
          fromField && error instanceof ApiError && error.code === ApiErrorCode.InvalidRequest;
        if (theFields && refusal === null) refusal = errorMessage(error);
        else report(error);
      }
      const partly = refused.length < links.length + magnets.length;
      return { taken: false, refusal, left: partly ? refused.join(' ') : null };
    },
    [report],
  );

  // A link on the clipboard is a download one keystroke away: Ctrl+V anywhere but in a field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTextField(event.target)) return;
      const pasted = pastedIn(event.clipboardData?.getData('text/plain') ?? '');
      if (pasted.links.length > 0 || pasted.magnets.length > 0) void add(pasted, false);
    };
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('paste', onPaste);
    };
  }, [add]);

  // The rows a press may make leave the list, by the id it named: a copied folder at its Start, a
  // link of several files at "Download" and at Remove (#181). A row that leaves by itself — an
  // album read, a link that opens into one file — is not among them, and moves no focus.
  const pressedRows = useRef(new Set<string>());
  const actions = useMemo((): RowActions => {
    const shell = bridge();
    return {
      start: (id) => {
        pressedRows.current.add(id);
        api.start(id).catch(report);
      },
      pause: (id) => {
        api.pause(id).catch(report);
      },
      resume: (id) => {
        api.resume(id).catch(report);
      },
      remove: (id) => {
        api.remove(id, false).catch(report);
      },
      reveal:
        shell === undefined
          ? undefined
          : (id) => {
              shell.revealDownload(id).catch(report);
            },
      open:
        shell === undefined
          ? undefined
          : (id) => {
              shell.openDownload(id).catch(() => {
                tell(FILE_NOT_OPENED);
              });
            },
    };
  }, [report, tell]);

  const bundleActions = useMemo(
    (): BundleActions => ({
      start: (id, files) => {
        pressedRows.current.add(id);
        return api.startBundle(id, files).then(
          () => true,
          (error: unknown) => {
            tell(bundleActionMessage(error, 'start'));
            return false;
          },
        );
      },
      retry: (id) => {
        api.retryBundle(id).catch((error: unknown) => {
          tell(bundleActionMessage(error, 'retry'));
        });
      },
      remove: (id) => {
        pressedRows.current.add(id);
        api.removeBundle(id).catch((error: unknown) => {
          tell(bundleActionMessage(error, 'remove'));
        });
      },
    }),
    [tell],
  );

  const magnetActions = useMemo(
    (): MagnetActions => ({
      retry: (id) => {
        api.retryMagnet(id).catch((error: unknown) => {
          tell(magnetActionMessage(error));
        });
      },
      remove: (id) => {
        api.removeMagnet(id).catch((error: unknown) => {
          tell(magnetActionMessage(error));
        });
      },
    }),
    [tell],
  );

  // Newest first: what was just added is what the eye looks for.
  const visible = useMemo(
    () => live.downloads.filter((download) => matchesFilter(filter, download.status)).reverse(),
    [live.downloads, filter],
  );
  const shell = bridge();
  const bytesPerSecond = live.downloads.reduce((sum, download) => sum + download.bytesPerSecond, 0);
  const hasReady = live.downloads.some((download) => download.status === DownloadStatus.Ready);
  // "Start all" leaves the page under its own press. Decided when it leaves, from where the focus
  // is then: a focus left on nothing goes to the filter in use, beside it; one that went anywhere
  // else stays where it is.
  const filterTabs = useRef<FilterTabsHandle>(null);
  useEffect(() => {
    if (hasReady) return;
    if (document.activeElement === null || document.activeElement === document.body) {
      filterTabs.current?.focus();
    }
  }, [hasReady]);
  // So does a row that leaves under its own press (`pressedRows`).
  const rowIds = [...live.downloads, ...live.bundles].map((row) => row.id).join(' ');
  const rowsBefore = useRef(rowIds);
  useEffect(() => {
    const now = new Set(rowIds.split(' '));
    const left = rowsBefore.current.split(' ').filter((id) => id !== '' && !now.has(id));
    rowsBefore.current = rowIds;
    const pressed = left.filter((id) => pressedRows.current.delete(id));
    if (pressed.length === 0) return;
    if (document.activeElement === null || document.activeElement === document.body) {
      filterTabs.current?.focus();
    }
  }, [rowIds]);

  // How tall the notices are, for the room every area that scrolls beneath them keeps under its
  // end (`room-under-notices` in styles.css). Settings, inside this element, keeps its own.
  const noticesRoom = { '--notices-height': `${String(noticesHeight)}px` } as CSSProperties;

  return (
    <div
      className="flex h-screen flex-col"
      style={noticesRoom}
      // Chromium keeps what Tab moves to clear of that room, but not a focus the page moves itself
      // onto a control already in the scrollport: `nearest` does, for both (#143). Not the focus a
      // press of the pointer gives, at the press: moved before it is let go, the control would no
      // longer be under the pointer, and the click would be lost (round 2 of #244). Marked at
      // `mousedown`, which comes in the same task as that focus for a mouse, a pen and a finger's
      // tap alike — a tap's `pointerdown` comes before it, a task or more ahead (round 3).
      onMouseDownCapture={() => {
        pressing.current = true;
        setTimeout(() => {
          pressing.current = false;
        });
      }}
      onFocus={(event) => {
        if (noticesHeight > 0 && !pressing.current) {
          event.target.scrollIntoView({ block: 'nearest' });
        }
      }}
    >
      <TitleBar
        bytesPerSecond={bytesPerSecond}
        speedLimitBytesPerSecond={speedLimit}
        onOpenSettings={() => {
          setSettingsOpen(true);
        }}
        magnetsToggleRef={panelToggle}
        {...(connected
          ? {
              magnets: {
                open: panelOpen,
                panelId: PANEL_ID,
                onToggle: () => {
                  if (panelOpen) closePanel();
                  else setPanelOpen(true);
                },
              },
            }
          : {})}
        beside={
          shell === undefined ? undefined : (
            <UpdateOffer
              version={shell.version}
              offered={offered}
              downloading={live.downloads.some((download) => isUnderWay(download.status))}
              onRestart={() => shell.restartToUpdate()}
              onGone={askOffer}
              home={() => field.current}
            />
          )
        }
      />
      <div className="relative flex min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-4 pb-4">
            <AddBar
              onAdd={(pasted) => add(pasted, true)}
              inputRef={field}
              takesMagnets={connected}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FilterTabs
                ref={filterTabs}
                filter={filter}
                counts={countByFilter(live.downloads, live.magnets.length + live.bundles.length)}
                onChange={setFilter}
              />
              {hasReady && (
                <button
                  type="button"
                  className={TEXT_BUTTON}
                  onClick={() => {
                    api.startReady().catch(report);
                  }}
                >
                  Start all
                </button>
              )}
            </div>
          </div>
          <div className="room-under-notices min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 pb-8">
              {live.connection !== Connection.Connecting && (
                <DownloadList
                  downloads={visible}
                  magnets={live.magnets}
                  bundles={live.bundles}
                  filter={filter}
                  actions={actions}
                  magnetActions={magnetActions}
                  bundleActions={bundleActions}
                />
              )}
            </div>
          </div>
        </main>
        {panelOpen && (
          <AccountMagnets id={PANEL_ID} again={settingsClosed} onClose={closePanel} tell={tell} />
        )}
      </div>
      <SettingsDialog
        ref={setSettingsLayer}
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsClosed((times) => times + 1);
          learnConnected();
        }}
        onError={report}
        onSettings={keepSettings}
        noticesHeight={noticesHeight}
      />
      {/* Over Settings while it is open: a modal dialog leaves the rest of the page out of reach.
          A focus whose notices are all gone goes to the field, or to the top of the dialog. */}
      <Notices
        notices={notices}
        lasting={live.connection === Connection.Offline ? ENGINE_UNREACHABLE : null}
        onDismiss={dismiss}
        onHeight={setNoticesHeight}
        home={() => (settingsOpen ? (settingsLayer?.top() ?? null) : field.current)}
        layer={settingsOpen ? (settingsLayer?.element ?? null) : null}
      />
    </div>
  );
}
