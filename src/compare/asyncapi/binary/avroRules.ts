// Compares the provider's Avro schema with the consumer's, as Avro schema
// resolution would when the consumer decodes with the writer's schema (the
// documented runtime assumption), plus BDCT's own rules for what resolution
// lets through: reader defaults standing in for values the consumer's example
// relies on, enum symbols the example uses that the provider removed, and
// fields the provider ignores. Every problem is reported, not just the first.
// Rule names are Avro SchemaCompatibility's incompatibility types.
import type avro from "avsc";

import type { AvroType } from "#documents/avro";
import { branches, isUnion, namesMatch, typeNameOf } from "#documents/avro";

// An enum's default symbol, if it declares one (missing from avsc's typings).
const enumDefault = (type: AvroType): string | undefined =>
  (type as avro.types.EnumType & { default?: string }).default;

// Renders a type the way it would be written in a schema, for messages.
const describe = (type: AvroType): string => {
  if (isUnion(type)) {
    return `[${branches(type).map(describe).join(", ")}]`;
  }
  switch (typeNameOf(type)) {
    case "array":
      return `array of ${describe((type as avro.types.ArrayType).itemsType)}`;
    case "map":
      return `map of ${describe((type as avro.types.MapType).valuesType)}`;
    case "enum":
      return `enum ${type.name}`;
    case "fixed":
      return `fixed ${type.name} (size ${(type as avro.types.FixedType).size})`;
    case "record":
      return type.name ?? "record";
    default:
      return typeNameOf(type);
  }
};

type Severity = "error" | "warning" | "unvalidatable";

type Rule =
  | "READER_FIELD_MISSING_DEFAULT_VALUE"
  | "TYPE_MISMATCH"
  | "MISSING_ENUM_SYMBOLS"
  | "MISSING_UNION_BRANCH"
  | "NAME_MISMATCH"
  | "FIXED_SIZE_MISMATCH";

export interface Problem {
  severity: Severity;
  rule?: Rule;
  message: string;
  // Path of the field within the consumer's message, e.g. "items[].quantity".
  consumerPath: string;
  consumerValue?: string;
  // The provider's record and field, e.g. "orders.LineItem.quantity".
  providerPath: string;
  providerValue?: string;
}

export interface CompareOptions {
  // "read": the provider writes and the consumer reads (an AsyncAPI send
  // operation, or a reply). "write": the consumer writes and the provider
  // reads (the request of a request/reply operation).
  consumerRole: "read" | "write";
}

// Promotions allowed from a writer's primitive to a reader's.
const PROMOTIONS: Record<string, string[]> = {
  int: ["long", "float", "double"],
  long: ["float", "double"],
  float: ["double"],
  string: ["bytes"],
  bytes: ["string"],
};

const NAMED = ["record", "enum", "fixed"];

interface Location {
  consumer: string;
  provider: string;
}

interface Context {
  options: CompareOptions;
  problems: Problem[];
  seen: Set<string>;
}

// Values from the consumer's decoded example at the current position, or
// undefined when the example couldn't be decoded.
type Values = unknown[] | undefined;

/**
 * Compares the provider's record with the consumer's. Their names have
 * already been matched (type identity); `example` is the consumer's example,
 * decoded with the consumer's schema.
 */
export const compareSchemas = (
  provider: AvroType,
  consumer: AvroType,
  example: unknown,
  options: CompareOptions,
): Problem[] => {
  const ctx: Context = { options, problems: [], seen: new Set() };
  const reads = options.consumerRole === "read";
  compareRecords(
    ctx,
    reads ? provider : consumer,
    reads ? consumer : provider,
    { consumer: "", provider: provider.name ?? "" },
    example === undefined ? undefined : [example],
  );
  return ctx.problems;
};

const join = (path: string, name: string) => (path ? `${path}.${name}` : name);

const report = (
  ctx: Context,
  severity: Severity,
  rule: Rule | undefined,
  message: string,
  at: Location,
  consumer?: AvroType,
  provider?: AvroType,
) => {
  ctx.problems.push({
    severity,
    rule,
    message: rule ? `${message} (${rule})` : message,
    consumerPath: at.consumer,
    consumerValue: consumer && describe(consumer),
    providerPath: at.provider,
    providerValue: provider && describe(provider),
  });
};

const json = (value: unknown) => JSON.stringify(value);

/** Shallow match used to pick a union branch, as Avro does. */
const branchMatches = (writer: AvroType, reader: AvroType): boolean => {
  if (typeNameOf(writer) === typeNameOf(reader)) {
    return NAMED.includes(typeNameOf(writer))
      ? namesMatch(writer, reader)
      : true;
  }
  return PROMOTIONS[typeNameOf(writer)]?.includes(typeNameOf(reader)) ?? false;
};

