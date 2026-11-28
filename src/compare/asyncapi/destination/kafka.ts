// Kafka topic names may only contain ASCII alphanumerics, `.`, `_` and `-`, so
// there are no wildcards; `{parameter}` matches one `.`-separated segment. The
// Kafka channel binding's `topic` takes precedence over the address.
import { matchesTokens, type TokenRules } from "./tokens";
import type { DestinationProtocol } from "./types";

const RULES: TokenRules = { separator: "." };

export const kafka: DestinationProtocol = {
  protocols: ["kafka", "kafka-secure"],
  check(destination, channel) {
    const topic = channel.bindings?.kafka?.topic;
    const [expected, location, against] =
      typeof topic === "string"
        ? [topic, ".bindings.kafka.topic", "the Kafka topic"]
        : [channel.address, ".address", "the channel address"];
    if (typeof expected !== "string") {
      return { status: "skip" };
    }
    return matchesTokens(expected, destination, RULES)
      ? { status: "match" }
      : {
          status: "mismatch",
          against,
          expected,
          spec: { location, value: expected },
        };
  },
};
