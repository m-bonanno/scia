// A local rule rather than a selector of `no-restricted-syntax`: the sleep of `timers/promises` is
// imported under any name (`setTimeout as sleep`), which only the import's references can follow.

const TIMERS = new Set(['timers/promises', 'node:timers/promises']);

// A wait of no time is a turn of the event loop, not a sleep.
const isTurn = (delay) => delay?.type === 'Literal' && delay.value === 0;

const isCallOf = (node, callee) => node.type === 'CallExpression' && node.callee === callee;

const statementsOf = (executor) =>
  executor.body.type === 'BlockStatement'
    ? executor.body.body.map((statement) => statement.expression)
    : [executor.body];

function isTimerResolving(executor) {
  return statementsOf(executor).some(
    (call) =>
      call?.type === 'CallExpression' &&
      call.callee.type === 'Identifier' &&
      call.callee.name === 'setTimeout' &&
      !isTurn(call.arguments[1]),
  );
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'A spec waits for a state, not for a fixed time.' },
    schema: [],
    messages: {
      fixed:
        'A fixed sleep: wait for a state (`until`, `vi.waitFor`), or inject the delay. A wait that is the case itself says so where it stands: `// eslint-disable-next-line scia/no-fixed-sleep -- <why>` (docs/development/testing.md, "Writing a spec").',
    },
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'fixed' });

    return {
      ImportDeclaration(declaration) {
        if (!TIMERS.has(declaration.source.value)) return;
        for (const variable of context.sourceCode.getDeclaredVariables(declaration)) {
          const specifier = variable.defs[0].node;
          const whole = specifier.type !== 'ImportSpecifier';
          if (!whole && specifier.imported.name !== 'setTimeout') continue;
          for (const { identifier } of variable.references) {
            const { parent } = identifier;
            const call = whole
              ? parent.type === 'MemberExpression' &&
                parent.object === identifier &&
                parent.property.name === 'setTimeout' &&
                isCallOf(parent.parent, parent) &&
                parent.parent
              : isCallOf(parent, identifier) && parent;
            if (call && !isTurn(call.arguments[0])) report(call);
          }
        }
      },
      'NewExpression[callee.name="Promise"]'(promise) {
        const [executor] = promise.arguments;
        if (executor?.type.endsWith('FunctionExpression') && isTimerResolving(executor)) {
          report(promise);
        }
      },
      'CallExpression[callee.property.name="waitForTimeout"]'(call) {
        if (!isTurn(call.arguments[0])) report(call);
      },
    };
  },
};
