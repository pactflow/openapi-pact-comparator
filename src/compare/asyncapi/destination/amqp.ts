// The destination is a RabbitMQ address (format v2), compared with the
// channel's AMQP binding:
// - `/queues/:queue` with `bindings.amqp.queue.name`
// - `/exchanges/:exchange` with `bindings.amqp.exchange.name`
// - `/exchanges/:exchange/:routing-key` also compares the routing key with the
//   channel address.
//
// Routing keys are `.`-separated words and `{parameter}` matches one word. On a
// topic exchange `*` matches exactly one word and `#` zero or more; on other
// exchange types they are ordinary characters.
import { matchesTokens, type TokenRules } from "./tokens";
import type { DestinationCheck, DestinationProtocol } from "./types";

const TOPIC: TokenRules = {
  separator: ".",
  one: "*",
  many: { token: "#", min: 0, lastOnly: false },
};
const LITERAL: TokenRules = { separator: "." };

type RabbitMqAddress =
  { queue: string } | { exchange: string; routingKey?: string };

const decode = (part: string): string | undefined => {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
};

// `/queues/:queue`, `/exchanges/:exchange` or
// `/exchanges/:exchange/:routing-key`, each part percent-encoded.
export const parseRabbitMqAddress = (
  value: string,
): RabbitMqAddress | undefined => {
  const [empty, kind, ...parts] = value.split("/");
  if (empty !== "" || parts.length === 0 || parts[0] === "") {
    return undefined;
  }
  const decoded = parts.map(decode);
  if (decoded.some((part) => part === undefined)) {
    return undefined;
  }
  const [name, routingKey] = decoded as string[];
  if (kind === "queues" && parts.length === 1) {
    return { queue: name };
  }
  if (kind === "exchanges" && parts.length === 1) {
    return { exchange: name };
  }
  if (kind === "exchanges" && parts.length === 2) {
    return { exchange: name, routingKey };
  }
  return undefined;
};

const compareName = (
  actual: string,
  expected: unknown,
  location: string,
  against: string,
): DestinationCheck | undefined => {
  if (typeof expected !== "string") {
    return {
      status: "unvalidatable",
      reason: `the channel has no ${location.slice(1)} to compare with`,
      spec: { location, value: expected },
    };
  }
  return actual === expected
    ? undefined
    : {
        status: "mismatch",
        against,
        expected,
        spec: { location, value: expected },
      };
};

export const amqp: DestinationProtocol = {
  protocols: ["amqp", "amqps"],
  check(destination, channel) {
    const target = parseRabbitMqAddress(destination);
    if (!target) {
      return {
        status: "unvalidatable",
        reason:
          "the destination is not a RabbitMQ address (/queues/:queue, /exchanges/:exchange or /exchanges/:exchange/:routing-key)",
        spec: { location: ".address", value: channel.address },
      };
    }
    const binding = channel.bindings?.amqp;
    // `is` defaults to `routingKey`; `exchange` applies to routing-key
    // channels and `queue` to queue channels.
    const is = binding?.is ?? "routingKey";
    const kind = "queue" in target ? "queue" : "routingKey";
    if (is !== kind) {
      return {
        status: "unvalidatable",
        reason: `the destination is ${kind === "queue" ? "a queue" : "an exchange"} but the channel's AMQP binding is \`is: ${is}\``,
        spec: { location: ".bindings.amqp.is", value: binding?.is },
      };
    }

    if ("queue" in target) {
      return (
        compareName(
          target.queue,
          binding?.queue?.name,
          ".bindings.amqp.queue.name",
          "the AMQP queue name",
        ) ?? { status: "match" }
      );
    }

    const exchange = compareName(
      target.exchange,
      binding?.exchange?.name,
      ".bindings.amqp.exchange.name",
      "the AMQP exchange name",
    );
    if (exchange) {
      return exchange;
    }
    if (target.routingKey === undefined) {
      return { status: "match" };
    }

    const { address } = channel;
    if (typeof address !== "string") {
      return {
        status: "unvalidatable",
        reason: "the channel has no address to compare the routing key with",
        spec: { location: ".address", value: address },
      };
    }
    const rules = binding?.exchange?.type === "topic" ? TOPIC : LITERAL;
    return matchesTokens(address, target.routingKey, rules)
      ? { status: "match" }
      : {
          status: "mismatch",
          against: "the channel address",
          expected: address,
          spec: { location: ".address", value: address },
        };
  },
};
