// Why an album of a file host, or one of its files' pages, gave no file (docs/adr/0024). Each code
// is said of an album's row and of a file's alike; the person reads the text the renderer maps it
// to.
export const AlbumFailure = {
  // The host says the album or the file is not there: removed, or never was.
  Gone: 'ALBUM_GONE',
  // The host refuses to show it to Scia, which does not get around a host's checks.
  Refused: 'ALBUM_REFUSED',
  // A page or an answer of the host Scia cannot read: the host may have changed its pages.
  // Its key is not `Unreadable`: DownloadFailure gathers PageFailure's, which has one.
  Unrecognised: 'ALBUM_UNREADABLE',
  // The album lists no file.
  Empty: 'ALBUM_EMPTY',
  // The link the site gave for a file at this run stopped working — refused, gone, or a web page
  // where the file was. Not the link the person pasted: a retry asks the site for a new one.
  LinkFailed: 'ALBUM_LINK_FAILED',
} as const;
export type AlbumFailure = (typeof AlbumFailure)[keyof typeof AlbumFailure];
