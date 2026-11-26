import { describe, expect, it } from 'vitest';
import { MAIN_BLOCK, reasonToLeaveOut } from './stryker-main-blocks.mjs';

// The nodes as Babel, Stryker's parser, gives them.
const identifier = (name) => ({ type: 'Identifier', name });
const member = (object, property) => ({
  type: 'MemberExpression',
  object,
  property: identifier(property),
});
const importMetaUrl = member(
  { type: 'MetaProperty', meta: identifier('import'), property: identifier('meta') },
  'url',
);
const argvOne = {
  type: 'MemberExpression',
  object: member(identifier('process'), 'argv'),
  property: { type: 'NumericLiteral', value: 1 },
  computed: true,
};
const call = (callee, ...args) => ({
  type: 'CallExpression',
  callee: identifier(callee),
  arguments: args,
});
const compare = (left, right) => ({ type: 'BinaryExpression', operator: '===', left, right });
const ifOf = (test) => ({
  node: { type: 'IfStatement', test, consequent: { type: 'BlockStatement', body: [] } },
});

describe('reasonToLeaveOut', () => {
  it('leaves out the main block of a script, in either way the repository writes it', () => {
    // scripts/*.mjs: import.meta.url === pathToFileURL(process.argv[1] ?? '').href
    const scripts = compare(
      importMetaUrl,
      member(call('pathToFileURL', { type: 'LogicalExpression', left: argvOne }), 'href'),
    );
    // apps/desktop/scripts/fetch-tools.ts: process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
    const fetchTools = {
      type: 'LogicalExpression',
      operator: '&&',
      left: {
        type: 'BinaryExpression',
        operator: '!==',
        left: argvOne,
        right: identifier('undefined'),
      },
      right: compare(call('fileURLToPath', importMetaUrl), call('resolve', argvOne)),
    };

    expect(reasonToLeaveOut(ifOf(scripts))).toBe(MAIN_BLOCK);
    expect(reasonToLeaveOut(ifOf(fetchTools))).toBe(MAIN_BLOCK);
  });

  it("mutates any other condition, also one that reads only the module's address or only the command's", () => {
    expect(reasonToLeaveOut(ifOf(compare(importMetaUrl, identifier('other'))))).toBeUndefined();
    expect(reasonToLeaveOut(ifOf(compare(argvOne, identifier('other'))))).toBeUndefined();
    expect(reasonToLeaveOut(ifOf(compare(identifier('a'), identifier('b'))))).toBeUndefined();
  });

  it('mutates what is not an if, also a comparison of the two outside one', () => {
    expect(reasonToLeaveOut({ node: compare(importMetaUrl, argvOne) })).toBeUndefined();
  });
});