const resolve = (
  ctx: Context,
  writer: AvroType,
  reader: AvroType,
  at: Location,
  values: Values,
  field: string,
) => {
  const reads = ctx.options.consumerRole === "read";
  const [consumer, provider] = reads ? [reader, writer] : [writer, reader];
  const writes = reads ? "The provider may write" : "The consumer may write";
  const readerSide = reads ? "the consumer" : "the provider";

  if (isUnion(writer)) {
    for (const branch of branches(writer)) {
      if (isUnion(reader)) {
        const match = branches(reader).find((b) => branchMatches(branch, b));
        if (match) {
          resolve(ctx, branch, match, at, values, field);
        } else {
          report(
            ctx,
            "error",
            "MISSING_UNION_BRANCH",
            `${writes} ${describe(branch)} for ${field}, which ${readerSide}'s ${describe(reader)} can't read`,
            at,
            consumer,
            provider,
          );
        }
      } else if (branchMatches(branch, reader)) {
        resolve(ctx, branch, reader, at, values, field);
      } else {
        report(
          ctx,
          "error",
          "TYPE_MISMATCH",
          `${writes} ${describe(branch)} for ${field}, which ${readerSide} reads as ${describe(reader)} and can't read ${describe(branch)}`,
          at,
          consumer,
          provider,
        );
      }
    }
    return;
  }

  if (isUnion(reader)) {
    const match = branches(reader).find((b) => branchMatches(writer, b));
    if (match) {
      resolve(ctx, writer, match, at, values, field);
    } else {
      report(
        ctx,
        "error",
        "TYPE_MISMATCH",
        `${reads ? "The provider writes" : "The consumer writes"} ${describe(writer)} for ${field}, which ${readerSide}'s ${describe(reader)} can't read`,
        at,
        consumer,
        provider,
      );
    }
    return;
  }

  const mismatch = (rule: Rule) =>
    report(
      ctx,
      "error",
      rule,
      `The consumer's ${field} is ${describe(consumer)}, but the provider's is ${describe(provider)}`,
      at,
      consumer,
      provider,
    );

  if (typeNameOf(writer) !== typeNameOf(reader)) {
    if (!PROMOTIONS[typeNameOf(writer)]?.includes(typeNameOf(reader))) {
      mismatch("TYPE_MISMATCH");
    }
    return;
  }

  if (NAMED.includes(typeNameOf(writer)) && !namesMatch(writer, reader)) {
    mismatch("NAME_MISMATCH");
    return;
  }

  switch (typeNameOf(writer)) {
    case "record":
      compareRecords(ctx, writer, reader, at, values);
      return;
    case "enum":
      compareEnums(ctx, writer, reader, at, values, consumer, provider);
      return;
    case "fixed":
      if (
        (writer as unknown as { size: number }).size !==
        (reader as unknown as { size: number }).size
      ) {
        mismatch("FIXED_SIZE_MISMATCH");
      }
      return;
    case "array":
      resolve(
        ctx,
        (writer as unknown as { itemsType: AvroType }).itemsType,
        (reader as unknown as { itemsType: AvroType }).itemsType,
        { ...at, consumer: `${at.consumer}[]` },
        values?.flatMap((v) => (Array.isArray(v) ? v : [])),
        `${field}[]`,
      );
      return;
    case "map":
      resolve(
        ctx,
        (writer as unknown as { valuesType: AvroType }).valuesType,
        (reader as unknown as { valuesType: AvroType }).valuesType,
        { ...at, consumer: `${at.consumer}{}` },
        values?.flatMap((v) =>
          v && typeof v === "object" ? Object.values(v) : [],
        ),
        `${field}{}`,
      );
      return;
  }
};

type RecordField = {
  name: string;
  aliases?: string[];
  type: AvroType;
  defaultValue(): unknown;
};
const fieldsOf = (record: AvroType) =>
  (record as unknown as { fields: RecordField[] }).fields;

