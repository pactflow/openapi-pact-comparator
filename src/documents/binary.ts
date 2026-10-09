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

// Returns the decoded payload, or undefined if the contents aren't a
// recognised binary payload or couldn't be decoded (callers then fall back to
// regular handling).
export const decodeBinaryContents = (
  contents: BinaryContents | undefined,
  context: PluginContext,
): { payload: unknown; contentType: string } | undefined => {
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

  try {
    if (isAvro(mediaType)) {
      const avro = isDict(config.avro) ? config.avro : {};
      const schema =
        avro.avroSchema ??
        pluginEntry(context, "avro", avro.schemaKey)?.avroSchema;
      const record = params.record ?? (avro.record as string | undefined);
      return {
        payload: decodeAvro(contents.content, schema, record),
        contentType: DECODED_CONTENT_TYPE,
      };
    }

    if (isProtobuf(mediaType) && params.message) {
      const protobuf = isDict(config.protobuf) ? config.protobuf : {};
      const entry = pluginEntry(context, "protobuf", protobuf.descriptorKey);
      return {
        payload: decodeProtobuf(contents.content, entry ?? {}, params.message),
        contentType: DECODED_CONTENT_TYPE,
      };
    }
  } catch {
    // undecodable: leave the payload alone so it is reported as unvalidatable
  }
  return undefined;
};
