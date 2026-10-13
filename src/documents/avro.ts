import avro from "avsc";

// Avro support: decode binary payloads into plain JSON-compatible values,
// convert Avro schemas into JSON Schema describing those same plain values, and
// expose the parsed type tree for structural (writer/reader) comparison.
// Parsed with avsc, which resolves named types, namespaces and aliases.
// Logical types are not registered, so they resolve to their underlying type.
//
// Plain representation: unions are unwrapped, bytes/fixed are base64 strings,
// everything else maps to its natural JSON counterpart.

export type AvroType = avro.Type;

export const AVRO_SCHEMA_FORMATS = [
  "application/vnd.apache.avro",
  "application/vnd.apache.avro+json",
  "application/vnd.apache.avro+yaml",
];

const PRIMITIVES = [
  "null",
  "boolean",
  "int",
  "long",
  "float",
  "double",
  "bytes",
  "string",
];

// avsc's built-in `long` throws on values beyond 2^53. Those are valid Avro, so
// decode them to the nearest JS number instead: not exact, but good enough to
// check against `{ type: "integer" }`.
const lenientLong = avro.types.LongType.__with(
  {
    fromBuffer: (buf: Buffer) => Number(buf.readBigInt64LE()),
    toBuffer: (n: number | bigint) => {
      const buf = Buffer.alloc(8);
      buf.writeBigInt64LE(BigInt(n));
      return buf;
    },
    fromJSON: Number,
    toJSON: Number,
    isValid: (n: unknown) =>
      typeof n === "bigint" || (typeof n === "number" && Number.isInteger(n)),
    compare: (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1),
  },
  // read the 8 byte two's complement form, not the zig-zag varint
  false,
);

// The type name, with the lenient long reported as plain `long`.
export const typeNameOf = (type: AvroType) =>
  type.typeName === "abstract:long" ? "long" : type.typeName;

export const parseAvroSchema = (schema: unknown): AvroType => {
  if (typeof schema === "string") {
    const text = schema.trim();
    try {
      schema = JSON.parse(text);
    } catch {
      // not JSON: only a bare primitive name (e.g. `string`) is valid
      if (!PRIMITIVES.includes(text)) {
        throw new Error(`Not a valid Avro schema: ${text}`);
      }
      schema = text;
    }
  }
  if (typeof schema === "string" && !PRIMITIVES.includes(schema)) {
    throw new Error(`Not a valid Avro schema: ${schema}`);
  }
  return avro.Type.forSchema(schema as avro.Schema, {
    // a bare `"long"` is looked up here; `{ "type": "long", ... }` (e.g. with a
    // logical type) goes through the hook
    registry: { long: lenientLong },
    typeHook: (attrs) =>
      (attrs as { type?: unknown } | null)?.type === "long"
        ? lenientLong
        : undefined,
  });
};

export const isUnion = (type: AvroType) => type.typeName.startsWith("union");

// avsc's typings split unions into two classes.
export const branches = (type: AvroType): AvroType[] =>
  (type as avro.types.UnwrappedUnionType | avro.types.WrappedUnionType).types;

export const unqualified = (name: string) => name.split(".").pop() ?? name;

const fieldsOf = (type: AvroType) => (type as avro.types.RecordType).fields;

// Whether a reader's named type accepts a writer's, per Avro: matching
// unqualified names, or a reader alias naming the writer's type.
export const namesMatch = (writer: AvroType, reader: AvroType) => {
  const writerName = unqualified(writer.name ?? "");
  return (
    writerName === unqualified(reader.name ?? "") ||
    (reader.aliases ?? []).some((alias) => unqualified(alias) === writerName)
  );
};

// The records a payload schema can carry: itself, or a union's record branches.
export const recordsOf = (type: AvroType): AvroType[] =>
  type.typeName === "record"
    ? [type]
    : isUnion(type)
      ? branches(type).filter((t) => t.typeName === "record")
      : [];

const children = (type: AvroType): AvroType[] => {
  if (type.typeName === "record") {
    return fieldsOf(type).map((f) => f.type);
  }
  if (isUnion(type)) {
    return branches(type);
  }
  if (type.typeName === "array") {
    return [(type as avro.types.ArrayType).itemsType];
  }
  if (type.typeName === "map") {
    return [(type as avro.types.MapType).valuesType];
  }
  return [];
};