const compareRecords = (
  ctx: Context,
  writer: AvroType,
  reader: AvroType,
  at: Location,
  values: Values,
) => {
  const key = `${writer.name}|${reader.name}`;
  if (ctx.seen.has(key)) {
    return;
  }
  ctx.seen.add(key);

  const reads = ctx.options.consumerRole === "read";
  const providerRecord = reads ? writer : reader;
  const writerFields = fieldsOf(writer);
  const matched = new Set<RecordField>();

  for (const readerField of fieldsOf(reader)) {
    const writerField = writerFields.find(
      (f) =>
        f.name === readerField.name ||
        (readerField.aliases ?? []).includes(f.name),
    );
    const consumerField = reads ? readerField : (writerField ?? readerField);
    const providerField = reads ? writerField : readerField;
    const here: Location = {
      consumer: join(at.consumer, consumerField.name),
      provider: `${providerRecord.name}${providerField ? `.${providerField.name}` : ""}`,
    };
    const fieldValues = values?.map((v) =>
      v && typeof v === "object"
        ? (v as Record<string, unknown>)[consumerField.name]
        : undefined,
    );

    if (writerField) {
      matched.add(writerField);
      resolve(
        ctx,
        writerField.type,
        readerField.type,
        here,
        fieldValues,
        consumerField.name,
      );
      continue;
    }

    const fallback = readerField.defaultValue();
    if (fallback === undefined) {
      report(
        ctx,
        "error",
        "READER_FIELD_MISSING_DEFAULT_VALUE",
        reads
          ? `The consumer reads ${readerField.name}, which the provider's ${writer.name} no longer writes, and the consumer's schema has no default for it`
          : `The provider reads ${readerField.name}, which the consumer doesn't write, and the provider's schema has no default for it`,
        here,
        reads ? readerField.type : undefined,
        reads ? undefined : readerField.type,
      );
    } else if (reads) {
      const differs = fieldValues?.find(
        (v) => v !== undefined && json(v) !== json(fallback),
      );
      if (differs !== undefined) {
        report(
          ctx,
          "error",
          undefined,
          `The consumer reads ${readerField.name}, which the provider no longer writes; it would always receive its default ${json(fallback)}, but its example expects ${json(differs)}`,
          here,
          readerField.type,
        );
      } else {
        report(
          ctx,
          "warning",
          undefined,
          `The consumer reads ${readerField.name}, which the provider no longer writes; it will always receive its default ${json(fallback)}`,
          here,
          readerField.type,
        );
      }
    } else {
      report(
        ctx,
        "warning",
        undefined,
        `The provider reads ${readerField.name}, which the consumer doesn't write; it will always read its default ${json(fallback)}`,
        here,
        undefined,
        readerField.type,
      );
    }
  }

  // Fields the consumer writes that the provider doesn't read are ignored by
  // the provider: tolerated (Postel's law), but reported.
  if (!reads) {
    for (const writerField of writerFields.filter((f) => !matched.has(f))) {
      report(
        ctx,
        "warning",
        undefined,
        `The consumer writes ${writerField.name}, which the provider's ${reader.name} doesn't read, so the provider will ignore it`,
        {
          consumer: join(at.consumer, writerField.name),
          provider: reader.name ?? "",
        },
        writerField.type,
      );
    }
  }
};

const compareEnums = (
  ctx: Context,
  writer: AvroType,
  reader: AvroType,
  at: Location,
  values: Values,
  consumer: AvroType,
  provider: AvroType,
) => {
  const reads = ctx.options.consumerRole === "read";
  const symbols = (t: AvroType) =>
    (t as unknown as { symbols: string[] }).symbols;
  const missing = symbols(writer).filter((s) => !symbols(reader).includes(s));
  const plural = missing.length > 1 ? "symbols" : "symbol";
  const fallback = enumDefault(reader);

  if (missing.length > 0) {
    const who = reads ? "The provider" : "The consumer";
    const whose = reads ? "the consumer's" : "the provider's";
    if (fallback !== undefined) {
      report(
        ctx,
        "warning",
        undefined,
        `${who} may write ${writer.name} ${plural} ${missing.join(", ")}, which ${whose} ${reader.name} doesn't have; ${reads ? "the consumer" : "the provider"} will read ${missing.length > 1 ? "them" : "it"} as its default ${fallback}`,
        at,
        consumer,
        provider,
      );
    } else {
      report(
        ctx,
        "error",
        "MISSING_ENUM_SYMBOLS",
        `${who} may write ${writer.name} ${plural} ${missing.join(", ")}, which ${whose} ${reader.name} doesn't have`,
        at,
        consumer,
        provider,
      );
    }
  }

  // Symbols the consumer's example expects, which the provider never writes.
  if (reads && values) {
    const gone = [
      ...new Set(values.filter((v): v is string => typeof v === "string")),
    ].filter((s) => !symbols(writer).includes(s));
    for (const symbol of gone) {
      report(
        ctx,
        "error",
        undefined,
        `The consumer's example expects ${reader.name} symbol ${symbol}, which the provider's ${writer.name} no longer has`,
        at,
        consumer,
        provider,
      );
    }
  }
};
