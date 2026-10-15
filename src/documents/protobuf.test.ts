import Ajv from "ajv";
import protobuf from "protobufjs";
import descriptor from "protobufjs/ext/descriptor/index.js";
import { describe, expect, it } from "vitest";

import {
  decodeProtobuf,
  findProtoMessage,
  protobufToJsonSchema,
} from "./protobuf";

const protoFile = `
syntax = "proto3";
package shop;

enum Kind { UNKNOWN = 0; BOOK = 1; }
message Owner { string email = 1; }
message Item {
  string item_id = 1;
  int64 big = 2;
  bytes blob = 3;
  repeated int32 counts = 4;
  map<string, int32> by_name = 5;
  Kind kind = 6;
  Owner owner = 7;
  Item next = 8;
  oneof choice { string a = 9; int32 b = 10; }
}
`;

const encode = (obj: object) => {
  const type = protobuf
    .parse(protoFile, { keepCase: true })
    .root.lookupType(".shop.Item");
  return Buffer.from(type.encode(type.fromObject(obj)).finish()).toString(
    "base64",
  );
};

const item = {
  item_id: "i1",
  big: "123",
  blob: "aGk=",
  counts: [1, 2],
  by_name: { x: 1 },
  kind: "BOOK",
  owner: { email: "a@b.c" },
  next: { item_id: "i2" },
  a: "z",
};

