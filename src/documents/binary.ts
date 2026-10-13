import { decodeAvro } from "./avro";
import { decodeProtobuf } from "./protobuf";

// Decodes Avro / Protobuf payloads stored by the Pact plugins
// (pact-avro-plugin and pact-protobuf-plugin) into plain JSON values, so the
// rest of the comparison can treat them like any other JSON payload.
//
// Both plugins store `contents` as base64 with a content type like
// `avro/binary;record=Item` or `application/protobuf;message=.pkg.Msg`, and
// keep the schema under `pluginConfiguration` (interaction level) and/or
// `metadata.plugins[]` (pact level).

export interface BinaryContents {
  content?: unknown;
  contentType?: string;
  encoded?: string | boolean;
}

export interface PluginContext {
  // interaction.pluginConfiguration
  interaction?: unknown;
  // pact.metadata.plugins
  plugins?: unknown;
}

const DECODED_CONTENT_TYPE = "application/json";

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isAvro = (mediaType: string) =>
  ["avro/binary", "avro/bytes", "application/avro"].includes(mediaType) ||
  /^application\/.+\+avro$/.test(mediaType);

const isProtobuf = (mediaType: string) =>
  ["application/protobuf", "application/x-protobuf"].includes(mediaType);

const parseContentType = (contentType: string) => {
  const [mediaType, ...rest] = contentType.split(";");
  const params = Object.fromEntries(
    rest.map((p) => {
      const [key, ...value] = p.split("=");
      return [key.trim().toLowerCase(), value.join("=").trim()];
    }),
  );
  return { mediaType: mediaType.trim().toLowerCase(), params };
};

const pluginEntry = (
  { plugins }: PluginContext,
  name: string,
  key: unknown,
): Dict | undefined => {
  if (!Array.isArray(plugins) || typeof key !== "string") {
    return undefined;
  }
  const plugin = plugins.find((p) => isDict(p) && p.name === name);
  const entry =
    isDict(plugin) && isDict(plugin.configuration)
      ? plugin.configuration[key]
      : undefined;
  return isDict(entry) ? entry : undefined;
};

// The consumer's binary payload, as written by the plugin. Kept alongside the
// decoded payload so the comparison knows the consumer's format and declared
// type, and has the consumer's own schema for a structural comparison.
export interface BinaryPayload {
  format: "avro" | "protobuf";
  // The content type as written in the pact.
  contentType: string;
  // The record (Avro) or message (Protobuf) the pact declares.
  declaredType?: string;
  // Why the payload couldn't be decoded, if it couldn't.
  error?: string;
  // The consumer's schema: an Avro schema, or Protobuf descriptors / source.
  avroSchema?: unknown;
  protobuf?: { protoFile?: string; protoDescriptors?: string };
  // The example, base64 encoded.
  content: string;
  // Paths named by the interaction's matching rules.
  matchingRulePaths: string[];
}

export interface DecodedContents {
  payload: unknown;
  contentType: string;
  binary: BinaryPayload;
}

// Returns the decoded payload, or undefined if the contents aren't a
// recognised binary payload. A recognised payload that can't be decoded keeps
// its raw content and records why, so it's reported rather than skipped.
export const decodeBinaryContents = (
  contents: BinaryContents | undefined,
  context: PluginContext,
  matchingRules?: Record<string, unknown>,
): DecodedContents | undefined => {
  if (
    typeof contents?.content !== "string" ||
    typeof contents.contentType !== "string" ||
    typeof contents.encoded !== "string" ||
    contents.encoded.toLowerCase() !== "base64"
  ) {
    return undefined;
  }

  const { mediaType, params } = parseContentType(contents.contentType);
  const config = isDict(context.interaction) ? context.interaction : {};
  const matchingRulePaths = Object.keys(
    (isDict(matchingRules?.body) ? matchingRules.body : undefined) ??
      (isDict(matchingRules?.content) ? matchingRules.content : {}),
  );
  const raw = (binary: BinaryPayload, error: unknown): DecodedContents => ({
    payload: contents.content,
    contentType: contents.contentType!,
    binary: { ...binary, error: (error as Error).message },
  });

  if (isAvro(mediaType)) {
    const avro = isDict(config.avro) ? config.avro : {};
    const binary: BinaryPayload = {
      format: "avro",
      contentType: contents.contentType,
      declaredType: params.record ?? (avro.record as string | undefined),
      avroSchema:
        avro.avroSchema ??
        pluginEntry(context, "avro", avro.schemaKey)?.avroSchema,
      content: contents.content,
      matchingRulePaths,
    };
    try {
      if (binary.avroSchema === undefined) {
        throw new Error("the pact has no Avro schema for this message");
      }
      return {
        payload: decodeAvro(
          contents.content,
          binary.avroSchema,
          binary.declaredType,
        ),
        contentType: DECODED_CONTENT_TYPE,
        binary,
      };
    } catch (error) {
      return raw(binary, error);
    }
  }

  if (isProtobuf(mediaType)) {
    const protobuf = isDict(config.protobuf) ? config.protobuf : {};
    const entry =
      pluginEntry(context, "protobuf", protobuf.descriptorKey) ?? {};
    const binary: BinaryPayload = {
      format: "protobuf",
      contentType: contents.contentType,
      declaredType: params.message ?? (protobuf.message as string | undefined),
      protobuf: {
        protoFile: entry.protoFile as string | undefined,
        protoDescriptors: entry.protoDescriptors as string | undefined,
      },
      content: contents.content,
      matchingRulePaths,
    };
    try {
      if (!binary.declaredType) {
        throw new Error("the pact does not name the Protobuf message");
      }
      return {
        payload: decodeProtobuf(
          contents.content,
          binary.protobuf!,
          binary.declaredType,
        ),
        contentType: DECODED_CONTENT_TYPE,
        binary,
      };
    } catch (error) {
      return raw(binary, error);
    }
  }
  return undefined;
};
