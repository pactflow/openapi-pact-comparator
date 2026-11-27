// NATS subjects are `.`-separated tokens. In an address, `*` matches exactly
// one token, a final `>` matches one or more, and `{parameter}` one token.
import { matchesTokens, type TokenRules } from "./tokens";
import type { DestinationProtocol } from "./types";

const RULES: TokenRules = {
  separator: ".",
  one: "*",
  many: { token: ">", min: 1, lastOnly: true },
};

export const nats: DestinationProtocol = {
  protocols: ["nats"],
  check(destination, channel) {
    const { address } = channel;
    if (typeof address !== "string") {
      return { status: "skip" };
    }
    return matchesTokens(address, destination, RULES)
      ? { status: "match" }
      : {
          status: "mismatch",
          against: "the channel address",
          expected: address,
          spec: { location: ".address", value: address },
        };
  },
};
