// A local rule rather than a selector of `no-restricted-syntax`: the sleep of `timers/promises` is
// imported under any name (`setTimeout as sleep`), and a promise's sleep is told from a bounded wait
// by what its timer calls, which only the variables' references can follow.

const TIMERS = new Set(['timers/promises', 'node:timers/promises']);

// No delay, or a delay of 0, is a turn of the event loop, not a sleep: Node gives both 1 ms.
const isTurn = (delay) => delay === undefined || (delay.type === 'Literal' && delay.value === 0);

const isCallOf = (node, callee) => node.type === 'CallExpression' && node.callee === callee;

// `object.name`, when `node` is that object; undefined otherwise.
function memberOf(node, name) {
  const parent = node?.parent;
  return parent?.type === 'MemberExpression' &&
    parent.object === node &&
    parent.property.name === name
    ? parent
    : undefined;
}

// The sleep a reference to an import of `timers/promises` stands for: `setTimeout` itself,
// `scheduler.wait`, or either of them on a namespace or a default import. Any other name imported
// has neither member.
function sleepOf(identifier, imported) {
  if (imported === 'setTimeout') return identifier;
  if (imported === 'scheduler') return memberOf(identifier, 'wait');
  return memberOf(identifier, 'setTimeout') ?? memberOf(memberOf(identifier, 'scheduler'), 'wait');
}

const isTimerOf = (node, callback) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'Identifier' &&
  node.callee.name === 'setTimeout' &&
  node.arguments[0] === callback;

function functionAround(node) {
  let around = node.parent;
  while (around !== null && !around.type.includes('Function')) around = around.parent;
  return around;
}

// The timer a reference to a promise's `resolve` is handed to, or is called in the callback of.
function timerResolvedBy(identifier) {
  const { parent } = identifier;
  if (isTimerOf(parent, identifier)) return parent;
  if (!isCallOf(parent, identifier)) return undefined;
  const callback = functionAround(identifier);
  return isTimerOf(callback.parent, callback) ? callback.parent : undefined;
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
          // A namespace or a default import names nothing it imports.
          const imported = variable.defs[0].node.imported?.name;
          // Every use of the sleep, a call or an alias handed on (`.map(sleep)`), but a turn.
          for (const { identifier } of variable.references) {
            const sleep = sleepOf(identifier, imported);
            if (sleep === undefined) continue;
            const call = isCallOf(sleep.parent, sleep) ? sleep.parent : undefined;
            if (call === undefined || !isTurn(call.arguments[0])) report(call ?? sleep);
          }
        }
      },
      // A promise that a timer resolves: one that only bounds a wait — rejects, or ends what it
      // waits for — is a deadline, not a sleep.
      'NewExpression[callee.name="Promise"]'(promise) {
        const [executor] = promise.arguments;
        if (!executor?.type.endsWith('FunctionExpression')) return;
        const [first] = executor.params;
        const resolve = context.sourceCode
          .getDeclaredVariables(executor)
          .find(({ identifiers }) => identifiers[0] === first);
        const timers = resolve?.references.map(({ identifier }) => timerResolvedBy(identifier));
        if (timers?.some((timer) => timer !== undefined && !isTurn(timer.arguments[1]))) {
          report(promise);
        }
      },
      'CallExpression[callee.property.name="waitForTimeout"]'(call) {
        if (!isTurn(call.arguments[0])) report(call);
      },
    };
  },
};
