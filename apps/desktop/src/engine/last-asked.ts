// An ask whose answer counts only while no later ask was made: an older answer, or an older
// refusal, comes back as undefined (.claude/gotchas.md: two asks answer in the order they like).
export function lastAsked<T>(ask: () => Promise<T>): () => Promise<T | undefined> {
  let turn = 0;
  return async () => {
    turn += 1;
    const mine = turn;
    try {
      const answer = await ask();
      return mine === turn ? answer : undefined;
    } catch (error) {
      if (mine === turn) throw error;
      return undefined;
    }
  };
}