// A pact may hold a single record or a whole schema; when `record` names a
// nested type, find it in the tree. `name` may be a full name or a simple name.
// An explicit name that can't be found is an error, rather than silently
// decoding as the wrong type.
export const findNamedType = (root: AvroType, name?: string): AvroType => {
  if (!name) {
    return root;
  }
  const matches = (type: AvroType) =>
    type.name === name || type.name?.endsWith(`.${name}`);
  const seen = new Set<AvroType>();
  const visit = (type: AvroType): AvroType | undefined => {
    if (seen.has(type)) {
      return undefined;
    }
    seen.add(type);
    return matches(type) ? type : children(type).map(visit).find(Boolean);
  };
  const found = visit(root);
  if (!found) {
    throw new Error(`Avro type '${name}' not found in schema`);
  }
  return found;
};

const toPlain = (type: AvroType, value: unknown): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (type.typeName === "union:wrapped") {
    // wrapped as `{ [branchName]: branchValue }`
    const [branch] = Object.keys(value as object);
    const branchType = branches(type).find((t) => t.branchName === branch);
    return branchType
      ? toPlain(branchType, (value as Record<string, unknown>)[branch])
      : null;
  }
  if (type.typeName === "union:unwrapped") {
    const branchType = branches(type).find((t) => t.isValid(value));
    return branchType ? toPlain(branchType, value) : value;
  }
  if (type.typeName === "record") {
    return Object.fromEntries(
      fieldsOf(type).map((f) => [
        f.name,
        toPlain(f.type, (value as Record<string, unknown>)[f.name]),
      ]),
    );
  }
  if (type.typeName === "array") {
    return (value as unknown[]).map((v) =>
      toPlain((type as avro.types.ArrayType).itemsType, v),
    );
  }
  if (type.typeName === "map") {
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => [
        k,
        toPlain((type as avro.types.MapType).valuesType, v),
      ]),
    );
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  return value;
};

export const decodeAvro = (
  base64: string,
  schema: unknown,
  record?: string,
): unknown => {
  const type = findNamedType(parseAvroSchema(schema), record);
  return toPlain(type, type.fromBuffer(Buffer.from(base64, "base64")));
};

type JsonSchema = Record<string, unknown>;

const INT_RANGE = { minimum: -(2 ** 31), maximum: 2 ** 31 - 1 };

const convert = (
  type: AvroType,
  defs: Record<string, JsonSchema>,
  active: Set<string>,
): JsonSchema => {
  if (isUnion(type)) {
    // anyOf, not oneOf: branches may overlap (e.g. int and double)
    return { anyOf: branches(type).map((t) => convert(t, defs, active)) };
  }
  switch (type.typeName) {
    case "array":
      return {
        type: "array",
        items: convert((type as avro.types.ArrayType).itemsType, defs, active),
      };
    case "map":
      return {
        type: "object",
        additionalProperties: convert(
          (type as avro.types.MapType).valuesType,
          defs,
          active,
        ),
      };
    case "enum":
      return {
        type: "string",
        enum: (type as avro.types.EnumType).symbols,
      };
    case "fixed":
    case "bytes":
    case "string":
      return { type: "string" };
    case "record": {
      const name = type.name as string;
      if (active.has(name)) {
        // recursive type: refer to the definition hoisted into $defs
        defs[name] ??= {};
        return { $ref: `#/$defs/${name}` };
      }
      active.add(name);
      const fields = fieldsOf(type);
      const schema: JsonSchema = {
        type: "object",
        properties: Object.fromEntries(
          fields.map((f) => [f.name, convert(f.type, defs, active)]),
        ),
        required: fields.map((f) => f.name),
      };
      active.delete(name);
      if (name in defs) {
        Object.assign(defs[name], schema);
        return { $ref: `#/$defs/${name}` };
      }
      return schema;
    }
    case "null":
      return { type: "null" };
    case "boolean":
      return { type: "boolean" };
    case "int":
      return { type: "integer", ...INT_RANGE };
    case "abstract:long": // see lenientLong
      return { type: "integer" };
    case "float":
    case "double":
      return { type: "number" };
    default:
      throw new Error(`Unsupported Avro type: ${type.typeName}`);
  }
};

export const avroToJsonSchema = (schema: unknown): JsonSchema => {
  const defs: Record<string, JsonSchema> = {};
  const result = convert(parseAvroSchema(schema), defs, new Set());
  return Object.keys(defs).length ? { ...result, $defs: defs } : result;
};
