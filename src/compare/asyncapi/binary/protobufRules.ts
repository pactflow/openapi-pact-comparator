// Compares the consumer's view of a protobuf message with the provider's,
// considering only the fields and enum values the consumer uses. Fields are
// matched by number (what is on the wire), then by name. Rules follow protobuf
// wire semantics and borrow buf's breaking-rule names, but are defined in terms
// of the writer (who encodes the message) and the reader (who decodes it), so
// they apply to messages in either direction.
import type {
  EnumModel,
  FieldModel,
  FieldUsage,
  MessageModel,
  ScalarName,
  SchemaModel,
  TypeModel,
  Usage,
} from "#documents/protobufModel";
import {
  declaration,
  fieldByName,
  isReservedNumber,
} from "#documents/protobufModel";

type Severity = "error" | "warning" | "unvalidatable";

type Rule =
  | "FIELD_NO_DELETE"
  | "FIELD_SAME_NAME"
  | "FIELD_WIRE_COMPATIBLE_TYPE"
  | "FIELD_WIRE_COMPATIBLE_CARDINALITY"
  | "FIELD_SAME_CARDINALITY"
  | "FIELD_SAME_ONEOF"
  | "ENUM_VALUE_SAME_NAME"
  | "ENUM_VALUE_NO_DELETE"
  | "FIELD_SAME_TYPE";

export interface Problem {
  severity: Severity;
  rule?: Rule;
  message: string;
  // Path of the field within the consumer's message, e.g. "items[].quantity".
  consumerPath: string;
  consumerValue?: string;
  // Fully qualified provider field, e.g. "orders.LineItem.quantity".
  providerPath: string;
  providerValue?: string;
}

export interface CompareOptions {
  // "read": the consumer reads what the provider writes (an AsyncAPI send
  // operation, or a reply). "write": the consumer writes what the provider
  // reads (the request of a request/reply operation).
  consumerRole: "read" | "write";
  allowFieldRename: boolean;
}

// --- Scalar wire compatibility ------------------------------------------------

type Compatibility = "same" | "widening" | "risky" | "incompatible";

const RANGES: Partial<Record<ScalarName, [bigint, bigint]>> = {
  bool: [0n, 1n],
  int32: [-(2n ** 31n), 2n ** 31n - 1n],
  int64: [-(2n ** 63n), 2n ** 63n - 1n],
  uint32: [0n, 2n ** 32n - 1n],
  uint64: [0n, 2n ** 64n - 1n],
  sint32: [-(2n ** 31n), 2n ** 31n - 1n],
  sint64: [-(2n ** 63n), 2n ** 63n - 1n],
  fixed32: [0n, 2n ** 32n - 1n],
  sfixed32: [-(2n ** 31n), 2n ** 31n - 1n],
  fixed64: [0n, 2n ** 64n - 1n],
  sfixed64: [-(2n ** 63n), 2n ** 63n - 1n],
};

// Scalars that share an encoding, so one can read the other's values (with
// a caveat when ranges differ). Everything else must match exactly.
const ENCODINGS: ScalarName[][] = [
  ["int32", "int64", "uint32", "uint64", "bool"],
  ["sint32", "sint64"],
  ["fixed32", "sfixed32"],
  ["fixed64", "sfixed64"],
  ["string", "bytes"],
];

export const scalarCompatibility = (
  reader: ScalarName,
  writer: ScalarName,
): Compatibility => {
  if (reader === writer) {
    return "same";
  }
  if (
    !ENCODINGS.some((group) => group.includes(reader) && group.includes(writer))
  ) {
    return "incompatible";
  }
  if (reader === "bytes" && writer === "string") {
    return "widening";
  }
  if (reader === "string" && writer === "bytes") {
    return "risky";
  }
  const [rMin, rMax] = RANGES[reader]!;
  const [wMin, wMax] = RANGES[writer]!;
  return wMin >= rMin && wMax <= rMax ? "widening" : "risky";
};

const VARINT_INTS: ScalarName[] = ["int32", "int64", "uint32", "uint64"];

// --- Comparison -------------------------------------------------------------

interface Context {
  consumer: SchemaModel;
  provider: SchemaModel;
  options: CompareOptions;
  problems: Problem[];
  seen: Set<Usage>;
}

const verb = (ctx: Context) =>
  ctx.options.consumerRole === "read" ? "reads" : "writes";

const fieldPath = (parent: string, field: FieldModel) =>
  `${parent ? `${parent}.` : ""}${field.name}${field.cardinality === "repeated" ? "[]" : field.cardinality === "map" ? "{}" : ""}`;

