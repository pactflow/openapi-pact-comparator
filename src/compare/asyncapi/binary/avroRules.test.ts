// Rule-level tests for the Avro structural pass, calling the resolution walker
// directly.
import { describe, expect, it } from "vitest";

import { parseAvroSchema as parseSchema } from "#documents/avro";

import { type CompareOptions, compareSchemas } from "./avroRules";

type Fields = Array<Record<string, unknown>>;

const record = (fields: Fields, extra: Record<string, unknown> = {}) =>
  parseSchema({ type: "record", name: "M", namespace: "t", fields, ...extra });

const run = (
  provider: Fields,
  consumer: Fields,
  example?: unknown,
  options: Partial<CompareOptions> = {},
) =>
  compareSchemas(record(provider), record(consumer), example, {
    consumerRole: "read",
    ...options,
  });

const outcome = (problems: ReturnType<typeof run>) =>
  problems.some((p) => p.severity === "error")
    ? "error"
    : problems.some((p) => p.severity === "warning")
      ? "warning"
      : "pass";

const f = (
  name: string,
  type: unknown,
  extra: Record<string, unknown> = {},
) => ({
  name,
  type,
  ...extra,
});

describe("fields present and missing", () => {
  it("adding fields is never breaking", () => {
    expect(
      run([f("a", "string"), f("b", "string")], [f("a", "string")]),
    ).toEqual([]);
  });

  it("reordering fields is not breaking", () => {
    expect(
      run([f("b", "int"), f("a", "string")], [f("a", "string"), f("b", "int")]),
    ).toEqual([]);
  });

  it("a field the consumer reads without a default, which the provider no longer writes, is breaking", () => {
    const [p] = run(
      [f("a", "string")],
      [f("a", "string"), f("customer_id", "string")],
    );
    expect([p.severity, p.rule, p.consumerPath]).toEqual([
      "error",
      "READER_FIELD_MISSING_DEFAULT_VALUE",
      "customer_id",
    ]);
  });
});

describe("reader defaults", () => {
  const consumer = [f("currency", "string", { default: "USD" })];

  it("is breaking when the default would replace the value the example expects", () => {
    const [p] = run([], consumer, { currency: "AUD" });
    expect([p.severity, p.message]).toEqual([
      "error",
      'The consumer reads currency, which the provider no longer writes; it would always receive its default "USD", but its example expects "AUD"',
    ]);
  });

  it("is a warning when the default equals the example value", () => {
    expect(outcome(run([], consumer, { currency: "USD" }))).toBe("warning");
  });

  it("is a warning when the example couldn't be decoded", () => {
    expect(outcome(run([], consumer, undefined))).toBe("warning");
  });

  it("is judged per value in repeated records", () => {
    const item = (fields: Fields) =>
      f("items", {
        type: "array",
        items: { type: "record", name: "Item", fields },
      });
    const problems = run(
      [item([f("sku", "string")])],
      [
        item([
          f("sku", "string"),
          f("gift_wrap", "boolean", { default: false }),
        ]),
      ],
      {
        items: [
          { sku: "a", gift_wrap: false },
          { sku: "b", gift_wrap: true },
        ],
      },
    );
    expect(problems.map((p) => [p.severity, p.consumerPath])).toEqual([
      ["error", "items[].gift_wrap"],
    ]);
  });
});

describe("renamed fields", () => {
  it("a provider-side alias does not make a rename safe", () => {
    const [p] = run(
      [f("currency_code", "string", { aliases: ["currency"] })],
      [f("currency", "string")],
    );
    expect(p.rule).toBe("READER_FIELD_MISSING_DEFAULT_VALUE");
  });

  it("a consumer-side alias accepts a renamed field", () => {
    expect(
      run(
        [f("currency_code", "string")],
        [f("currency", "string", { aliases: ["currency_code"] })],
      ),
    ).toEqual([]);
  });
});

