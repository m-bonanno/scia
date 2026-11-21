// Imports nothing: the E2E suite reads these too, from outside the page.

// How long a notice stays when nobody holds it: the longest message, read once at an ordinary
// pace (the owner, #132).
export const NOTICE_MS = 6000;
// The most shown at once. `Notices` lets go the oldest beyond it, and hands its focus on.
export const NOTICES_AT_MOST = 3;
