import { constants, createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';

// As much of OpenPGP (RFC 4880) as checking a release of yt-dlp takes (docs/adr/0011): an RSA key
// in its armour, and a detached version 4 signature of a binary document, which is what gpg
// --detach-sign writes. Anything else is not read, and a signature that is not read is no
// signature.

export interface SigningKey {
  // The key's version 4 fingerprint, in capitals: what a project publishes beside its key.
  readonly fingerprint: string;
  readonly key: KeyObject;
  readonly bytes: number;
}

class Bytes {
  readonly #data: Buffer;
  #at = 0;

  constructor(data: Buffer) {
    this.#data = data;
  }

  get left(): number {
    return this.#data.length - this.#at;
  }

  take(count: number): Buffer {
    if (count < 0 || count > this.left) throw new Error('OpenPGP data cut short.');
    const taken = this.#data.subarray(this.#at, this.#at + count);
    this.#at += count;
    return taken;
  }

  byte(): number {
    return this.take(1).readUInt8();
  }

  u16(): number {
    return this.take(2).readUInt16BE();
  }

  u32(): number {
    return this.take(4).readUInt32BE();
  }

  mpi(): Buffer {
    return this.take(Math.ceil(this.u16() / 8));
  }
}

interface Packet {
  readonly tag: number;
  readonly body: Buffer;
}

function packetsOf(data: Buffer): Packet[] {
  const bytes = new Bytes(data);
  const packets: Packet[] = [];
  while (bytes.left > 0) {
    const head = bytes.byte();
    if ((head & 0x80) === 0) throw new Error('Not an OpenPGP packet.');
    let tag: number;
    let length: number;
    if ((head & 0x40) !== 0) {
      tag = head & 0x3f;
      const first = bytes.byte();
      if (first < 192) length = first;
      else if (first < 224) length = ((first - 192) << 8) + bytes.byte() + 192;
      else if (first === 255) length = bytes.u32();
      // A body in partial lengths: never what a key or a signature is written as.
      else throw new Error('An OpenPGP packet in parts.');
    } else {
      tag = (head >> 2) & 0x0f;
      const kind = head & 0x03;
      if (kind === 0) length = bytes.byte();
      else if (kind === 1) length = bytes.u16();
      else if (kind === 2) length = bytes.u32();
      else throw new Error('An OpenPGP packet of no stated length.');
    }
    packets.push({ tag, body: bytes.take(length) });
  }
  return packets;
}

const PUBLIC_KEY = 6;
// RSA, for encrypting and signing or for signing alone.
const RSA = new Set([1, 3]);

function dearmored(armored: string): Buffer {
  const lines = armored.replaceAll('\r', '').split('\n');
  const begin = lines.indexOf('-----BEGIN PGP PUBLIC KEY BLOCK-----');
  const end = lines.indexOf('-----END PGP PUBLIC KEY BLOCK-----');
  if (begin === -1 || end < begin) throw new Error('No armoured OpenPGP key.');
  const inside = lines.slice(begin + 1, end);
  // Headers until the first empty line, then the key. Its checksum line is not read — the key is
  // known by its fingerprint — and needs no removing: it begins with "=", where Node's decoder of
  // base64 stops.
  return Buffer.from(inside.slice(inside.indexOf('') + 1).join(''), 'base64');
}

// The first key of an armoured block, which must be an RSA key of version 4.
export function signingKeyOf(armored: string): SigningKey {
  const packet = packetsOf(dearmored(armored)).find(({ tag }) => tag === PUBLIC_KEY);
  if (packet === undefined) throw new Error('No OpenPGP key in the block.');
  const bytes = new Bytes(packet.body);
  if (bytes.byte() !== 4) throw new Error('Not a version 4 OpenPGP key.');
  bytes.u32();
  if (!RSA.has(bytes.byte())) throw new Error('Not an RSA key.');
  const n = bytes.mpi();
  const e = bytes.mpi();
  const length = Buffer.alloc(2);
  length.writeUInt16BE(packet.body.length);
  return {
    fingerprint: createHash('sha1')
      .update(Buffer.concat([Buffer.from([0x99]), length, packet.body]))
      .digest('hex')
      .toUpperCase(),
    key: createPublicKey({
      key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') },
      format: 'jwk',
    }),
    bytes: n.length,
  };
}

// The hashes a signature may be made with. SHA-1 and MD5 no longer prove who signed.
const HASH_OF = new Map([
  [8, 'sha256'],
  [9, 'sha384'],
  [10, 'sha512'],
]);
// A signature of a binary document: what `gpg --detach-sign` makes of a file.
const OF_A_DOCUMENT = 0;
const CREATED = 2;

interface Subpacket {
  readonly type: number;
  readonly critical: boolean;
  readonly data: Buffer;
}

function subpacketsOf(area: Buffer): Subpacket[] {
  const bytes = new Bytes(area);
  const subpackets: Subpacket[] = [];
  while (bytes.left > 0) {
    const first = bytes.byte();
    const length =
      first < 192 ? first : first < 255 ? ((first - 192) << 8) + bytes.byte() + 192 : bytes.u32();
    const type = bytes.byte();
    subpackets.push({
      type: type & 0x7f,
      critical: (type & 0x80) !== 0,
      data: bytes.take(length - 1),
    });
  }
  return subpackets;
}

// The date of one signature packet, when it is a good signature of `data` by `key`.
function dateOf(data: Buffer, body: Buffer, key: SigningKey): Date | undefined {
  const bytes = new Bytes(body);
  if (bytes.byte() !== 4 || bytes.byte() !== OF_A_DOCUMENT || !RSA.has(bytes.byte())) {
    return undefined;
  }
  const hash = HASH_OF.get(bytes.byte());
  const hashed = bytes.take(bytes.u16());
  // What is not signed — the issuer's id, in a signature of gpg's — and the hash's first bytes.
  bytes.take(bytes.u16());
  bytes.take(2);
  const value = bytes.mpi();
  if (hash === undefined) return undefined;

  let created: Date | undefined;
  for (const subpacket of subpacketsOf(hashed)) {
    if (subpacket.type === CREATED) {
      created = new Date(subpacket.data.readUInt32BE() * 1000);
    } else if (subpacket.critical) {
      // A condition the signer said must be understood, which Scia does not read.
      return undefined;
    }
  }
  if (created === undefined) return undefined;

  // What was signed: the document, the signature's own hashed part, and its trailer.
  const portion = body.subarray(0, 6 + hashed.length);
  const trailer = Buffer.alloc(6);
  trailer.writeUInt8(4, 0);
  trailer.writeUInt8(0xff, 1);
  trailer.writeUInt32BE(portion.length, 2);
  const signed = Buffer.concat([data, portion, trailer]);
  const padded = Buffer.concat([Buffer.alloc(key.bytes - value.length), value]);
  const good = verify(hash, signed, { key: key.key, padding: constants.RSA_PKCS1_PADDING }, padded);
  return good ? created : undefined;
}

// When `signature` says it was made, when it is — or holds — a good signature of `data` by `key`;
// nothing otherwise, whatever is wrong with it. A file of signatures may carry several signers'.
export function signedAt(data: Buffer, signature: Buffer, key: SigningKey): Date | undefined {
  let packets: Packet[];
  try {
    packets = packetsOf(signature);
  } catch {
    return undefined;
  }
  // Every packet is read as a signature: one that is not fails to read as one.
  for (const { body } of packets) {
    try {
      const date = dateOf(data, body, key);
      if (date !== undefined) return date;
    } catch {
      // A signature that cannot be read is no signature; another in the file may be.
    }
  }
  return undefined;
}
