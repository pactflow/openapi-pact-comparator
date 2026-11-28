import { describe, expect, it } from "vitest";

import { amqp } from "./amqp";
import { generic } from "./generic";
import { kafka } from "./kafka";
import { nats } from "./nats";
import {
  createDestinationRegistry,
  defaultDestinationRegistry,
} from "./registry";
import type { DestinationProtocol } from "./types";

describe("defaultDestinationRegistry", () => {
  it.each([
    [["nats"], nats],
    [["NATS"], nats],
    [["kafka"], kafka],
    [["kafka-secure"], kafka],
    [["kafka", "kafka-secure"], kafka],
    [["amqp"], amqp],
    [["amqps"], amqp],
    [["mqtt"], generic],
    [[], generic],
    [["nats", "kafka"], generic],
  ])("%j", (protocols, expected) => {
    expect(defaultDestinationRegistry.forProtocols(protocols)).toBe(expected);
  });
});

describe("createDestinationRegistry", () => {
  const custom: DestinationProtocol = {
    protocols: ["MQTT"],
    check: () => ({ status: "match" }),
  };

  it("uses an injected handler for its protocols", () => {
    const registry = createDestinationRegistry([custom], generic);
    expect(registry.forProtocols(["mqtt"])).toBe(custom);
    expect(registry.forProtocols(["nats"])).toBe(generic);
  });

  it("rejects two handlers for the same protocol", () => {
    expect(() =>
      createDestinationRegistry([nats, { ...nats }], generic),
    ).toThrow('Duplicate destination handler for protocol "nats"');
  });
});
