import avro from "avsc";
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
const avroContent = avro.Type.forSchema(JSON.parse(avroSchema))
  .toBuffer({ id: "a1", note: "hello" })
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
      binary: {
        format: "avro",
        declaredType: "Item",
        avroSchema,
        content: avroContent,
        matchingRulePaths: [],
      },
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
    ).toEqual({
      payload: { s: "hi" },
      contentType: "application/json",
      binary: {
        format: "protobuf",
        declaredType: ".pactissue.MessageIn",
        protobuf: { protoFile, protoDescriptors: undefined },
        content: protoContent,
        matchingRulePaths: [],
      },
    });
  });

  it("records the paths named by the matching rules", () => {
    expect(
      decodeBinaryContents(
        avroContents,
        { interaction: { avro: { avroSchema } } },
        { body: { "$.id": { matchers: [] } } },
      )?.binary.matchingRulePaths,
    ).toEqual(["$.id"]);
  });

  it.each([
    ["json content", { content: "{}", contentType: "application/json" }],
    ["not base64", { ...avroContents, encoded: false }],
  ])("ignores %s", (_, contents) => {
    expect(
      decodeBinaryContents(contents as never, {
        interaction: { avro: { avroSchema } },
      }),
    ).toBeUndefined();
  });

  it("keeps the raw content and says why when decoding fails", () => {
    const failed = (contents: object, interaction: object, plugins?: unknown) =>
      decodeBinaryContents(contents as never, { interaction, plugins });

    expect(
      failed({ ...avroContents, content: "AAAA" }, { avro: { avroSchema } }),
    ).toMatchObject({
      payload: "AAAA",
      contentType: "avro/binary;record=Item",
      decodeError: expect.any(String),
    });
    expect(failed(avroContents, {})).toMatchObject({
      payload: avroContent,
      decodeError: "the pact has no Avro schema for this message",
    });
    expect(failed(protoContents, {})).toMatchObject({
      payload: protoContent,
      decodeError: expect.stringContaining("schema"),
    });
    expect(
      failed(
        { ...protoContents, contentType: "application/protobuf" },
        { protobuf: { descriptorKey: "k1" } },
        plugins,
      ),
    ).toMatchObject({
      decodeError: "the pact does not name the Protobuf message",
    });
    expect(
      failed(
        {
          ...protoContents,
          contentType: "application/protobuf;message=.pactissue.Nope",
        },
        { protobuf: { descriptorKey: "k1" } },
        plugins,
      ),
    ).toMatchObject({ decodeError: expect.stringContaining("Nope") });
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
