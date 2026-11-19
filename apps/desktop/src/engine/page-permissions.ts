// A session without these two handlers grants a page whatever it asks: camera, microphone,
// position, notifications. Scia's page asks one thing, to write text on the clipboard («Copia il
// codice» of the extension pairing); the rest is refused, whoever asks.
export const PAGE_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export interface PermissionAsk {
  readonly permission: string;
  // The address or the origin of the frame that asks; a check made for no document has none.
  readonly asker: string | undefined;
}

function originOf(address: string | undefined): string | undefined {
  if (address === undefined) return undefined;
  try {
    return new URL(address).origin;
  } catch {
    return undefined;
  }
}

export function grantsPermission(ask: PermissionAsk, appOrigin: string): boolean {
  return PAGE_PERMISSIONS.has(ask.permission) && originOf(ask.asker) === appOrigin;
}

// The two handlers of an Electron session. Chromium checks a permission and asks for it apart,
// so one handler without the other leaves the other road open.
export interface PermissionGate {
  setPermissionRequestHandler(
    handler: (
      contents: unknown,
      permission: string,
      respond: (granted: boolean) => void,
      details: { readonly requestingUrl: string },
    ) => void,
  ): void;
  setPermissionCheckHandler(
    handler: (contents: unknown, permission: string, requestingOrigin: string) => boolean,
  ): void;
}

// The origin is read at every ask: the engine may come back on another port.
export function guardPermissions(session: PermissionGate, appOrigin: () => string): void {
  session.setPermissionRequestHandler((_contents, permission, respond, details) => {
    respond(grantsPermission({ permission, asker: details.requestingUrl }, appOrigin()));
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    grantsPermission({ permission, asker: requestingOrigin }, appOrigin()),
  );
}
