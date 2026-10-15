// Rule-level tests for the Protobuf structural pass. Both sides are built from
// .proto text, so the rules are tested in isolation from descriptor decoding
// and usage extraction.
import { describe, expect, it } from "vitest";

import { parseProto } from "#documents/protobuf";
import type {
  MessageModel,
  ScalarName,
  SchemaModel,
  Usage,
} from "#documents/protobufModel";
import { newUsage, schemaModel } from "#documents/protobufModel";

import {
  compareMessages,
  type CompareOptions,
  scalarCompatibility,
} from "./protobufRules";

const proto = (body: string) =>
  schemaModel(
    parseProto(
      `syntax = "proto3";\npackage t;\nimport "google/protobuf/timestamp.proto";\nimport "google/protobuf/duration.proto";\nimport "google/protobuf/any.proto";\n${body}`,
    ),
  );

// A usage spec: field name -> true, enum numbers, or a nested spec.
type Spec = {
  [field: string]: true | number[] | Spec | { explicitDefault: true };
};

const usageOf = (schema: SchemaModel, type: string, spec: Spec): Usage => {
  const message = schema.messages.get(type) as MessageModel;
  const usage = newUsage();
  for (const [name, value] of Object.entries(spec)) {
    const field = [...message.fields.values()].find((f) => f.name === name)!;
    const used = {
      enumValues: new Set<number>(),
      explicitDefault: false,
      child: undefined as Usage | undefined,
    };
    if (Array.isArray(value)) {
      value.forEach((v) => used.enumValues.add(v));
    } else if (value !== true && "explicitDefault" in value) {
      used.explicitDefault = true;
    } else if (value !== true && field.type.kind === "message") {
      used.child = usageOf(schema, field.type.fullName, value as Spec);
    }
    usage.fields.set(field.number, used);
  }
  return usage;
};

const run = (
  consumerBody: string,
  providerBody: string,
  spec: Spec,
  options: Partial<CompareOptions> = {},
  type = "t.M",
) => {
  const consumer = proto(consumerBody);
  return compareMessages(
    consumer,
    proto(providerBody),
    type,
    type,
    usageOf(consumer, type, spec),
    {
      consumerRole: "read",
      allowFieldRename: false,
      ...options,
    },
  );
};

const outcome = (problems: ReturnType<typeof run>) =>
  problems.some((p) => p.severity === "error")
    ? "error"
    : problems.some((p) => p.severity === "warning")
      ? "warning"
      : problems.some((p) => p.severity === "unvalidatable")
        ? "unvalidatable"
        : "pass";

describe("scalarCompatibility (reader <- writer)", () => {
  it.each([
    // incompatible encodings
    ["string", "int64", "incompatible"],
    ["int32", "sint32", "incompatible"],
    ["sint32", "int32", "incompatible"],
    ["int32", "fixed32", "incompatible"],
    ["float", "fixed32", "incompatible"],
    ["double", "int64", "incompatible"],
    // same encoding, values preserved
    ["int64", "int32", "widening"],
    ["uint64", "uint32", "widening"],
    ["sint64", "sint32", "widening"],
    ["int64", "uint32", "widening"],
    ["int32", "bool", "widening"],
    ["bytes", "string", "widening"],
    // same encoding, values may change
    ["int32", "int64", "risky"],
    ["uint32", "int32", "risky"],
    ["int32", "uint32", "risky"],
    ["bool", "int32", "risky"],
    ["fixed32", "sfixed32", "risky"],
    ["string", "bytes", "risky"],
  ] as const)("%s <- %s is %s", (reader, writer, expected) => {
    expect(
      scalarCompatibility(reader as ScalarName, writer as ScalarName),
    ).toBe(expected);
  });
});

