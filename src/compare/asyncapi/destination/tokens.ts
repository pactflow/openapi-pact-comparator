const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Each `{parameter}` matches one or more characters other than those in
// `excluded`; the rest of the segment is literal.
export const segmentPattern = (pattern: string, excluded: string): RegExp => {
  const source = pattern
    .split(/(\{[^{}]+\})/)
    .map((part, i) => (i % 2 === 1 ? `[^${excluded}]+` : escapeRegExp(part)))
    .join("");
  return new RegExp(`^${source}$`);
};

export interface TokenRules {
  separator: string;
  // Matches exactly one token, e.g. NATS and AMQP `*`.
  one?: string;
  // Matches at least `min` tokens, e.g. NATS `>` (last only) or AMQP `#`.
  many?: { token: string; min: 0 | 1; lastOnly: boolean };
}

// matches[p][v]: pattern tokens from p match value tokens from v. Filled from
// the end so each state is computed once.
const matchTokens = (
  pattern: string[],
  value: string[],
  rules: TokenRules,
): boolean => {
  const { many, one } = rules;
  const excluded = escapeRegExp(rules.separator);
  const matches = Array.from({ length: pattern.length + 1 }, () =>
    new Array<boolean>(value.length + 1).fill(false),
  );
  matches[pattern.length][value.length] = true;
  for (let p = pattern.length - 1; p >= 0; p--) {
    const head = pattern[p];
    const isLast = p === pattern.length - 1;
    if (many && head === many.token && (!many.lastOnly || isLast)) {
      // Matches zero or more tokens from v when `matches[p + 1][w]` holds for
      // some w >= v + min.
      let anyFrom = false;
      for (let v = value.length; v >= 0; v--) {
        if (v + many.min <= value.length) {
          anyFrom ||= matches[p + 1][v + many.min];
        }
        matches[p][v] = anyFrom;
      }
      continue;
    }
    const segment = head === one ? undefined : segmentPattern(head, excluded);
    for (let v = value.length - 1; v >= 0; v--) {
      matches[p][v] =
        matches[p + 1][v + 1] && (!segment || segment.test(value[v]));
    }
  }
  return matches[0][0];
};

export const matchesTokens = (
  address: string,
  destination: string,
  rules: TokenRules,
): boolean =>
  matchTokens(
    address.split(rules.separator),
    destination.split(rules.separator),
    rules,
  );
