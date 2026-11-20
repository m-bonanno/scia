import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto';

// Signs as a release of yt-dlp is signed — a detached OpenPGP signature (RFC 4880, version 4) of a
// binary document, made with an RSA key — with a key made for the spec. What it writes is checked
// against what gpg writes by the spec that reads a real release of yt-dlp.

const mpi = (value: Buffer) => {
  let at = 0;
  while (at < value.length - 1 && value[at] === 0) at += 1;
  const bytes = value.subarray(at);
  const bits = bytes.length * 8 - Math.clz32(bytes[0] ?? 0) + 24;
  const head = Buffer.alloc(2);
  head.writeUInt16BE(bits);
  return Buffer.concat([head, bytes]);
};

// A packet in the new format, its length in five bytes: any length, one way.
const packet = (tag: number, body: Buffer) => {
  const head = Buffer.alloc(6);
  head[0] = 0xc0 | tag;
  head[1] = 0xff;
  head.writeUInt32BE(body.length, 2);
  return Buffer.concat([head, body]);
};

const subpacket = (type: number, data: Buffer) =>
  Buffer.concat([Buffer.from([data.length + 1, type]), data]);

const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

const HASHES: Readonly<Record<string, number>> = { sha1: 2, sha256: 8, sha384: 9, sha512: 10 };

export interface TestKey {
  readonly armored: string;
  readonly fingerprint: string;
  readonly privateKey: KeyObject;
}

export function testKey(): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const body = Buffer.concat([
    Buffer.from([4]),
    u32(1_700_000_000),
    Buffer.from([1]),
    mpi(Buffer.from(jwk.n ?? '', 'base64url')),
    mpi(Buffer.from(jwk.e ?? '', 'base64url')),
  ]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length);
  const fingerprint = createHash('sha1')
    .update(Buffer.concat([Buffer.from([0x99]), length, body]))
    .digest('hex')
    .toUpperCase();
  const base64 = packet(6, body).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  const armored = [
    '-----BEGIN PGP PUBLIC KEY BLOCK-----',
    '',
    ...lines,
    '-----END PGP PUBLIC KEY BLOCK-----',
    '',
  ].join('\n');
  return { armored, fingerprint, privateKey };
}

export interface SignOptions {
  readonly createdAt?: Date;
  readonly hash?: keyof typeof HASHES;
  // What the signature says it is of: 0 a binary document, as gpg --detach-sign writes.
  readonly type?: number;
  // Hashed subpackets added after the date, as [type, data].
  readonly extra?: readonly (readonly [number, Buffer])[];
  readonly withoutDate?: boolean;
}

export function signDetached(data: Buffer, key: KeyObject, options: SignOptions = {}): Buffer {
  const hash = options.hash ?? 'sha512';
  const created = Math.floor((options.createdAt ?? new Date()).getTime() / 1000);
  const hashed = Buffer.concat([
    ...(options.withoutDate === true ? [] : [subpacket(2, u32(created))]),
    ...(options.extra ?? []).map(([type, value]) => subpacket(type, value)),
  ]);
  const hashedLength = Buffer.alloc(2);
  hashedLength.writeUInt16BE(hashed.length);
  const portion = Buffer.concat([
    Buffer.from([4, options.type ?? 0, 1, HASHES[hash] ?? 0]),
    hashedLength,
    hashed,
  ]);
  const trailer = Buffer.concat([Buffer.from([4, 0xff]), u32(portion.length)]);
  const signed = Buffer.concat([data, portion, trailer]);
  const digest = createHash(hash).update(signed).digest();
  const signature = sign(hash, signed, key);
  const body = Buffer.concat([portion, Buffer.from([0, 0]), digest.subarray(0, 2), mpi(signature)]);
  return packet(2, body);
}
