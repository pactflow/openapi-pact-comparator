import avro from "avro-js";

const { parse: avroParse, types } = avro;

// Avro support: decode binary payloads into plain JSON-compatible values, and
// convert Avro schemas into JSON Schema describing those same plain values.
// Both walk the type tree parsed by avro-js, which has already resolved named
// types, namespaces and aliases.
//
// Plain representation: unions are unwrapped, bytes/fixed are base64 strings,
// everything else maps to its natural JSON counterpart.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AvroType = any;

export const AVRO_SCHEMA_FORMATS = [
  "application/vnd.apache.avro",
  "application/vnd.apache.avro+json",
  "application/vnd.apache.avro+yaml",
];

const parseAvroSchema = (schema: unknown): AvroType => {
  if (typeof schema === "string") {
    schema = JSON.parse(schema); // avoid avro-js treating strings as file paths
  }
  return avroParse(schema);
};

// A pact may hold a single record or a whole schema; when `record` names a
// nested type, find it in the tree.
const findNamedType = (root: AvroType, name?: string): AvroType => {
  if (!name || root.getName?.() === name) {
    return root;
  }
  const seen = new Set<AvroType>();
  const visit = (type: AvroType): AvroType | undefined => {
    if (seen.has(type)) {
      return undefined;
    }
    seen.add(type);
    if (type.getName?.() === name) {
      return type;
    }
    const children: AvroType[] = [];
    if (type instanceof types.RecordType) {
      children.push(...type.getFields().map((f: AvroType) => f.getType()));
    } else if (type instanceof types.UnionType) {
      children.push(...type.getTypes());
    } else if (type instanceof types.ArrayType) {
      children.push(type.getItemsType());
    } else if (type instanceof types.MapType) {
      children.push(type.getValuesType());
    }
    return children.map(visit).find(Boolean);
  };
  return visit(root) ?? root;
};

const underlying = (type: AvroType): AvroType =>
  type instanceof types.LogicalType
    ? underlying(type.getUnderlyingType())
    : type;

const toPlain = (type: AvroType, value: unknown): unknown => {
  type = underlying(type);
  if (value === null || value === undefined) {
    return null;
  }
  if (type instanceof types.UnionType) {
    // wrapped as `{ [branchName]: branchValue }`
    const [branch] = Object.keys(value as object);
    const branchType = type
      .getTypes()
      .find((t: AvroType) => (t.getName() ?? t.getName(true)) === branch) as
      AvroType | undefined;
    return branchType
      ? toPlain(branchType, (value as Record<string, unknown>)[branch])
      : null;
  }
  if (type instanceof types.RecordType) {
    return Object.fromEntries(
      type
        .getFields()
        .map((f: AvroType) => [
          f.getName(),
          toPlain(f.getType(), (value as Record<string, unknown>)[f.getName()]),
        ]),
    );
  }
  if (type instanceof types.ArrayType) {
    return (value as unknown[]).map((v) => toPlain(type.getItemsType(), v));
  }
  if (type instanceof types.MapType) {
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => [
        k,
        toPlain(type.getValuesType(), v),
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
  type = underlying(type);

  if (type instanceof types.UnionType) {
    // anyOf, not oneOf: branches may overlap (e.g. int and double)
    return {
      anyOf: type.getTypes().map((t: AvroType) => convert(t, defs, active)),
    };
  }
  if (type instanceof types.ArrayType) {
    return { type: "array", items: convert(type.getItemsType(), defs, active) };
  }
  if (type instanceof types.MapType) {
    return {
      type: "object",
      additionalProperties: convert(type.getValuesType(), defs, active),
    };
  }
  if (type instanceof types.EnumType) {
    return { type: "string", enum: type.getSymbols() };
  }
  if (type instanceof types.FixedType || type instanceof types.BytesType) {
    return { type: "string" };
  }
  if (type instanceof types.RecordType) {
    const name = type.getName() as string;
    if (active.has(name)) {
      // recursive type: refer to the definition hoisted into $defs
      defs[name] ??= {};
      return { $ref: `#/$defs/${name}` };
    }
    active.add(name);
    const fields = type.getFields() as AvroType[];
    const schema: JsonSchema = {
      type: "object",
      properties: Object.fromEntries(
        fields.map((f) => [f.getName(), convert(f.getType(), defs, active)]),
      ),
      required: fields.map((f) => f.getName()),
    };
    active.delete(name);
    if (name in defs) {
      Object.assign(defs[name], schema);
      return { $ref: `#/$defs/${name}` };
    }
    return schema;
  }
  if (type instanceof types.NullType) {
    return { type: "null" };
  }
  if (type instanceof types.BooleanType) {
    return { type: "boolean" };
  }
  if (type instanceof types.IntType || type instanceof types.LongType) {
    return { type: "integer" };
  }
  if (type instanceof types.FloatType || type instanceof types.DoubleType) {
    return { type: "number" };
  }
  if (type instanceof types.StringType) {
    return { type: "string" };
  }
  throw new Error(`Unsupported Avro type: ${type.getSchema?.()}`);
};

export const avroToJsonSchema = (schema: unknown): JsonSchema => {
  const defs: Record<string, JsonSchema> = {};
  const result = convert(parseAvroSchema(schema), defs, new Set());
  return Object.keys(defs).length ? { ...result, $defs: defs } : result;
};
