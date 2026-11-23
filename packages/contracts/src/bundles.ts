import { BundleFailure, BundleStatus } from '@scia/core';
import { z } from 'zod';

const byteCount = z.number().int().nonnegative();

// A link that opens into several files (#181; docs/adr/0025) — a file host's folder, a protector's
// or a shortener's link — from the moment it is added to the moment the person starts the files
// they chose: then it leaves the list, and those files are downloads, each known by the service's
// link to it. Neither the link nor the service's links are in it: the page names a file by its
// place in `files`.
export const bundleSchema = z.object({
  id: z.string(),
  // The folder its files go into, named after the link.
  name: z.string(),
  status: z.enum(BundleStatus),
  failure: z.enum(BundleFailure).nullable(),
  // In the service's order, each under the name it will have; empty until it has said.
  files: z.array(z.object({ name: z.string(), size: byteCount })),
  // The files behind the link the service could say nothing of: not listed.
  unavailable: z.number().int().nonnegative(),
  // The files past the most Scia lists to tick through (the owner, #181): not listed.
  leftOut: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type Bundle = z.infer<typeof bundleSchema>;

// The files the person chose, by their place in the list. Which places a choice may name — one at
// least, each once, each listed — the engine says, which knows the list.
export const startBundleSchema = z.object({ files: z.array(z.number()) });
export type StartBundle = z.infer<typeof startBundleSchema>;
