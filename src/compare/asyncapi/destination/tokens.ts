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

const matchTokens = (
  pattern: string[],
  value: string[],
  rules: TokenRules,
): boolean => {
  if (pattern.length === 0) {
    return value.length === 0;
  }
  const [head, ...rest] = pattern;
  const { many } = rules;
  if (many && head === many.token && (!many.lastOnly || rest.length === 0)) {
    for (let skip = many.min; skip <= value.length; skip++) {
      if (matchTokens(rest, value.slice(skip), rules)) {
        return true;
      }
    }
    return false;
  }
  if (value.length === 0) {
    return false;
  }
  return (
    (head === rules.one ||
      segmentPattern(head, escapeRegExp(rules.separator)).test(value[0])) &&
    matchTokens(rest, value.slice(1), rules)
  );
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
