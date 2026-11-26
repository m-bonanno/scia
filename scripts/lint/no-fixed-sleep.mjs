// A local rule rather than a selector of `no-restricted-syntax`: the sleep of `timers/promises` is
// imported under any name (`setTimeout as sleep`), which only the import's references can follow.

const TIMERS = new Set(['timers/promises', 'node:timers/promises']);

// A wait of no time is a turn of the event loop, not a sleep.
const isTurn = (delay) => delay?.type === 'Literal' && delay.value === 0;

const isCallOf = (node, callee) => node.type === 'CallExpression' && node.callee === callee;

// `timers.setTimeout` of a namespace or a default import; undefined for any other member.
function setTimeoutOf(namespace) {
  const { parent } = namespace;
  return parent.type === 'MemberExpression' &&
    parent.object === namespace &&
    parent.property.name === 'setTimeout'
    ? parent
    : undefined;
}

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
          // Every use of the sleep, a call or an alias handed on (`.map(sleep)`), but a turn.
          for (const { identifier } of variable.references) {
            const sleep = whole ? setTimeoutOf(identifier) : identifier;
            if (sleep === undefined) continue;
            const call = isCallOf(sleep.parent, sleep) ? sleep.parent : undefined;
            if (!isTurn(call?.arguments[0])) report(call ?? sleep);
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