describe("field identity", () => {
  it("adding fields is never breaking", () => {
    expect(
      run(
        "message M { string a = 1; }",
        "message M { string a = 1; string b = 2; }",
        { a: true },
      ),
    ).toEqual([]);
  });

  it("changes to unused fields are ignored", () => {
    expect(
      run(
        "message M { string a = 1; string b = 2; }",
        "message M { string a = 1; int64 b = 3; }",
        { a: true },
      ),
    ).toEqual([]);
  });

  it("a used field the writer no longer has is breaking, even when reserved", () => {
    const problems = run(
      "message M { string a = 1; }",
      'message M { reserved 1; reserved "a"; }',
      { a: true },
    );
    expect(problems.map((p) => [p.severity, p.rule])).toEqual([
      ["error", "FIELD_NO_DELETE"],
    ]);
  });

  it("a field the consumer writes that the provider doesn't know is a warning", () => {
    const [p] = run(
      "message M { string reason = 3; }",
      "message M { string other = 4; }",
      { reason: true },
      { consumerRole: "write" },
    );
    expect(p.severity).toBe("warning");
    expect(p.message).toBe(
      "The consumer writes field reason (3) of t.M, but the provider's t.M has no field 3, so the provider will ignore it (FIELD_NO_DELETE)",
    );
  });

  it("a field the consumer writes that the provider reads under another number is breaking", () => {
    const [p] = run(
      "message M { string reason = 3; }",
      "message M { string reason = 7; }",
      { reason: true },
      { consumerRole: "write" },
    );
    expect([p.severity, p.message]).toEqual([
      "error",
      "The consumer writes field reason as number 3, but the provider's reason is number 7 (FIELD_NO_DELETE)",
    ]);
  });
});

describe("field types", () => {
  it("narrowing is judged by direction", () => {
    const consumer = "message M { int64 limit = 1; }";
    const provider = "message M { int32 limit = 1; }";
    expect(
      outcome(
        run(consumer, provider, { limit: true }, { consumerRole: "read" }),
      ),
    ).toBe("pass");
    expect(
      outcome(
        run(consumer, provider, { limit: true }, { consumerRole: "write" }),
      ),
    ).toBe("warning");
  });

  it("an enum read from an integer field is a warning", () => {
    expect(
      outcome(
        run(
          "enum E { E0 = 0; E1 = 1; } message M { E status = 1; }",
          "message M { int32 status = 1; }",
          { status: [1] },
        ),
      ),
    ).toBe("warning");
  });

  it("nested message fields are compared recursively", () => {
    const [p] = run(
      "message I { int32 q = 1; } message M { repeated I items = 1; }",
      "message I { sint32 q = 1; } message M { repeated I items = 1; }",
      { items: { q: true } },
    );
    expect([p.consumerPath, p.providerPath]).toEqual(["items[].q", "t.I.q"]);
  });

  it("a renamed nested message type with compatible fields is a warning", () => {
    expect(
      outcome(
        run(
          "message A { string l = 1; } message M { A a = 1; }",
          "message P { string l = 1; } message M { P a = 1; }",
          { a: { l: true } },
        ),
      ),
    ).toBe("warning");
  });

  it("well-known types are compared by name", () => {
    expect(
      outcome(
        run(
          "message M { google.protobuf.Timestamp at = 1; }",
          "message M { google.protobuf.Duration at = 1; }",
          { at: true },
        ),
      ),
    ).toBe("error");
  });

  it("google.protobuf.Any is reported as unvalidatable", () => {
    expect(
      outcome(
        run(
          "message M { google.protobuf.Any x = 1; }",
          "message M { google.protobuf.Any x = 1; }",
          { x: true },
        ),
      ),
    ).toBe("unvalidatable");
  });
});

describe("cardinality and maps", () => {
  it.each([
    ["repeated I items = 1;", "I items = 1;", "pass"],
    ["I items = 1;", "repeated I items = 1;", "error"],
    ["repeated string tags = 1;", "string tags = 1;", "pass"],
    [
      "repeated int32 tags = 1;",
      "repeated int32 tags = 1 [packed = false];",
      "pass",
    ],
    ["map<string, string> attrs = 1;", "repeated I attrs = 1;", "error"],
    [
      "map<string, string> attrs = 1;",
      "map<int32, string> attrs = 1;",
      "error",
    ],
    [
      "map<string, int32> attrs = 1;",
      "map<string, sint32> attrs = 1;",
      "error",
    ],
  ])("consumer %s, provider %s -> %s", (mine, theirs, expected) => {
    const name = mine.match(/ (\w+) = 1/)![1];
    expect(
      outcome(
        run(
          `message I { string k = 1; } message M { ${mine} }`,
          `message I { string k = 1; } message M { ${theirs} }`,
          { [name]: true },
        ),
      ),
    ).toBe(expected);
  });
});