describe("protobuf", () => {
  it("decodes binary into plain JSON using the embedded .proto", () => {
    expect(decodeProtobuf(encode(item), { protoFile }, ".shop.Item")).toEqual({
      ...item,
      big: 123,
      next: { item_id: "i2", counts: [], by_name: {} },
    });
  });

  it("decodes using the embedded descriptors", () => {
    const root = protobuf.parse(protoFile, { keepCase: true }).root;
    const { FileDescriptorSet } = descriptor as unknown as {
      FileDescriptorSet: protobuf.Type;
    };
    const set = (
      root as unknown as { toDescriptor(v: string): protobuf.Message }
    ).toDescriptor("proto3");
    const protoDescriptors = Buffer.from(
      FileDescriptorSet.encode(set).finish(),
    ).toString("base64");
    expect(
      decodeProtobuf(encode(item), { protoDescriptors }, ".shop.Item"),
    ).toMatchObject({ item_id: "i1", kind: "BOOK" });
  });

  it("throws when the message is unknown", () => {
    expect(() => decodeProtobuf("", { protoFile }, ".shop.Nope")).toThrow();
  });

  it("converts to a JSON Schema that accepts the decoded payload", () => {
    const type = findProtoMessage(protoFile, ["item"])!;
    const validate = new Ajv({ strict: false }).compile(
      protobufToJsonSchema(type),
    );
    const decoded = decodeProtobuf(encode(item), { protoFile }, ".shop.Item");
    expect(validate(decoded), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ item_id: 5 })).toBe(false);
    expect(validate({ kind: "MAGAZINE" })).toBe(false);
  });

  it("selects the message by name, or the sole message", () => {
    expect(findProtoMessage(protoFile, ["Owner"])?.name).toBe("Owner");
    expect(findProtoMessage(protoFile, ["unrelated"])).toBeUndefined();
    expect(
      findProtoMessage('syntax="proto3"; message Only { string s = 1; }', ["x"])
        ?.name,
    ).toBe("Only");
  });

  it("tries candidates in order, by simple or full name", () => {
    expect(findProtoMessage(protoFile, ["Owner", "Item"])?.name).toBe("Owner");
    expect(findProtoMessage(protoFile, ["Item", "Owner"])?.name).toBe("Item");
    expect(findProtoMessage(protoFile, ["shop.Owner"])?.name).toBe("Owner");
    expect(findProtoMessage(protoFile, [".shop.Item"])?.name).toBe("Item");
    expect(findProtoMessage(protoFile, ["nope", "OWNER"])?.name).toBe("Owner");
  });

  it("enforces oneof exclusivity, but not for single-member groups", () => {
    const type = findProtoMessage(
      `syntax = "proto3";
       message M {
         optional int32 opt = 1;
         oneof choice { string a = 2; int32 b = 3; bool c = 4; }
         oneof solo { string d = 5; }
       }`,
      ["M"],
    )!;
    const validate = new Ajv({ strict: false }).compile(
      protobufToJsonSchema(type),
    );
    expect(validate({})).toBe(true);
    expect(validate({ opt: 1, a: "x", d: "y" })).toBe(true);
    expect(validate({ b: 1 })).toBe(true);
    expect(validate({ a: "x", b: 1 })).toBe(false);
    expect(validate({ b: 1, c: true })).toBe(false);
  });

  it("reports unknown enum numbers as strings", () => {
    const type = protobuf
      .parse(protoFile.replace("Kind kind = 6;", "int32 kind = 6;"), {
        keepCase: true,
      })
      .root.lookupType(".shop.Item");
    const base64 = Buffer.from(
      type.encode(type.fromObject({ item_id: "i1", kind: 99 })).finish(),
    ).toString("base64");

    expect(decodeProtobuf(base64, { protoFile }, ".shop.Item")).toMatchObject({
      kind: "99",
    });
  });

  it("prefers the embedded descriptors over the .proto source", () => {
    // pact-protobuf-plugin embeds both; the source may import files the pact
    // doesn't contain, whereas protoc has resolved them into the descriptors.
    const root = protobuf.parse(protoFile, { keepCase: true }).root;
    const { FileDescriptorSet } = descriptor as unknown as {
      FileDescriptorSet: protobuf.Type;
    };
    const set = (
      root as unknown as { toDescriptor(v: string): protobuf.Message }
    ).toDescriptor("proto3");
    const protoDescriptors = Buffer.from(
      FileDescriptorSet.encode(set).finish(),
    ).toString("base64");
    const unresolvable = `syntax = "proto3"; import "shop/common.proto"; package shop; message Item { string item_id = 1; }`;
    expect(
      decodeProtobuf(
        encode(item),
        { protoFile: unresolvable, protoDescriptors },
        ".shop.Item",
      ),
    ).toMatchObject({ item_id: "i1", kind: "BOOK" });
  });

  it("resolves well-known type imports, and rejects other imports", () => {
    const withTimestamp = `syntax = "proto3"; package shop; import "google/protobuf/timestamp.proto"; message Placed { google.protobuf.Timestamp at = 1; }`;
    const placed = findProtoMessage(withTimestamp, ["Placed"])!;
    expect(protobufToJsonSchema(placed)).toMatchObject({
      properties: {
        at: { type: "object", properties: { seconds: { type: "integer" } } },
      },
    });
    expect(() =>
      findProtoMessage(
        `syntax = "proto3"; import "shop/common.proto"; message M {}`,
        ["M"],
      ),
    ).toThrow(/only google\/protobuf well-known types/);
  });

  it("constrains 32-bit and unsigned integers to their ranges", () => {
    const ranges = protobufToJsonSchema(
      findProtoMessage(
        `syntax = "proto3"; message R { int32 a = 1; uint32 b = 2; uint64 c = 3; map<string, int32> d = 4; }`,
        ["R"],
      )!,
    ) as { properties: Record<string, unknown> };
    expect(ranges.properties).toEqual({
      a: { type: "integer", minimum: -(2 ** 31), maximum: 2 ** 31 - 1 },
      b: { type: "integer", minimum: 0, maximum: 2 ** 32 - 1 },
      c: { type: "integer", minimum: 0 },
      d: {
        type: "object",
        additionalProperties: {
          type: "integer",
          minimum: -(2 ** 31),
          maximum: 2 ** 31 - 1,
        },
      },
    });
  });
});
