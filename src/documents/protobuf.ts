import protobuf, { type Namespace, type Root, type Type } from "protobufjs";
import descriptor from "protobufjs/ext/descriptor/index.js";

// Protobuf support: decode binary payloads into plain JSON-compatible values,
// and convert proto message definitions into JSON Schema describing those same
// plain values.
//
// Plain representation: field names as written in the .proto (keepCase),
// 64-bit integers as numbers, enums as names, bytes as base64 strings, and
// unset proto3 scalars omitted.

export const PROTOBUF_SCHEMA_FORMATS = ["application/vnd.google.protobuf"];

export interface ProtoConfiguration {
  protoFile?: string;
  protoDescriptors?: string; // base64 FileDescriptorSet
}

const parseProto = (source: string): Root =>
  protobuf.parse(source, { keepCase: true }).root.resolveAll() as Root;

interface MessageDescriptor {
  field?: { jsonName?: string }[];
  nestedType?: MessageDescriptor[];
}

// protobufjs prefers `jsonName` (camelCase) over `name` when loading from a
// descriptor; drop it so field names match the .proto (keepCase) path.
const dropJsonNames = (messages: MessageDescriptor[] = []) => {
  for (const m of messages) {
    m.field?.forEach((f) => delete f.jsonName);
    dropJsonNames(m.nestedType);
  }
};

const loadRoot = ({
  protoFile,
  protoDescriptors,
}: ProtoConfiguration): Root => {
  if (protoFile) {
    return parseProto(protoFile);
  }
  if (protoDescriptors) {
    const { FileDescriptorSet } = descriptor as unknown as {
      FileDescriptorSet: Type;
    };
    const set = FileDescriptorSet.decode(
      Buffer.from(protoDescriptors, "base64"),
    );
    (
      set as unknown as { file: { messageType?: MessageDescriptor[] }[] }
    ).file.forEach((f) => dropJsonNames(f.messageType));
    const root = (
      protobuf.Root as unknown as { fromDescriptor(d: unknown): Root }
    ).fromDescriptor(set);
    return root.resolveAll() as Root;
  }
  throw new Error("No protobuf schema available");
};

// protobufjs leaves enum values it doesn't know as numbers. Stringify them so
// they are reported as not being an allowed enum value, rather than as a
// confusing type error.
const stringifyUnknownEnums = (type: Type, obj: Record<string, unknown>) => {
  for (const field of type.fieldsArray) {
    const resolved = field.resolvedType;
    const value = obj[field.name];
    if (!resolved || value == null) {
      continue;
    }
    const fix = (v: unknown): unknown => {
      if ("values" in resolved) {
        return typeof v === "number" ? String(v) : v;
      }
      if (typeof v === "object" && v !== null) {
        stringifyUnknownEnums(resolved as Type, v as Record<string, unknown>);
      }
      return v;
    };
    if (field instanceof protobuf.MapField) {
      const map = value as Record<string, unknown>;
      Object.keys(map).forEach((k) => (map[k] = fix(map[k])));
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => (value[i] = fix(v)));
    } else {
      obj[field.name] = fix(value);
    }
  }
};

export const decodeProtobuf = (
  base64: string,
  config: ProtoConfiguration,
  messageName: string,
): unknown => {
  const type = loadRoot(config).lookupType(messageName);
  const obj = type.toObject(type.decode(Buffer.from(base64, "base64")), {
    longs: Number,
    enums: String,
    bytes: String,
    arrays: true,
    objects: true,
  });
  stringifyUnknownEnums(type, obj);
  return obj;
};

const allTypes = (ns: Namespace): Type[] =>
  ns.nestedArray.flatMap((n) => [
    ...("fields" in n ? [n as Type] : []),
    ...("nestedArray" in n ? allTypes(n as Namespace) : []),
  ]);

// Picks the message in a .proto source matching a candidate, trying candidates
// in order. Candidates are compared case-insensitively against the simple name
// and the full name (with or without a leading dot). Falls back to the sole
// message if there is only one.
export const findProtoMessage = (
  source: string,
  candidates: string[],
): Type | undefined => {
  const types = allTypes(parseProto(source));
  for (const candidate of candidates) {
    const wanted = candidate.replace(/^\./, "").toLowerCase();
    const found = types.find(
      (t) =>
        t.name.toLowerCase() === wanted ||
        t.fullName.replace(/^\./, "").toLowerCase() === wanted,
    );
    if (found) {
      return found;
    }
  }
  return types.length === 1 ? types[0] : undefined;
};

type JsonSchema = Record<string, unknown>;

const SCALARS: Record<string, JsonSchema> = {
  double: { type: "number" },
  float: { type: "number" },
  bool: { type: "boolean" },
  string: { type: "string" },
  bytes: { type: "string" },
};
const INTEGERS = [
  "int32",
  "uint32",
  "sint32",
  "fixed32",
  "sfixed32",
  "int64",
  "uint64",
  "sint64",
  "fixed64",
  "sfixed64",
];

const convertField = (
  field: protobuf.Field,
  defs: Record<string, JsonSchema>,
  active: Set<string>,
): JsonSchema => {
  let schema: JsonSchema;
  if (INTEGERS.includes(field.type)) {
    schema = { type: "integer" };
  } else if (field.type in SCALARS) {
    schema = { ...SCALARS[field.type] };
  } else if (field.resolvedType && "values" in field.resolvedType) {
    schema = {
      type: "string",
      enum: Object.keys((field.resolvedType as protobuf.Enum).values),
    };
  } else if (field.resolvedType) {
    schema = convertMessage(field.resolvedType as Type, defs, active);
  } else {
    schema = {};
  }

  if (field instanceof protobuf.MapField) {
    return {
      type: "object",
      additionalProperties: INTEGERS.includes(field.type)
        ? { type: "integer" }
        : schema,
    };
  }
  return field.repeated ? { type: "array", items: schema } : schema;
};

const convertMessage = (
  type: Type,
  defs: Record<string, JsonSchema>,
  active: Set<string>,
): JsonSchema => {
  const name = type.fullName.replace(/^\./, "");
  if (active.has(name)) {
    defs[name] ??= {};
    return { $ref: `#/$defs/${name}` };
  }
  active.add(name);
  const fields = type.fieldsArray;
  const schema: JsonSchema = {
    type: "object",
    properties: Object.fromEntries(
      fields.map((f) => [f.name, convertField(f, defs, active)]),
    ),
  };
  const required = fields.filter((f) => f.required).map((f) => f.name);
  if (required.length) {
    schema.required = required;
  }
  // at most one member of each oneof may be set. Single-member groups (which
  // include proto3 `optional`'s synthetic ones) need no constraint.
  const exclusive = type.oneofsArray.flatMap((oneof) => {
    const names = oneof.fieldsArray.map((f) => f.name);
    return names.flatMap((a, i) =>
      names.slice(i + 1).map((b) => ({ required: [a, b] })),
    );
  });
  if (exclusive.length) {
    schema.not = { anyOf: exclusive };
  }
  active.delete(name);
  if (name in defs) {
    Object.assign(defs[name], schema);
    return { $ref: `#/$defs/${name}` };
  }
  return schema;
};

export const protobufToJsonSchema = (type: Type): JsonSchema => {
  const defs: Record<string, JsonSchema> = {};
  const result = convertMessage(type, defs, new Set());
  return Object.keys(defs).length ? { ...result, $defs: defs } : result;
};
