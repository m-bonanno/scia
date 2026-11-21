import { ApiErrorCode, type Settings } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TEXT_BUTTON } from '@/components/button-styles.ts';
import { type Added, AddBar } from '@/features/downloads/add-bar.tsx';
import { DownloadList } from '@/features/downloads/download-list.tsx';
import type { RowActions } from '@/features/downloads/download-row.tsx';
import { FilterTabs, type FilterTabsHandle } from '@/features/downloads/filter-tabs.tsx';
import { countByFilter, Filter, matchesFilter } from '@/features/downloads/filters.ts';
import { extractLinks } from '@scia/contracts/links';
import { Notices } from '@/features/notices/notices.tsx';
import { useNotices } from '@/features/notices/use-notices.ts';
import { SettingsDialog, type SettingsLayer } from '@/features/settings/settings-dialog.tsx';
import { api, ApiError } from '@/lib/api.ts';
import { bridge } from '@/lib/bridge.ts';
import { Connection, useLive } from '@/lib/live.ts';
import { ENGINE_UNREACHABLE, errorMessage, FILE_NOT_OPENED } from '@/lib/messages.ts';
import { wearTheme } from '@/lib/theme.ts';
import { TitleBar } from './title-bar.tsx';

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function App(): ReactNode {
  const live = useLive();
  const [filter, setFilter] = useState<Filter>(Filter.All);
  const { notices, tell, dismiss } = useNotices();
  const field = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLayer, setSettingsLayer] = useState<SettingsLayer | null>(null);
  const [speedLimit, setSpeedLimit] = useState<number | null>(null);

  const report = useCallback(
    (error: unknown) => {
      tell(errorMessage(error));
    },
    [tell],
  );

  const keepSettings = useCallback((settings: Settings) => {
    setSpeedLimit(settings.speedLimitBytesPerSecond);
    wearTheme(settings.theme);
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

  // From the field, a refusal of what was sent is the field's to say; anything else, and any
  // failure of links pasted on the page, is a notice.
  const add = useCallback(
    async (urls: string[], fromField: boolean): Promise<Added> => {
      try {
        await api.addDownloads(urls);
        setFilter((current) => (current === Filter.Completed ? Filter.All : current));
        return { taken: true };
      } catch (error) {
        if (fromField && error instanceof ApiError && error.code === ApiErrorCode.InvalidRequest) {
          return { taken: false, refusal: errorMessage(error) };
        }
        report(error);
        return { taken: false, refusal: null };
      }
    },
    [report],
  );

  // A link on the clipboard is a download one keystroke away: Ctrl+V anywhere but in a field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTextField(event.target)) return;
      const links = extractLinks(event.clipboardData?.getData('text/plain') ?? '');
      if (links.length > 0) void add(links, false);
    };
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('paste', onPaste);
    };
  }, [add]);

  const actions = useMemo((): RowActions => {
    const shell = bridge();
    return {
      start: (id) => {
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

  // Newest first: what was just added is what the eye looks for.
  const visible = useMemo(
    () => live.downloads.filter((download) => matchesFilter(filter, download.status)).reverse(),
    [live.downloads, filter],
  );
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

  return (
    <div className="flex h-screen flex-col">
      <TitleBar
        bytesPerSecond={bytesPerSecond}
        speedLimitBytesPerSecond={speedLimit}
        onOpenSettings={() => {
          setSettingsOpen(true);
        }}
      />
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-4 pb-4">
          <AddBar onAdd={(urls) => add(urls, true)} inputRef={field} />
          <div className="flex items-center justify-between gap-2">
            <FilterTabs
              ref={filterTabs}
              filter={filter}
              counts={countByFilter(live.downloads)}
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 pb-8">
            {live.connection !== Connection.Connecting && (
              <DownloadList downloads={visible} filter={filter} actions={actions} />
            )}
          </div>
        </div>
      </main>
      <SettingsDialog
        ref={setSettingsLayer}
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onError={report}
        onSettings={keepSettings}
      />
      {/* Over Settings while it is open: a modal dialog leaves the rest of the page out of reach.
          A focus whose notices are all gone goes to the field, or to the top of the dialog. */}
      <Notices
        notices={notices}
        lasting={live.connection === Connection.Offline ? ENGINE_UNREACHABLE : null}
        onDismiss={dismiss}
        home={() => (settingsOpen ? (settingsLayer?.top() ?? null) : field.current)}
        layer={settingsOpen ? (settingsLayer?.element ?? null) : null}
      />
    </div>
  );
}