/**
 * Compares the used parts of the consumer's message with the provider's.
 */
export const compareMessages = (
  consumer: SchemaModel,
  provider: SchemaModel,
  consumerType: string,
  providerType: string,
  usage: Usage,
  options: CompareOptions,
): Problem[] => {
  const ctx: Context = {
    consumer,
    provider,
    options,
    problems: [],
    seen: new Set(),
  };
  compareMessage(ctx, consumerType, providerType, usage, "");
  return ctx.problems;
};

const compareMessage = (
  ctx: Context,
  consumerType: string,
  providerType: string,
  usage: Usage,
  path: string,
) => {
  if (ctx.seen.has(usage)) {
    return;
  }
  ctx.seen.add(usage);

  const mine = ctx.consumer.messages.get(consumerType);
  const theirs = ctx.provider.messages.get(providerType);
  if (!mine || !theirs) {
    return;
  }

  const compared: Array<[FieldModel, FieldModel]> = [];
  for (const [number, used] of [...usage.fields].sort(([a], [b]) => a - b)) {
    const field = mine.fields.get(number);
    if (!field) {
      continue;
    }
    const other = compareFieldIdentity(ctx, mine, theirs, field, path);
    if (!other) {
      continue;
    }
    compared.push([field, other]);
    compareFieldShape(ctx, field, other, used, path, theirs);
  }
  compareOneofs(ctx, compared, path, theirs);
};

const problem = (
  ctx: Context,
  severity: Severity,
  rule: Rule | undefined,
  message: string,
  path: string,
  field: FieldModel,
  provider: MessageModel,
  other?: FieldModel,
) => {
  ctx.problems.push({
    severity,
    rule,
    message: rule ? `${message} (${rule})` : message,
    consumerPath: fieldPath(path, field),
    consumerValue: declaration(field),
    providerPath: `${provider.fullName}.${other?.name ?? field.name}`,
    providerValue: other ? declaration(other) : undefined,
  });
};

/** Finds the provider's field with the same number, reporting if it's gone or renamed. */
const compareFieldIdentity = (
  ctx: Context,
  mine: MessageModel,
  theirs: MessageModel,
  field: FieldModel,
  path: string,
): FieldModel | undefined => {
  const other = theirs.fields.get(field.number);
  if (!other) {
    const renumbered = fieldByName(theirs, field.name);
    if (renumbered) {
      problem(
        ctx,
        "error",
        "FIELD_NO_DELETE",
        `The consumer ${verb(ctx)} field ${field.name} as number ${field.number}, but the provider's ${field.name} is number ${renumbered.number}`,
        path,
        field,
        theirs,
        renumbered,
      );
    } else {
      const reserved = isReservedNumber(theirs, field.number)
        ? " (it is reserved)"
        : "";
      // A provider ignoring a field the consumer writes is tolerated (Postel's
      // law), but reported: the consumer may believe the data is acted on.
      const consumerWrites = ctx.options.consumerRole === "write";
      problem(
        ctx,
        consumerWrites ? "warning" : "error",
        "FIELD_NO_DELETE",
        `The consumer ${verb(ctx)} field ${field.name} (${field.number}) of ${mine.fullName}, but the provider's ${theirs.fullName} has no field ${field.number}${reserved}${consumerWrites ? ", so the provider will ignore it" : ""}`,
        path,
        field,
        theirs,
      );
    }
    return undefined;
  }

  if (other.name !== field.name) {
    if (theirs.reservedNames.has(field.name)) {
      problem(
        ctx,
        "error",
        "FIELD_SAME_NAME",
        `Field number ${field.number} was reused: the consumer ${verb(ctx)} it as ${field.name}, but the provider removed ${field.name} and now uses ${field.number} for ${other.name}`,
        path,
        field,
        theirs,
        other,
      );
    } else {
      problem(
        ctx,
        ctx.options.allowFieldRename ? "warning" : "error",
        "FIELD_SAME_NAME",
        `The consumer ${verb(ctx)} field ${field.number} as ${field.name}, but the provider's field ${field.number} is ${other.name}`,
        path,
        field,
        theirs,
        other,
      );
    }
  }
  return other;
};

