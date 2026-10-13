// Acceptance tests: the worked examples in src/__tests__/worked-examples, using
// real pacts written by pact-protobuf-plugin and pact-avro-plugin. Each change
// is applied to v1 in isolation.
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

const consumers = ["NotificationsService", "AnalyticsService"] as const;
type Consumer = (typeof consumers)[number];

const withSchema = (format: string, schema: string): AsyncAPIDocument => {
  const doc = load(read(`${format}/asyncapi.v1.yaml`)) as AsyncAPIDocument & {
    components: { messages: { OrderCreated: { payload: { schema: string } } } };
  };
  doc.components.messages.OrderCreated.payload.schema = schema;
  return doc;
};

const compare = async (
  format: string,
  consumer: Consumer,
  doc: AsyncAPIDocument,
) => {
  const pact = JSON.parse(
    read(`${format}/${consumer}-OrderService.json`),
  ) as Pact;
  const results: Result[] = [];
  for await (const r of new Comparator({ asyncapi: doc }).compare(pact)) {
    results.push(r);
  }
  return results;
};

const outcome = (results: Result[]) =>
  results.find(
    (r) => r.code === "message.matched" || r.code === "message.no.match",
  )?.code;
const causes = (results: Result[]) =>
  results.find((r) => r.code === "message.no.match")?.causes ?? [];

const NO_MATCH = "message.no.match";
const MATCHED = "message.matched";

describe("protobuf worked example", () => {
  const v1 = read("protobuf/orders.v1.proto");
  const CHANGES: Record<string, (p: string) => string> = {
    B1: (p) => p.replace("string order_id = 1;", "int64 order_id = 1;"),
    B2: (p) => p.replace("string customer_id = 2;", "string customer_id = 12;"),
    B3: (p) => p.replace("int32 quantity = 2;", "sint32 quantity = 2;"),
    B4: (p) => p.replace("string currency = 4;", "string promo_code = 4;"),
    B5: (p) =>
      p.replace(
        "PAID = 2;\n  SHIPPED = 3;",
        "PAYMENT_PENDING = 2;\n  PAID = 3;\n  SHIPPED = 4;",
      ),
    B6: (p) => p.replace("int64 total_cents = 3;", "int64 amount_minor = 3;"),
    B7: (p) =>
      p.replace(
        "Address shipping_address = 8;",
        'reserved 8;\n  reserved "shipping_address";',
      ),
    B8: (p) =>
      p.replace(
        "google.protobuf.Timestamp created_at = 7;",
        "string created_at = 7;",
      ),
    N1: (p) =>
      p.replace(
        "Address shipping_address = 8;",
        "Address shipping_address = 8;\n  string sales_channel = 20;",
      ),
  };

  it.each(consumers)(
    "%s matches v1, whose .proto imports a well-known type",
    async (consumer) => {
      expect(
        (await compare("protobuf", consumer, withSchema("protobuf", v1))).map(
          (r) => r.code,
        ),
      ).toEqual([MATCHED]);
    },
  );

  it.each([
    ["B1", NO_MATCH, MATCHED],
    ["B2", NO_MATCH, MATCHED],
    ["B3", NO_MATCH, NO_MATCH],
    ["B4", NO_MATCH, MATCHED],
    ["B5", NO_MATCH, NO_MATCH],
    ["B6", NO_MATCH, MATCHED],
    ["B7", NO_MATCH, MATCHED],
    ["B8", NO_MATCH, MATCHED],
    ["N1", MATCHED, MATCHED],
  ])(
    "%s: Notifications %s, Analytics %s",
    async (change, notifications, analytics) => {
      const doc = withSchema("protobuf", CHANGES[change](v1));
      expect(
        outcome(await compare("protobuf", "NotificationsService", doc)),
      ).toBe(notifications);
      expect(outcome(await compare("protobuf", "AnalyticsService", doc))).toBe(
        analytics,
      );
    },
  );

  it("explains every v2 change to NotificationsService once, in field terms", async () => {
    const found = causes(
      await compare(
        "protobuf",
        "NotificationsService",
        withSchema("protobuf", read("protobuf/orders.v2.proto")),
      ),
    );
    expect(found.map((c) => c.message)).toEqual([
      "The consumer's field order_id (1) is string, but the provider's is int64 (FIELD_WIRE_COMPATIBLE_TYPE)",
      "The consumer reads field customer_id as number 2, but the provider's customer_id is number 12 (FIELD_NO_DELETE)",
      "The consumer reads field 3 as total_cents, but the provider's field 3 is amount_minor (FIELD_SAME_NAME)",
      "The consumer reads field 4 as currency, but the provider's field 4 is promo_code (FIELD_SAME_NAME)",
      "The consumer reads orders.OrderStatus value 2 as PAID, but to the provider value 2 is PAYMENT_PENDING (PAID is now 3) (ENUM_VALUE_SAME_NAME)",
      "The consumer's field quantity (2) is int32, but the provider's is sint32 (FIELD_WIRE_COMPATIBLE_TYPE)",
      "The consumer's field created_at (7) is google.protobuf.Timestamp, but the provider's is string (FIELD_WIRE_COMPATIBLE_TYPE)",
      "The consumer reads field shipping_address (8) of orders.OrderCreated, but the provider's orders.OrderCreated has no field 8 (it is reserved) (FIELD_NO_DELETE)",
    ]);
  });

  it("reports only the v2 changes AnalyticsService depends on", async () => {
    const found = causes(
      await compare(
        "protobuf",
        "AnalyticsService",
        withSchema("protobuf", read("protobuf/orders.v2.proto")),
      ),
    );
    expect(
      found.map((c) => [
        c.mockDetails?.location,
        c.specDetails?.location,
        c.specDetails?.value,
      ]),
    ).toEqual([
      [
        "[root].interactions[0].contents.content.status",
        "[root].components.messages.OrderCreated.payload.schema.orders.OrderCreated.status",
        "orders.OrderStatus status = 5",
      ],
      [
        "[root].interactions[0].contents.content.items[].quantity",
        "[root].components.messages.OrderCreated.payload.schema.orders.LineItem.quantity",
        "sint32 quantity = 2",
      ],
    ]);
  });
});

