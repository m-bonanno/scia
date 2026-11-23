import { sanitizeFileName } from '@scia/core';

// What a link that opens into several files is (#181; docs/adr/0025): a file host's folder, which
// needs a service as any of the host's links does (docs/adr/0006); or a protector's or a
// shortener's link, which the service opens and which, with no service connected, is fetched as
// it stands, as it always was.
export const BundleKind = { Folder: 'folder', Opener: 'opener' } as const;
export type BundleKind = (typeof BundleKind)[keyof typeof BundleKind];

interface BundleSite {
  // In lower case; its `www.` is the same site, any other subdomain is not.
  readonly domain: string;
  // The beginnings of the paths of a host's folders, in lower case. None: every link of the
  // domain opens into its links.
  readonly folders?: readonly string[];
}

// The sites whose links AllDebrid's redirector opens into several (`redirectors` of
// GET /v4/hosts/domains, read on 23 November 2026), as far as Scia takes them: a file host by the
// shape of its folders' paths, as the hosts write them; a protector or a shortener whole. That they
// are a list kept as data, never asked of the service first, is the owner's decision on #181.
// What is not taken is the team's choice, which the owner let stand as such (#181): what lists the same file on several
// hosts (multiup.org), a site's pages of links, and what is no site of its own (google.com,
// example.com).
export const BUNDLE_SITES: readonly BundleSite[] = [
  { domain: '1fichier.com', folders: ['/dir/'] },
  { domain: 'mega.nz', folders: ['/folder/'] },
  { domain: 'mega.co.nz', folders: ['/folder/'] },
  { domain: 'mediafire.com', folders: ['/folder/'] },
  { domain: 'rapidgator.net', folders: ['/folder/'] },
  { domain: 'rg.to', folders: ['/folder/'] },
  { domain: 'turbobit.net', folders: ['/download/folder/'] },
  { domain: 'uploaded.net', folders: ['/f/'] },
  { domain: 'filecrypt.cc' },
  { domain: 'dl-protect.top' },
  { domain: 'dl-protect.best' },
  { domain: 'dl-protect1.com' },
  { domain: 'dl-protect1.co' },
  { domain: 'dl-protecte.org' },
  { domain: 'protect-lien.com' },
  { domain: 'protect-zt.com' },
  { domain: 'zt-protect.com' },
  { domain: 'protecte-link.com' },
  { domain: 'ed-protect.org' },
  { domain: 'extreme-protect.net' },
  { domain: 'protect.ddl-island.su' },
  { domain: 'liencaptcha.com' },
  { domain: 'safelinking.net' },
  { domain: 'adf.ly' },
  { domain: 'bit.ly' },
  { domain: 'tinyurl.com' },
];

// What the link is, when it opens into several files; undefined for any other link. By its host
// name and the beginning of its path — never by a name somewhere else in the address.
export function bundleKindOf(url: string): BundleKind | undefined {
  const parsed = URL.parse(url);
  if (parsed === null || !/^https?:$/.test(parsed.protocol)) return undefined;
  const host = parsed.hostname.replace(/^www\./, '');
  const site = BUNDLE_SITES.find((each) => each.domain === host);
  if (site === undefined) return undefined;
  if (site.folders === undefined) return BundleKind.Opener;
  const path = parsed.pathname.toLowerCase();
  return site.folders.some((folder) => path.startsWith(folder)) ? BundleKind.Folder : undefined;
}

// The folder its chosen files go into: the last part of its path, as the link writes it, without
// the extension of a page — the service names neither the folder nor the link — else its host.
// A name from a link: made safe for the disk, as any name from a host.
export function bundleName(url: string): string {
  const parsed = URL.parse(url);
  if (parsed === null) return sanitizeFileName(url);
  const last = parsed.pathname.split('/').findLast((part) => part !== '') ?? '';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // Not encoded as the web encodes: kept as written.
  }
  name = name.replace(/\.html?$/i, '');
  return sanitizeFileName(name === '' ? parsed.hostname.replace(/^www\./, '') : name);
}
