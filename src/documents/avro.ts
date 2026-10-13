import avro from "avsc";

// Avro support: decode binary payloads into plain JSON-compatible values, and
// convert Avro schemas into JSON Schema describing those same plain values.
// Parsed with avsc, which resolves named types, namespaces and aliases.
// Logical types are not registered, so they resolve to their underlying type.
//
// Plain representation: unions are unwrapped, bytes/fixed are base64 strings,
// everything else maps to its natural JSON counterpart.

type AvroType = avro.Type;

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

const parseAvroSchema = (schema: unknown): AvroType => {
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
  return avro.Type.forSchema(schema as avro.Schema);
};

const isUnion = (type: AvroType) => type.typeName.startsWith("union");

// avsc's typings split unions into two classes.
const branches = (type: AvroType): AvroType[] =>
  (type as avro.types.UnwrappedUnionType | avro.types.WrappedUnionType).types;

const fieldsOf = (type: AvroType) => (type as avro.types.RecordType).fields;

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
const findNamedType = (root: AvroType, name?: string): AvroType => {
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
    case "long":
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
