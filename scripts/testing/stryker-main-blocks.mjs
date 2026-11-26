import { declareValuePlugin, PluginKind } from '@stryker-mutator/api/plugin';

// A script's main block — `if (import.meta.url === pathToFileURL(process.argv[1] …))` — runs its
// tools: git, gh, a download from GitHub, Stryker itself. A mutant of its condition runs them from
// the spec that imports the file, a program that is not Node among them, and a run of `mutate.mjs`
// started a mutation run inside the mutation run (#386). It is not mutated: Stryker leaves out the
// `if` that compares the module's own address with the command's.

export const MAIN_BLOCK =
  "a script's main block runs its tools: a mutant of it would run them from its spec";

function* nodesOf(node) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* nodesOf(item);
    return;
  }
  if (typeof node.type === 'string') yield node;
  for (const value of Object.values(node)) yield* nodesOf(value);
}

const isMember = (node, object, property) =>
  node.type === 'MemberExpression' && object(node.object) && node.property.name === property;

const isImportMetaUrl = (node) => isMember(node, (object) => object.type === 'MetaProperty', 'url');

const isProcessArgv = (node) =>
  isMember(node, (object) => object.type === 'Identifier' && object.name === 'process', 'argv');

export function reasonToLeaveOut(path) {
  if (path.node.type !== 'IfStatement') return undefined;
  const read = [...nodesOf(path.node.test)];
  return read.some(isImportMetaUrl) && read.some(isProcessArgv) ? MAIN_BLOCK : undefined;
}

export const strykerPlugins = [
  declareValuePlugin(PluginKind.Ignore, 'main-blocks', { shouldIgnore: reasonToLeaveOut }),
];