describe("types", () => {
  it.each([
    ["int", "long", "pass"],
    ["int", "float", "pass"],
    ["int", "double", "pass"],
    ["long", "float", "pass"],
    ["long", "double", "pass"],
    ["float", "double", "pass"],
    ["string", "bytes", "pass"],
    ["bytes", "string", "pass"],
    ["long", "int", "error"],
    ["double", "float", "error"],
    ["float", "long", "error"],
    ["int", "string", "error"],
    ["string", "int", "error"],
    ["boolean", "int", "error"],
  ])("writer %s -> reader %s is %s", (writer, reader, expected) => {
    expect(outcome(run([f("x", writer)], [f("x", reader)]))).toBe(expected);
  });

  it("a record where the consumer expects a string is breaking", () => {
    const [p] = run(
      [f("x", { type: "record", name: "Ref", fields: [] })],
      [f("x", "string")],
    );
    expect(p.rule).toBe("TYPE_MISMATCH");
  });

  it("a renamed nested record is breaking", () => {
    const address = (name: string) =>
      f("address", { type: "record", name, fields: [f("city", "string")] });
    const [p] = run([address("PostalAddress")], [address("Address")]);
    expect([p.rule, p.message]).toEqual([
      "NAME_MISMATCH",
      "The consumer's address is t.Address, but the provider's is t.PostalAddress (NAME_MISMATCH)",
    ]);
  });

  it("a consumer alias accepts a renamed nested record", () => {
    const address = (name: string, extra = {}) =>
      f("address", {
        type: "record",
        name,
        fields: [f("city", "string")],
        ...extra,
      });
    expect(
      run(
        [address("PostalAddress")],
        [address("Address", { aliases: ["PostalAddress"] })],
      ),
    ).toEqual([]);
  });
});

describe("arrays and maps", () => {
  it.each([
    [
      { type: "array", items: "string" },
      { type: "array", items: "bytes" },
      "pass",
    ],
    [
      { type: "array", items: "string" },
      { type: "map", values: "string" },
      "error",
    ],
    [{ type: "map", values: "int" }, { type: "map", values: "long" }, "pass"],
    [{ type: "map", values: "long" }, { type: "map", values: "int" }, "error"],
    [{ type: "array", items: "string" }, "string", "error"],
  ])("writer %j -> reader %j is %s", (writer, reader, expected) => {
    expect(outcome(run([f("x", writer)], [f("x", reader)]))).toBe(expected);
  });
});

describe("unions", () => {
  const address = {
    type: "record",
    name: "Address",
    fields: [f("city", "string")],
  };

  it("a field made nullable is breaking for a consumer that can't read null", () => {
    const [p] = run(
      [f("addr", ["null", address], { default: null })],
      [f("addr", address)],
    );
    expect([p.rule, p.message]).toEqual([
      "TYPE_MISMATCH",
      "The provider may write null for addr, which the consumer reads as t.Address and can't read null (TYPE_MISMATCH)",
    ]);
  });

  it("a consumer that reads a union accepts any branch it declares", () => {
    expect(run([f("addr", address)], [f("addr", ["null", address])])).toEqual(
      [],
    );
  });

  it("a union branch the consumer can't read is breaking", () => {
    const [p] = run(
      [f("d", ["null", "string", "long"])],
      [f("d", ["null", "string"])],
    );
    expect(p.rule).toBe("MISSING_UNION_BRANCH");
  });

  it("reordering union branches is not breaking", () => {
    expect(
      run(
        [f("d", ["string", "null"], { default: "x" })],
        [f("d", ["null", "string"])],
      ),
    ).toEqual([]);
  });
});

describe("fixed", () => {
  const fixed = (name: string, size: number) =>
    f("ck", { type: "fixed", name, size });

  it("a size change is breaking", () => {
    expect(run([fixed("Checksum", 32)], [fixed("Checksum", 16)])[0].rule).toBe(
      "FIXED_SIZE_MISMATCH",
    );
  });

  it("a rename is breaking", () => {
    expect(run([fixed("Digest", 16)], [fixed("Checksum", 16)])[0].rule).toBe(
      "NAME_MISMATCH",
    );
  });
});

describe("when the consumer writes", () => {
  const writes = { consumerRole: "write" as const };

  it("promotion is judged in the direction the data flows", () => {
    expect(
      outcome(run([f("n", "int")], [f("n", "long")], undefined, writes)),
    ).toBe("error");
    expect(
      outcome(run([f("n", "long")], [f("n", "int")], undefined, writes)),
    ).toBe("pass");
  });

  it("a field the provider reads without a default, which the consumer doesn't write, is breaking", () => {
    const [p] = run([f("reason", "string")], [], undefined, writes);
    expect([p.severity, p.rule]).toEqual([
      "error",
      "READER_FIELD_MISSING_DEFAULT_VALUE",
    ]);
  });

  it("a field the provider reads with a default, which the consumer doesn't write, is a warning", () => {
    expect(
      outcome(
        run(
          [f("reason", "string", { default: "unspecified" })],
          [],
          undefined,
          writes,
        ),
      ),
    ).toBe("warning");
  });

  it("a field the consumer writes that the provider doesn't read is a warning", () => {
    const [p] = run([], [f("notes", "string")], undefined, writes);
    expect([p.severity, p.message]).toEqual([
      "warning",
      "The consumer writes notes, which the provider's t.M doesn't read, so the provider will ignore it",
    ]);
  });
});

