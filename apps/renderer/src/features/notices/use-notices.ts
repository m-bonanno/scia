import { useCallback, useRef, useState } from 'react';

// How long a notice stays when nobody holds it: the longest message, read once at an ordinary
// pace (the owner, #132).
export const NOTICE_MS = 6000;
export const NOTICES_AT_MOST = 3;

export interface Notice {
  readonly id: number;
  readonly text: string;
  // Told again: the same notice, whose time starts again.
  readonly round: number;
}

export interface NoticesState {
  readonly notices: readonly Notice[];
  readonly tell: (text: string) => void;
  readonly dismiss: (id: number) => void;
}

export function useNotices(): NoticesState {
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const last = useRef(0);
  const tell = useCallback((text: string) => {
    last.current += 1;
    const id = last.current;
    setNotices((current) =>
      current.some((notice) => notice.text === text)
        ? current.map((notice) =>
            notice.text === text ? { ...notice, round: notice.round + 1 } : notice,
          )
        : [...current, { id, text, round: 0 }].slice(-NOTICES_AT_MOST),
    );
  }, []);
  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);
  return { notices, tell, dismiss };
}
