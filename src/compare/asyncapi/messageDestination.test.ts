import { describe, expect, it } from "vitest";

import type { AsyncAPIDocument } from "#documents/asyncapi";

import {
  createDestinationRegistry,
  type DestinationRegistry,
} from "./destination/registry";
import type { DestinationProtocol } from "./destination/types";
import { compareMessageDestination } from "./messageDestination";

const doc = (protocol?: string): AsyncAPIDocument => ({
  asyncapi: "3.0.0",
  info: { title: "t", version: "1" },
  ...(protocol ? { servers: { main: { protocol } } } : {}),
  channels: { events: { address: "test.events" } },
  operations: {
    sendEvent: { action: "send", channel: { $ref: "#/channels/events" } },
  },
});

const run = (
  asyncapi: AsyncAPIDocument,
  metadata: Record<string, string> | undefined,
  registry?: DestinationRegistry,
) => [
  ...compareMessageDestination(
    asyncapi,
    "sendEvent",
    metadata,
    { description: "an event" },
    "[root].interactions[0].metadata",
    registry,
  ),
];

describe("compareMessageDestination", () => {
  it("is silent without a destination", () => {
    expect(run(doc("nats"), undefined)).toEqual([]);
    expect(run(doc("nats"), { contentType: "application/json" })).toEqual([]);
  });

  it("is silent when the destination matches", () => {
    expect(run(doc("nats"), { destination: "test.events" })).toEqual([]);
  });

  it("reports a destination that does not match the address", () => {
    expect(run(doc("nats"), { destination: "test.events.wrong" })).toEqual([
      {
        code: "message.destination.incompatible",
        message:
          'Message destination "test.events.wrong" does not match the channel address "test.events"',
        mockDetails: {
          interactionDescription: "an event",
          interactionState: "[none]",
          location: "[root].interactions[0].metadata.destination",
          value: "test.events.wrong",
        },
        specDetails: {
          location: "[root].channels.events.address",
          value: "test.events",
        },
        type: "error",
      },
    ]);
  });

  it("warns when the destination cannot be compared", () => {
    expect(run(doc("amqp"), { destination: "test.events" })).toMatchObject([
      { code: "message.destination.unvalidatable", type: "warning" },
    ]);
  });

  it("uses the protocols of the servers the channel lists", () => {
    const asyncapi = doc("amqp");
    asyncapi.servers!.broker = { protocol: "nats" };
    asyncapi.channels!.events.servers = [{ $ref: "#/servers/broker" }];
    expect(run(asyncapi, { destination: "test.events" })).toEqual([]);
  });

  it("asks an injected registry for the handler", () => {
    const seen: string[][] = [];
    const handler: DestinationProtocol = {
      protocols: ["custom"],
      check: (destination, channel) => {
        seen.push([destination, String(channel.address)]);
        return { status: "match" };
      },
    };
    const registry = createDestinationRegistry([handler], handler);
    expect(run(doc("custom"), { destination: "x" }, registry)).toEqual([]);
    expect(seen).toEqual([["x", "test.events"]]);
  });

  it("is silent when the operation's channel cannot be resolved", () => {
    const asyncapi = doc("nats");
    asyncapi.operations!.sendEvent.channel = { $ref: "#/channels/missing" };
    expect(run(asyncapi, { destination: "x" })).toEqual([]);
  });
});
