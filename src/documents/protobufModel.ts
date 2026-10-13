// A minimal model of a protobuf schema, for the structural comparison. The
// consumer's comes from the descriptors pact-protobuf-plugin embeds in the
// pact; the provider's from the .proto source embedded in the AsyncAPI
// document. Both are loaded with protobufjs and normalised into this model.
import protobuf from "protobufjs";

export type ScalarName =
  | "double"
  | "float"
  | "int32"
  | "int64"
  | "uint32"
  | "uint64"
  | "sint32"
  | "sint64"
  | "fixed32"
  | "fixed64"
  | "sfixed32"
  | "sfixed64"
  | "bool"
  | "string"
  | "bytes";

export interface EnumModel {
  fullName: string;
  values: Array<{ name: string; number: number }>;
}

export type TypeModel =
  | { kind: "scalar"; scalar: ScalarName }
  | { kind: "enum"; enum: EnumModel }
  | { kind: "message"; fullName: string };

export interface FieldModel {
  number: number;
  name: string;
  cardinality: "singular" | "repeated" | "map";
  // The element type; for maps, the value type.
  type: TypeModel;
  mapKey?: ScalarName;
  explicitPresence: boolean;
  // The real (non-synthetic) oneof this field belongs to, if any.
  oneof?: string;
}

export interface MessageModel {
  fullName: string;
  fields: Map<number, FieldModel>;
  reservedNames: Set<string>;
  reservedNumbers: Array<[number, number]>;
}

export interface SchemaModel {
  messages: Map<string, MessageModel>;
}

const typeName = (type: TypeModel): string => {
  switch (type.kind) {
    case "scalar":
      return type.scalar;
    case "enum":
      return type.enum.fullName;
    case "message":
      return type.fullName;
  }
};

/** Renders a field as it would be declared in a .proto file. */
export const declaration = (field: FieldModel): string => {
  const value = typeName(field.type);
  const type =
    field.cardinality === "map"
      ? `map<${field.mapKey}, ${value}>`
      : field.cardinality === "repeated"
        ? `repeated ${value}`
        : field.explicitPresence &&
            !field.oneof &&
            field.type.kind !== "message"
          ? `optional ${value}`
          : value;
  return `${type} ${field.name} = ${field.number}`;
};

export const isReservedNumber = (message: MessageModel, number: number) =>
  message.reservedNumbers.some(([from, to]) => number >= from && number <= to);

export const fieldByName = (message: MessageModel, name: string) =>
  [...message.fields.values()].find((field) => field.name === name);

const stripLeadingDot = (name: string) => name.replace(/^\./, "");

// --- From protobufjs ---------------------------------------------------------

const enumModel = (e: protobuf.Enum): EnumModel => ({
  fullName: stripLeadingDot(e.fullName),
  values: Object.entries(e.values).map(([name, number]) => ({ name, number })),
});

const typeModel = (field: protobuf.Field): TypeModel => {
  const resolved = field.resolvedType;
  if (resolved instanceof protobuf.Enum) {
    return { kind: "enum", enum: enumModel(resolved) };
  }
  if (resolved instanceof protobuf.Type) {
    return { kind: "message", fullName: stripLeadingDot(resolved.fullName) };
  }
  return { kind: "scalar", scalar: field.type as ScalarName };
};

const fieldModel = (field: protobuf.Field): FieldModel => {
  const proto3Optional = field.options?.proto3_optional === true;
  const map = field instanceof protobuf.MapField;
  return {
    number: field.id,
    name: field.name,
    cardinality: map ? "map" : field.repeated ? "repeated" : "singular",
    type: typeModel(field),
    mapKey: map
      ? ((field as protobuf.MapField).keyType as ScalarName)
      : undefined,
    explicitPresence:
      proto3Optional ||
      (!map &&
        !field.repeated &&
        (!!field.partOf || field.resolvedType instanceof protobuf.Type)),
    oneof: !proto3Optional && field.partOf ? field.partOf.name : undefined,
  };
};

const messageModel = (type: protobuf.Type): MessageModel => ({
  fullName: stripLeadingDot(type.fullName),
  fields: new Map(type.fieldsArray.map((f) => [f.id, fieldModel(f)])),
  reservedNames: new Set(
    (type.reserved ?? []).filter((r): r is string => typeof r === "string"),
  ),
  reservedNumbers: (type.reserved ?? []).filter((r): r is [number, number] =>
    Array.isArray(r),
  ),
});