describe("presence", () => {
  it("a writer adding explicit presence is not breaking", () => {
    expect(
      run(
        "message M { int64 total = 3; }",
        "message M { optional int64 total = 3; }",
        { total: true },
      ),
    ).toEqual([]);
  });

  it("a writer dropping explicit presence is a warning", () => {
    expect(
      outcome(
        run(
          "message M { optional int64 discount = 11; }",
          "message M { int64 discount = 11; }",
          { discount: true },
        ),
      ),
    ).toBe("warning");
  });

  it("is breaking when the consumer's example relies on an explicitly set default", () => {
    const [p] = run(
      "message M { optional int64 discount = 11; }",
      "message M { int64 discount = 11; }",
      { discount: { explicitDefault: true } },
    );
    expect([p.severity, p.rule]).toEqual(["error", "FIELD_SAME_CARDINALITY"]);
  });
});

describe("oneof", () => {
  it("two used fields moved into one oneof is breaking", () => {
    const problems = run(
      "message M { string email = 9; string phone = 10; }",
      "message M { oneof contact { string email = 9; string phone = 10; } }",
      { email: true, phone: true },
    );
    expect(problems.map((p) => [p.severity, p.rule])).toEqual([
      ["error", "FIELD_SAME_ONEOF"],
    ]);
  });

  it("is safe when the consumer uses only one member", () => {
    expect(
      run(
        "message M { string email = 9; string phone = 10; }",
        "message M { oneof contact { string email = 9; string phone = 10; } }",
        { email: true },
      ),
    ).toEqual([]);
  });

  it("splitting a oneof the consumer reads is a warning", () => {
    expect(
      outcome(
        run(
          "message M { oneof contact { string email = 9; string phone = 10; } }",
          "message M { string email = 9; string phone = 10; }",
          { email: true, phone: true },
        ),
      ),
    ).toBe("warning");
  });
});

describe("enum values", () => {
  const consumer =
    "enum S { S0 = 0; PENDING = 1; PAID = 2; SHIPPED = 3; } message M { S status = 1; }";

  it("adding values is not breaking", () => {
    expect(
      run(
        consumer,
        "enum S { S0 = 0; PENDING = 1; PAID = 2; SHIPPED = 3; CANCELLED = 4; } message M { S status = 1; }",
        { status: [2] },
      ),
    ).toEqual([]);
  });

  it("changing unused values is not breaking", () => {
    expect(
      run(
        consumer,
        "enum S { S0 = 0; PENDING = 1; PAID = 2; DISPATCHED = 3; } message M { S status = 1; }",
        { status: [2] },
      ),
    ).toEqual([]);
  });

  it("a used value the writer no longer has is breaking", () => {
    const [p] = run(
      consumer,
      "enum S { S0 = 0; PENDING = 1; reserved 2; SHIPPED = 3; } message M { S status = 1; }",
      { status: [2] },
    );
    expect(p.message).toBe(
      "The consumer expects t.S value PAID (2), but the provider's t.S has no value 2 (ENUM_VALUE_NO_DELETE)",
    );
  });

  it("a value the consumer writes that the provider doesn't know is breaking", () => {
    const [p] = run(
      "enum S { S0 = 0; REFUNDED = 6; } message M { S status = 1; }",
      "enum S { S0 = 0; } message M { S status = 1; }",
      { status: [6] },
      { consumerRole: "write" },
    );
    expect(p.message).toContain("The consumer sends t.S value REFUNDED (6)");
  });

  it("aliases are accepted", () => {
    expect(
      run(
        consumer,
        "enum S { option allow_alias = true; S0 = 0; PENDING = 1; SETTLED = 2; PAID = 2; SHIPPED = 3; } message M { S status = 1; }",
        { status: [2] },
      ),
    ).toEqual([]);
  });

  it("a renamed enum type with matching values is a warning", () => {
    expect(
      outcome(
        run(
          consumer,
          "enum Status { S0 = 0; PENDING = 1; PAID = 2; SHIPPED = 3; } message M { Status status = 1; }",
          { status: [2] },
        ),
      ),
    ).toBe("warning");
  });
});