describe("avro worked example", () => {
  type Field = { name: string; type: unknown; [key: string]: unknown };
  type Schema = { name: string; namespace?: string; fields: Field[] };
  const v1 = () => JSON.parse(read("avro/order-created.v1.avsc")) as Schema;
  const field = (s: Schema, name: string) =>
    s.fields.find((f) => f.name === name)!;
  const lineItem = (s: Schema) =>
    (field(s, "items").type as { items: Schema }).items;
  const CHANGES: Record<string, (s: Schema) => void> = {
    A1: (s) => (s.fields = s.fields.filter((f) => f.name !== "customer_id")),
    A2: (s) =>
      Object.assign(field(s, "currency"), {
        name: "currency_code",
        aliases: ["currency"],
      }),
    A3: (s) => (field(lineItem(s), "quantity").type = "long"),
    A4: (s) =>
      (field(s, "status").type as { symbols: string[] }).symbols.push(
        "REFUNDED",
      ),
    A5: (s) => {
      const f = field(s, "shipping_address");
      f.type = ["null", f.type];
      f.default = null;
    },
    A7: (s) => (s.name = "OrderPlaced"),
    R1: (s) => s.fields.push(...s.fields.splice(0, 1)),
    N1: (s) => s.fields.push({ name: "sales_channel", type: "string" }),
    N2: (s) => (s.namespace = "com.acme.orders"),
    N3: (s) => (field(s, "total_cents").type = "int"),
  };

  it.each(consumers)("%s matches v1", async (consumer) => {
    expect(
      (
        await compare(
          "avro",
          consumer,
          withSchema("avro", JSON.stringify(v1())),
        )
      ).map((r) => r.code),
    ).toEqual([MATCHED]);
  });

  it.each([
    ["A1", NO_MATCH, MATCHED],
    ["A2", NO_MATCH, MATCHED],
    ["A3", NO_MATCH, NO_MATCH],
    ["A4", NO_MATCH, NO_MATCH],
    ["A5", NO_MATCH, MATCHED],
    ["A7", NO_MATCH, NO_MATCH],
    ["R1", MATCHED, MATCHED],
    ["N1", MATCHED, MATCHED],
    ["N2", MATCHED, MATCHED],
    ["N3", MATCHED, MATCHED],
  ])(
    "%s: Notifications %s, Analytics %s",
    async (change, notifications, analytics) => {
      const schema = v1();
      CHANGES[change](schema);
      const doc = withSchema("avro", JSON.stringify(schema));
      expect(outcome(await compare("avro", "NotificationsService", doc))).toBe(
        notifications,
      );
      expect(outcome(await compare("avro", "AnalyticsService", doc))).toBe(
        analytics,
      );
    },
  );

  it("explains every v2 change to NotificationsService once, in field terms", async () => {
    const found = causes(
      await compare(
        "avro",
        "NotificationsService",
        withSchema("avro", read("avro/order-created.v2.avsc")),
      ),
    );
    expect(found.map((c) => c.message)).toEqual([
      "The consumer reads customer_id, which the provider's orders.OrderCreated no longer writes, and the consumer's schema has no default for it (READER_FIELD_MISSING_DEFAULT_VALUE)",
      'The consumer reads currency, which the provider no longer writes; it would always receive its default "USD", but its example expects "AUD"',
      "The provider may write orders.OrderStatus symbol REFUNDED, which the consumer's orders.OrderStatus doesn't have (MISSING_ENUM_SYMBOLS)",
      "The consumer's quantity is int, but the provider's is long (TYPE_MISMATCH)",
      "The provider may write null for shipping_address, which the consumer reads as orders.Address and can't read null (TYPE_MISMATCH)",
    ]);
  });

  it("reports a renamed record as a type mismatch", async () => {
    const schema = v1();
    CHANGES.A7(schema);
    const found = causes(
      await compare(
        "avro",
        "NotificationsService",
        withSchema("avro", JSON.stringify(schema)),
      ),
    );
    expect(found.map((c) => [c.code, c.message])).toEqual([
      [
        "message.payload.type.incompatible",
        "The consumer's message is the record OrderCreated, but the provider's is OrderPlaced",
      ],
    ]);
  });
});
