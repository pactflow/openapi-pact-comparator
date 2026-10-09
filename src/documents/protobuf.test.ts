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
});