describe("enums", () => {
  const status = (
    symbols: string[],
    extra: Record<string, unknown> = {},
    name = "OrderStatus",
  ) => f("status", { type: "enum", name, symbols, ...extra });
  const consumer = [status(["PENDING", "PAID", "SHIPPED"])];
  const paid = { status: "PAID" };

  it("a symbol the provider may write that the consumer lacks is breaking", () => {
    const [p] = run(
      [status(["PENDING", "PAID", "SHIPPED", "REFUNDED"])],
      consumer,
      paid,
    );
    expect([p.rule, p.message]).toEqual([
      "MISSING_ENUM_SYMBOLS",
      "The provider may write t.OrderStatus symbol REFUNDED, which the consumer's t.OrderStatus doesn't have (MISSING_ENUM_SYMBOLS)",
    ]);
  });

  it("renaming a symbol is breaking", () => {
    expect(
      run([status(["PENDING", "PAID", "DISPATCHED"])], consumer, paid)[0]
        .message,
    ).toContain("DISPATCHED");
  });

  it("reordering symbols is not breaking", () => {
    expect(
      run([status(["SHIPPED", "PAID", "PENDING"])], consumer, paid),
    ).toEqual([]);
  });

  it("a consumer's enum default turns a missing symbol into a warning", () => {
    const problems = run(
      [status(["PENDING", "PAID", "SHIPPED", "REFUNDED"])],
      [
        status(["PENDING", "PAID", "SHIPPED", "UNKNOWN"], {
          default: "UNKNOWN",
        }),
      ],
      paid,
    );
    expect(problems.map((p) => [p.severity, p.message])).toEqual([
      [
        "warning",
        "The provider may write t.OrderStatus symbol REFUNDED, which the consumer's t.OrderStatus doesn't have; the consumer will read it as its default UNKNOWN",
      ],
    ]);
  });

  it("removing a symbol the consumer doesn't use is not breaking", () => {
    expect(run([status(["PENDING", "PAID"])], consumer, paid)).toEqual([]);
  });

  it("removing a symbol the consumer's example uses is breaking", () => {
    const [p] = run([status(["PENDING", "SHIPPED"])], consumer, paid);
    expect([p.severity, p.message]).toEqual([
      "error",
      "The consumer's example expects t.OrderStatus symbol PAID, which the provider's t.OrderStatus no longer has",
    ]);
  });

  it("a renamed enum is breaking", () => {
    expect(
      run(
        [status(["PENDING", "PAID", "SHIPPED"], {}, "Status")],
        consumer,
        paid,
      )[0].rule,
    ).toBe("NAME_MISMATCH");
  });

  it("a consumer alias accepts a renamed enum", () => {
    expect(
      run(
        [status(["PENDING", "PAID", "SHIPPED"], {}, "Status")],
        [status(["PENDING", "PAID", "SHIPPED"], { aliases: ["Status"] })],
        paid,
      ),
    ).toEqual([]);
  });

  it("a symbol the consumer writes that the provider lacks is breaking", () => {
    const [p] = run(
      [status(["PENDING"])],
      [status(["PENDING", "REFUNDED"])],
      undefined,
      { consumerRole: "write" },
    );
    expect([p.rule, p.message]).toEqual([
      "MISSING_ENUM_SYMBOLS",
      "The consumer may write t.OrderStatus symbol REFUNDED, which the provider's t.OrderStatus doesn't have (MISSING_ENUM_SYMBOLS)",
    ]);
  });

  it("a provider enum default tolerates a symbol the consumer writes, with a warning", () => {
    const problems = run(
      [status(["PENDING", "UNKNOWN"], { default: "UNKNOWN" })],
      [status(["PENDING", "REFUNDED"])],
      undefined,
      { consumerRole: "write" },
    );
    expect(outcome(problems)).toBe("warning");
  });
});
