import avro from "avro-js";
import protobuf from "protobufjs";
import { describe, expect, it } from "vitest";

import { decodeBinaryContents } from "./binary";
import { parse } from "./pact";

const avroSchema = JSON.stringify({
  type: "record",
  name: "Item",
  fields: [
    { name: "id", type: "string" },
    { name: "note", type: ["null", "string"] },
  ],
});
const avroContent = (avro.parse(avroSchema) as { toBuffer(v: unknown): Buffer })
  .toBuffer({ id: "a1", note: { string: "hello" } })
  .toString("base64");

const protoFile = `syntax = "proto3"; package pactissue; message MessageIn { string s = 1; }`;
const protoContent = (() => {
  const type = protobuf
    .parse(protoFile)
    .root.lookupType(".pactissue.MessageIn");
  return Buffer.from(type.encode({ s: "hi" }).finish()).toString("base64");
})();

const avroContents = {
  content: avroContent,
  contentType: "avro/binary;record=Item",
  contentTypeHint: "BINARY",
  encoded: "base64",
};
const protoContents = {
  content: protoContent,
  contentType: "application/protobuf;message=.pactissue.MessageIn",
  contentTypeHint: "BINARY",
  encoded: "base64",
};
const plugins = [
  { name: "protobuf", version: "0.6.4", configuration: { k1: { protoFile } } },
  { name: "avro", version: "0.1.0", configuration: { h1: { avroSchema } } },
];

describe("decodeBinaryContents", () => {
  it("decodes avro using the interaction-level schema", () => {
    expect(
      decodeBinaryContents(avroContents, {
        interaction: { avro: { avroSchema, record: "Item", schemaKey: "h1" } },
      }),
    ).toEqual({
      payload: { id: "a1", note: "hello" },
      contentType: "application/json",
    });
  });

  it("decodes avro using the pact-level schema", () => {
    expect(
      decodeBinaryContents(avroContents, {
        interaction: { avro: { schemaKey: "h1" } },
        plugins,
      })?.payload,
    ).toEqual({ id: "a1", note: "hello" });
  });

  it("decodes protobuf using the pact-level schema", () => {
    expect(
      decodeBinaryContents(protoContents, {
        interaction: { protobuf: { descriptorKey: "k1" } },
        plugins,
      }),
    ).toEqual({ payload: { s: "hi" }, contentType: "application/json" });
  });

  it.each([
    ["json content", { content: "{}", contentType: "application/json" }],
    ["not base64", { ...avroContents, encoded: false }],
    ["garbage", { ...avroContents, content: "AAAA" }],
  ])("ignores %s", (_, contents) => {
    expect(
      decodeBinaryContents(contents as never, {
        interaction: { avro: { avroSchema } },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the schema is missing", () => {
    expect(decodeBinaryContents(protoContents, {})).toBeUndefined();
  });
});

describe("pact parse", () => {
  const pact = (interaction: object) => ({
    metadata: { pactSpecification: { version: "4.0" }, plugins },
    interactions: [interaction],
  });

  it("decodes async message payloads", () => {
    const { interactions } = parse(
      pact({
        type: "Asynchronous/Messages",
        description: "m",
        contents: protoContents,
        pluginConfiguration: { protobuf: { descriptorKey: "k1" } },
      }),
    );
    expect(interactions[0]).toMatchObject({
      _kind: "async",
      payload: { s: "hi" },
      contentType: "application/json",
    });
  });

  it("decodes sync message payloads", () => {
    const { interactions } = parse(
      pact({
        type: "Synchronous/Messages",
        description: "m",
        pluginConfiguration: { avro: { schemaKey: "h1" } },
        request: { contents: avroContents },
        response: [{ contents: avroContents }],
      }),
    );
    expect(interactions[0]).toMatchObject({
      _kind: "sync",
      request: { payload: { id: "a1", note: "hello" } },
      responses: [{ payload: { id: "a1", note: "hello" } }],
    });
  });
});
