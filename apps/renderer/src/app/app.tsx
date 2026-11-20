import type { Settings } from '@scia/contracts';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AddBar } from '@/features/downloads/add-bar.tsx';
import { DownloadList } from '@/features/downloads/download-list.tsx';
import type { RowActions } from '@/features/downloads/download-row.tsx';
import { FilterTabs } from '@/features/downloads/filter-tabs.tsx';
import { countByFilter, Filter, matchesFilter } from '@/features/downloads/filters.ts';
import { extractLinks } from '@/features/downloads/links.ts';
import { SettingsDialog } from '@/features/settings/settings-dialog.tsx';
import { api } from '@/lib/api.ts';
import { bridge } from '@/lib/bridge.ts';
import { Connection, useLive } from '@/lib/live.ts';
import { ENGINE_UNREACHABLE, errorMessage, FILE_NOT_OPENED } from '@/lib/messages.ts';
import { TitleBar } from './title-bar.tsx';

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function App(): ReactNode {
  const live = useLive();
  const [filter, setFilter] = useState<Filter>(Filter.All);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speedLimit, setSpeedLimit] = useState<number | null>(null);

  const report = useCallback((error: unknown) => {
    setNotice(errorMessage(error));
  }, []);

  const keepSettings = useCallback((settings: Settings) => {
    setSpeedLimit(settings.speedLimitBytesPerSecond);
  }, []);

  // The limit the title bar names is the engine's: read when the engine is reached, and again
  // whenever it comes back. A read that fails all the same is not reported here: the limit
  // still holds, and Settings, which reports its own read, tells this page what it learns.
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

  const add = useCallback(
    async (urls: string[]): Promise<boolean> => {
      try {
        await api.addDownloads(urls);
        setNotice(null);
        setFilter((current) => (current === Filter.Completed ? Filter.All : current));
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
    [report],
  );

  // A link on the clipboard is a download one keystroke away: Ctrl+V anywhere but in a field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTextField(event.target)) return;
      const links = extractLinks(event.clipboardData?.getData('text/plain') ?? '');
      if (links.length > 0) void add(links);
    };
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('paste', onPaste);
    };
  }, [add]);

  const actions = useMemo((): RowActions => {
    const shell = bridge();
    return {
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
                setNotice(FILE_NOT_OPENED);
              });
            },
    };
  }, [report]);

  // Newest first: what was just added is what the eye looks for.
  const visible = useMemo(
    () => live.downloads.filter((download) => matchesFilter(filter, download.status)).reverse(),
    [live.downloads, filter],
  );
  const bytesPerSecond = live.downloads.reduce((sum, download) => sum + download.bytesPerSecond, 0);
  const shownNotice = live.connection === Connection.Offline ? ENGINE_UNREACHABLE : notice;

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
          <AddBar onAdd={add} />
          {shownNotice !== null && (
            <p role="alert" className="px-1 text-sm text-destructive">
              {shownNotice}
            </p>
          )}
          <FilterTabs filter={filter} counts={countByFilter(live.downloads)} onChange={setFilter} />
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
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onError={report}
        onSettings={keepSettings}
      />
    </div>
  );
}