/** Normalises every message in a resolved protobufjs root. */
export const schemaModel = (root: protobuf.Root): SchemaModel => {
  const messages = new Map<string, MessageModel>();
  const collect = (namespace: protobuf.NamespaceBase) => {
    for (const nested of namespace.nestedArray) {
      if (nested instanceof protobuf.Type) {
        messages.set(stripLeadingDot(nested.fullName), messageModel(nested));
      }
      if (
        nested instanceof protobuf.Namespace ||
        nested instanceof protobuf.Type
      ) {
        collect(nested);
      }
    }
  };
  collect(root);
  return { messages };
};

// --- Usage -------------------------------------------------------------------
// What the consumer uses: fields its example sets (recursively), enum values
// in its example, and fields its matching rules name.

export interface FieldUsage {
  child?: Usage;
  enumValues: Set<number>;
  // The example explicitly sets this explicit-presence field to its default.
  explicitDefault: boolean;
}

export interface Usage {
  fields: Map<number, FieldUsage>;
}

export const newUsage = (): Usage => ({ fields: new Map() });

const useField = (usage: Usage, number: number): FieldUsage => {
  let field = usage.fields.get(number);
  if (!field) {
    field = { enumValues: new Set(), explicitDefault: false };
    usage.fields.set(number, field);
  }
  return field;
};

const isDefault = (value: unknown) =>
  value === 0 ||
  value === "" ||
  value === false ||
  (typeof value === "object" &&
    value !== null &&
    "low" in value &&
    "high" in value &&
    (value as { low: number; high: number }).low === 0 &&
    (value as { low: number; high: number }).high === 0) ||
  (value instanceof Uint8Array && value.length === 0);

const addMessage = (
  usage: Usage,
  type: protobuf.Type,
  message: Record<string, unknown>,
) => {
  for (const field of type.fieldsArray) {
    // protobufjs sets only the fields present on the wire as own properties
    if (!Object.prototype.hasOwnProperty.call(message, field.name)) {
      continue;
    }
    const value = message[field.name];
    const values =
      field instanceof protobuf.MapField
        ? Object.values(value as object)
        : field.repeated
          ? (value as unknown[])
          : [value];
    const used = useField(usage, field.id);
    for (const v of values) {
      if (field.resolvedType instanceof protobuf.Enum) {
        used.enumValues.add(v as number);
      } else if (field.resolvedType instanceof protobuf.Type && v) {
        used.child ??= newUsage();
        addMessage(
          used.child,
          field.resolvedType,
          v as Record<string, unknown>,
        );
      }
    }
    if (
      !field.repeated &&
      !(field instanceof protobuf.MapField) &&
      !(field.resolvedType instanceof protobuf.Type) &&
      field.options?.proto3_optional === true &&
      isDefault(value)
    ) {
      used.explicitDefault = true;
    }
  }
};

/** Records every field the example message sets, recursively. */
export const usageFromExample = (
  type: protobuf.Type,
  bytes: Uint8Array,
  usage: Usage = newUsage(),
): Usage => {
  addMessage(
    usage,
    type,
    type.decode(bytes) as unknown as Record<string, unknown>,
  );
  return usage;
};

const pathTokens = (path: string) =>
  path
    .replace(/^\$/, "")
    .replace(/\[\s*'([^']*)'\s*\]/g, ".$1")
    .replace(/\[[^\]]*\]/g, ".*")
    .split(".")
    .filter(Boolean);

/** Records the fields a matching rule path (e.g. `$.items[*].sku`) names. */
export const usageFromRulePath = (
  type: protobuf.Type,
  path: string,
  usage: Usage = newUsage(),
): Usage => {
  let current: protobuf.Type | undefined = type;
  let currentUsage = usage;
  const tokens = pathTokens(path);
  for (let i = 0; i < tokens.length && current; i++) {
    if (tokens[i] === "*" || /^\d+$/.test(tokens[i])) {
      continue;
    }
    const field: protobuf.Field | undefined = current.fields[tokens[i]];
    if (!field) {
      return usage;
    }
    const used = useField(currentUsage, field.id);
    if (field instanceof protobuf.MapField) {
      i++; // the next token is the map key
    }
    if (!(field.resolvedType instanceof protobuf.Type)) {
      return usage;
    }
    used.child ??= newUsage();
    currentUsage = used.child;
    current = field.resolvedType;
  }
  return usage;
};
