import Ajv from "ajv";
import avro from "avro-js";
import { describe, expect, it } from "vitest";

import { avroToJsonSchema, decodeAvro } from "./avro";

const schema = {
  type: "record",
  name: "Item",
  namespace: "com.example",
  fields: [
    { name: "id", type: "long" },
    { name: "name", type: ["null", "string"] },
    { name: "payload", type: "bytes" },
    { name: "kind", type: { type: "enum", name: "Kind", symbols: ["A", "B"] } },
    { name: "tags", type: { type: "array", items: "string" } },
    { name: "counts", type: { type: "map", values: "int" } },
    {
      name: "owner",
      type: [
        "null",
        {
          type: "record",
          name: "Owner",
          fields: [{ name: "email", type: "string" }],
        },
      ],
    },
    { name: "next", type: ["null", "com.example.Item"], default: null },
  ],
};

const encode = (value: unknown, s: unknown = schema) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (avro.parse(s) as any).toBuffer(value).toString("base64");

const item = {
  id: 5,
  name: { string: "widget" },
  payload: Buffer.from("hi"),
  kind: "B",
  tags: ["x"],
  counts: { a: 1 },
  owner: { "com.example.Owner": { email: "a@b.c" } },
  next: { "com.example.Item": null },
};

describe("avro", () => {
  it("decodes binary into plain JSON", () => {
    const next = {
      ...item,
      name: null,
      owner: null,
      next: null,
    };
    const decoded = decodeAvro(
      encode({ ...item, next: { "com.example.Item": next } }),
      JSON.stringify(schema),
      "com.example.Item",
    );
    expect(decoded).toEqual({
      id: 5,
      name: "widget",
      payload: "aGk=",
      kind: "B",
      tags: ["x"],
      counts: { a: 1 },
      owner: { email: "a@b.c" },
      next: {
        id: 5,
        name: null,
        payload: "aGk=",
        kind: "B",
        tags: ["x"],
        counts: { a: 1 },
        owner: null,
        next: null,
      },
    });
  });

  it("finds a nested record by name", () => {
    const owner = encode(
      { email: "a@b.c" },
      {
        type: "record",
        name: "Owner",
        fields: [{ name: "email", type: "string" }],
      },
    );
    const wrapper = {
      type: "record",
      name: "Wrapper",
      fields: [
        {
          name: "o",
          type: {
            type: "record",
            name: "Owner",
            fields: [{ name: "email", type: "string" }],
          },
        },
      ],
    };
    expect(decodeAvro(owner, wrapper, "Owner")).toEqual({ email: "a@b.c" });
  });

  it("finds records by simple or full name, and throws if not found", () => {
    const base64 = encode({ ...item, next: null });
    const json = JSON.stringify(schema);
    expect(decodeAvro(base64, json, "Item")).toMatchObject({ id: 5 });
    expect(decodeAvro(base64, json, "com.example.Item")).toMatchObject({
      id: 5,
    });
    expect(() => decodeAvro(base64, json, "Other")).toThrow(/not found/);
  });

  it("supports top-level primitive schemas", () => {
    const base64 = encode("hello", { type: "string" });
    for (const s of ["string", '"string"', { type: "string" }]) {
      expect(decodeAvro(base64, s)).toBe("hello");
      expect(avroToJsonSchema(s)).toEqual({ type: "string" });
    }
    expect(() => avroToJsonSchema("nonsense")).toThrow();
  });

  it("converts to a JSON Schema that accepts the decoded payload", () => {
    const jsonSchema = avroToJsonSchema(schema);
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(jsonSchema);
    const decoded = decodeAvro(encode({ ...item, next: null }), schema);
    expect(validate(decoded), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...(decoded as object), id: "nope" })).toBe(false);
    expect(validate({ id: 1 })).toBe(false);
  });

  it("rejects things that are not Avro schemas", () => {
    expect(() =>
      avroToJsonSchema({ type: "object", properties: {} }),
    ).toThrow();
  });
});

describe("avroToJsonSchema unions", () => {
  it("accepts values matching overlapping branches", () => {
    const validate = new Ajv({ strict: false }).compile(
      avroToJsonSchema({
        type: "record",
        name: "R",
        fields: [{ name: "v", type: ["int", "double"] }],
      }),
    );
    expect(validate({ v: 1 })).toBe(true);
    expect(validate({ v: 1.5 })).toBe(true);
    expect(validate({ v: "x" })).toBe(false);
  });
});
