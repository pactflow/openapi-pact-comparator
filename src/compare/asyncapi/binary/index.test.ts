// Integration tests for format, type identity and message selection, run
// through the Comparator with the worked examples' real plugin pacts.
import fs from "node:fs";
import path from "node:path";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { Comparator } from "#compare/index";
import type { AsyncAPIDocument } from "#documents/asyncapi";
import type { Pact } from "#documents/pact";
import type { Result } from "#results/index";

const EXAMPLES = path.resolve(__dirname, "../../../__tests__/worked-examples");
const read = (file: string) =>
  fs.readFileSync(path.join(EXAMPLES, file), "utf-8");

type Message = {
  name?: string;
  contentType?: string;
  payload: Record<string, unknown>;
};
type Doc = AsyncAPIDocument & {
  components: { messages: Record<string, Message> };
};
const doc = (format: string) => load(read(`${format}/asyncapi.v1.yaml`)) as Doc;
const orderCreated = (d: Doc) => d.components.messages.OrderCreated;
const pact = (format: string) =>
  JSON.parse(read(`${format}/NotificationsService-OrderService.json`)) as Pact;

const compare = async (p: Pact, d: AsyncAPIDocument) => {
  const results: Result[] = [];
  for await (const r of new Comparator({ asyncapi: d }).compare(p)) {
    results.push(r);
  }
  return results;
};
const causes = (results: Result[]) =>
  (results.find((r) => r.code === "message.no.match")?.causes ?? []).map(
    (c) => [c.code, c.message],
  );

describe("format", () => {
  it("fails an Avro consumer against a JSON Schema message", async () => {
    const d = doc("avro");
    orderCreated(d).contentType = "application/json";
    orderCreated(d).payload = { type: "object" };
    expect(causes(await compare(pact("avro"), d))).toEqual([
      [
        "message.payload.format.incompatible",
        "The consumer's message is Avro, but the provider's message is application/json",
      ],
    ]);
  });

  it("fails a Protobuf consumer against an Avro message", async () => {
    expect(causes(await compare(pact("protobuf"), doc("avro")))).toEqual([
      [
        "message.payload.format.incompatible",
        "The consumer's message is Protobuf, but the provider's message is Avro",
      ],
    ]);
  });
});

describe("protobuf type identity and selection", () => {
  const v1 = read("protobuf/orders.v1.proto");

  it("fails when the provider's message is a different type", async () => {
    const d = doc("protobuf");
    orderCreated(d).payload.schema = v1.replace(
      "message OrderCreated {",
      "message OrderUpdated {",
    );
    orderCreated(d).contentType =
      "application/vnd.google.protobuf; proto=orders.OrderUpdated";
    expect(causes(await compare(pact("protobuf"), d))).toEqual([
      [
        "message.payload.type.incompatible",
        "The consumer's message is orders.OrderCreated, but the provider's message is orders.OrderUpdated",
      ],
    ]);
  });

  it.each([
    [
      "a proto content type parameter",
      {
        contentType:
          "application/vnd.google.protobuf; proto=orders.OrderCreated",
      },
    ],
    [
      "an x-drift-proto-message extension",
      { extension: "orders.OrderCreated" },
    ],
  ])("selects the provider's message from %s", async (_, declared) => {
    const d = doc("protobuf");
    const message = orderCreated(d);
    d.components.messages = { Unrelated: message };
    message.name = "Unrelated";
    message.contentType =
      declared.contentType ?? "application/vnd.google.protobuf";
    if (declared.extension) {
      message.payload["x-drift-proto-message"] = declared.extension;
    }
    const channels = (
      d as unknown as {
        channels: Record<string, { messages: Record<string, unknown> }>;
      }
    ).channels;
    channels.orderCreated.messages = {
      Unrelated: { $ref: "#/components/messages/Unrelated" },
    };
    const operations = (
      d as unknown as { operations: Record<string, { messages: unknown[] }> }
    ).operations;
    operations.publishOrderCreated.messages = [
      { $ref: "#/channels/orderCreated/messages/Unrelated" },
    ];
    expect((await compare(pact("protobuf"), d)).map((r) => r.code)).toEqual([
      "message.matched",
    ]);
  });
});

describe("avro union payloads", () => {
  const v1 = JSON.parse(read("avro/order-created.v1.avsc"));
  const cancelled = {
    type: "record",
    name: "OrderCancelled",
    namespace: "orders",
    fields: [{ name: "order_id", type: "string" }],
  };

  it("compares the branch matching the consumer's record, and ignores the others", async () => {
    const d = doc("avro");
    orderCreated(d).payload.schema = JSON.stringify([v1, cancelled]);
    expect((await compare(pact("avro"), d)).map((r) => r.code)).toEqual([
      "message.matched",
    ]);
  });

  it("fails when no branch is the consumer's record", async () => {
    const d = doc("avro");
    orderCreated(d).payload.schema = JSON.stringify([
      { ...v1, name: "OrderPlaced" },
      cancelled,
    ]);
    expect(causes(await compare(pact("avro"), d))).toEqual([
      [
        "message.payload.type.incompatible",
        "The consumer's message is the record OrderCreated, but the provider's union carries OrderPlaced, OrderCancelled",
      ],
    ]);
  });
});