/** Compares cardinality, type, presence and (for enums) the used values. */
const compareFieldShape = (
  ctx: Context,
  field: FieldModel,
  other: FieldModel,
  used: FieldUsage,
  path: string,
  theirs: MessageModel,
) => {
  const consumerReads = ctx.options.consumerRole === "read";
  const reader = consumerReads ? field : other;
  const writer = consumerReads ? other : field;
  const report = (
    severity: Severity,
    rule: Rule | undefined,
    message: string,
  ) => problem(ctx, severity, rule, message, path, field, theirs, other);
  const describe = `The consumer's field ${field.name} (${field.number}) is ${declaration(field).replace(/ \S+ = \d+$/, "")}, but the provider's is ${declaration(other).replace(/ \S+ = \d+$/, "")}`;

  // Cardinality
  if ((reader.cardinality === "map") !== (writer.cardinality === "map")) {
    report("error", "FIELD_WIRE_COMPATIBLE_CARDINALITY", describe);
    return;
  }
  if (reader.cardinality === "map") {
    const keys = scalarCompatibility(reader.mapKey!, writer.mapKey!);
    if (keys === "incompatible" || keys === "risky") {
      report(
        keys === "risky" ? "warning" : "error",
        "FIELD_WIRE_COMPATIBLE_TYPE",
        describe,
      );
      if (keys === "incompatible") {
        return;
      }
    }
  } else if (
    reader.cardinality === "singular" &&
    writer.cardinality === "repeated"
  ) {
    report(
      "error",
      "FIELD_WIRE_COMPATIBLE_CARDINALITY",
      `${describe}; the provider may send several values where the consumer expects one`,
    );
    return;
  }

  // Type
  if (!compareType(reader.type, writer.type, report, describe)) {
    return;
  }

  if (
    field.type.kind === "message" &&
    other.type.kind === "message" &&
    used.child
  ) {
    compareMessage(
      ctx,
      field.type.fullName,
      other.type.fullName,
      used.child,
      fieldPath(path, field),
    );
  }

  if (field.type.kind === "enum" && other.type.kind === "enum") {
    compareEnumValues(ctx, field.type.enum, other.type.enum, used, report);
  }

  // Presence: only meaningful for singular scalars and enums outside a oneof.
  if (
    reader.cardinality === "singular" &&
    reader.type.kind !== "message" &&
    !reader.oneof &&
    !writer.oneof &&
    reader.explicitPresence &&
    !writer.explicitPresence
  ) {
    if (consumerReads && used.explicitDefault) {
      report(
        "error",
        "FIELD_SAME_CARDINALITY",
        `The consumer expects ${field.name} (${field.number}) explicitly set to its default value, but the provider's ${other.name} has implicit presence, so a default value is never sent`,
      );
    } else {
      report(
        "warning",
        "FIELD_SAME_CARDINALITY",
        `${describe}: ${consumerReads ? "the provider" : "the consumer"} can no longer distinguish "set to the default value" from "not set"`,
      );
    }
  }
};

/** Returns false if the types are so different that nested checks are pointless. */
const compareType = (
  reader: TypeModel,
  writer: TypeModel,
  report: (severity: Severity, rule: Rule | undefined, message: string) => void,
  describe: string,
): boolean => {
  if (reader.kind === "scalar" && writer.kind === "scalar") {
    const compatibility = scalarCompatibility(reader.scalar, writer.scalar);
    if (compatibility === "incompatible") {
      report("error", "FIELD_WIRE_COMPATIBLE_TYPE", describe);
      return false;
    }
    if (compatibility === "risky") {
      report(
        "warning",
        "FIELD_WIRE_COMPATIBLE_TYPE",
        `${describe}; they share an encoding, but values may be truncated, change sign or be invalid`,
      );
    }
    return true;
  }

  if (reader.kind === "enum" && writer.kind === "enum") {
    if (reader.enum.fullName !== writer.enum.fullName) {
      report(
        "warning",
        "FIELD_SAME_TYPE",
        `${describe}; the enum type was renamed`,
      );
    }
    return true;
  }

  const enumAndInt =
    (reader.kind === "enum" &&
      writer.kind === "scalar" &&
      VARINT_INTS.includes(writer.scalar)) ||
    (writer.kind === "enum" &&
      reader.kind === "scalar" &&
      VARINT_INTS.includes(reader.scalar));
  if (enumAndInt) {
    if (reader.kind === "enum") {
      report(
        "warning",
        "FIELD_WIRE_COMPATIBLE_TYPE",
        `${describe}; values are not checked against the enum`,
      );
    }
    return false;
  }

  if (reader.kind === "message" && writer.kind === "message") {
    const wellKnown = [reader.fullName, writer.fullName].some((n) =>
      n.startsWith("google.protobuf."),
    );
    if (
      reader.fullName === "google.protobuf.Any" &&
      writer.fullName === "google.protobuf.Any"
    ) {
      report(
        "unvalidatable",
        undefined,
        "Fields of type google.protobuf.Any cannot be compared statically",
      );
      return false;
    }
    if (reader.fullName !== writer.fullName) {
      if (wellKnown) {
        report("error", "FIELD_WIRE_COMPATIBLE_TYPE", describe);
        return false;
      }
      report(
        "warning",
        "FIELD_SAME_TYPE",
        `${describe}; the message type was renamed`,
      );
    }
    return !wellKnown;
  }

  report("error", "FIELD_WIRE_COMPATIBLE_TYPE", describe);
  return false;
};

const compareEnumValues = (
  ctx: Context,
  mine: EnumModel,
  theirs: EnumModel,
  used: FieldUsage,
  report: (severity: Severity, rule: Rule | undefined, message: string) => void,
) => {
  const consumerReads = ctx.options.consumerRole === "read";
  for (const number of [...used.enumValues].sort((a, b) => a - b)) {
    const label =
      mine.values.find((v) => v.number === number)?.name ?? String(number);
    const names = theirs.values
      .filter((v) => v.number === number)
      .map((v) => v.name);
    if (names.includes(label)) {
      continue;
    }
    const moved = theirs.values.find((v) => v.name === label);
    const now = moved ? ` (${label} is now ${moved.number})` : "";
    if (names.length > 0) {
      report(
        "error",
        "ENUM_VALUE_SAME_NAME",
        consumerReads
          ? `The consumer reads ${mine.fullName} value ${number} as ${label}, but to the provider value ${number} is ${names.join("/")}${now}`
          : `The consumer sends ${mine.fullName} value ${number} meaning ${label}, but the provider reads value ${number} as ${names.join("/")}${now}`,
      );
    } else {
      report(
        "error",
        "ENUM_VALUE_NO_DELETE",
        consumerReads
          ? `The consumer expects ${mine.fullName} value ${label} (${number}), but the provider's ${theirs.fullName} has no value ${number}${now}`
          : `The consumer sends ${mine.fullName} value ${label} (${number}), but the provider's ${theirs.fullName} has no value ${number}${now}`,
      );
    }
  }
};

/** Checks oneof membership across the used fields of one message. */
const compareOneofs = (
  ctx: Context,
  compared: Array<[FieldModel, FieldModel]>,
  path: string,
  theirs: MessageModel,
) => {
  const consumerReads = ctx.options.consumerRole === "read";
  const groups = (side: 0 | 1) => {
    const result = new Map<string, Array<[FieldModel, FieldModel]>>();
    for (const pair of compared) {
      const oneof = pair[side].oneof;
      if (oneof) {
        result.set(oneof, [...(result.get(oneof) ?? []), pair]);
      }
    }
    return result;
  };
  const writerSide = consumerReads ? 1 : 0;
  const readerSide = consumerReads ? 0 : 1;

  // The writer can set only one of several fields the reader uses independently.
  for (const [oneof, pairs] of groups(writerSide)) {
    if (pairs.length < 2) {
      continue;
    }
    const readerOneofs = new Set(pairs.map((p) => p[readerSide].oneof));
    if (readerOneofs.size === 1 && !readerOneofs.has(undefined)) {
      continue;
    }
    const names = pairs.map(([f]) => f.name).join(", ");
    problem(
      ctx,
      "error",
      "FIELD_SAME_ONEOF",
      `The consumer uses ${names} independently, but the ${consumerReads ? "provider" : "consumer"} declares them in oneof ${oneof}, so only one can be set`,
      path,
      pairs[0][0],
      theirs,
      pairs[0][1],
    );
  }

  // The reader treats as alternatives fields the writer may now set together.
  for (const [oneof, pairs] of groups(readerSide)) {
    if (pairs.length < 2) {
      continue;
    }
    const writerOneofs = new Set(pairs.map((p) => p[writerSide].oneof));
    if (writerOneofs.size === 1 && !writerOneofs.has(undefined)) {
      continue;
    }
    const names = pairs.map(([f]) => f.name).join(", ");
    problem(
      ctx,
      "warning",
      "FIELD_SAME_ONEOF",
      `The ${consumerReads ? "consumer" : "provider"} reads ${names} as members of oneof ${oneof}, but the ${consumerReads ? "provider" : "consumer"} may now set more than one`,
      path,
      pairs[0][0],
      theirs,
      pairs[0][1],
    );
  }
};
