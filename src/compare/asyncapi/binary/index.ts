import type Ajv from "ajv/dist/2019";

import type { Message } from "#documents/asyncapi";
import { binaryFormatOf, unwrapMultiFormatSchema } from "#documents/asyncapi";
import {
  findNamedType,
  namesMatch,
  parseAvroSchema,
  recordsOf,
  unqualified,
} from "#documents/avro";
import type { BinaryPayload } from "#documents/binary";
import { findProtoMessage, loadRoot } from "#documents/protobuf";
import {
  newUsage,
  schemaModel,
  usageFromExample,
  usageFromRulePath,
} from "#documents/protobufModel";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";

import { messageNames, validatePayload } from "../messagePayload";
import { compareSchemas as compareAvroSchemas } from "./avroRules";
import { compareMessages as compareProtobufMessages } from "./protobufRules";

// Avro and Protobuf payloads are compared in two passes:
//
// - a value pass: the consumer's decoded example is validated against the
//   provider's schema converted to JSON Schema, with AJV, as for JSON;
// - a structural pass: the consumer's own schema (embedded in the pact by the
//   plugin) is compared with the provider's, as the consumer's decoder will
//   read the provider's bytes: protobuf by field and enum number, Avro by
//   writer/reader schema resolution.
//
// Problems the structural pass reports are not repeated by the value pass.

type Format = BinaryPayload["format"];

interface Problem {
  severity: "error" | "warning" | "unvalidatable";
  message: string;
  consumerPath: string;
  consumerValue?: string;
  providerPath: string;
  providerValue?: string;
}

const FORMAT_NAMES: Record<Format, string> = {
  avro: "Avro",
  protobuf: "Protobuf",
};

const schemaFormatOf = (payload: object | undefined) => {
  const value = (payload as { schemaFormat?: unknown } | undefined)
    ?.schemaFormat;
  return typeof value === "string" ? value : undefined;
};

// Normalises a field path so the passes can be related: "items[].quantity",
// "/items/0/quantity" and "items{}" all become dotted field names.
const normalise = (path: string) =>
  path
    .replace(/\[\]|\{\}/g, "")
    .split(/[./]/)
    .filter((part) => part && !/^\d+$/.test(part))
    .join(".");

const stripDot = (name: string) => name.replace(/^\./, "");

export function* compareBinaryPayload(
  ajv: Ajv,
  message: Message,
  content: { payload: unknown; contentType?: string; binary?: BinaryPayload },
  interactionContext: { description?: string; providerState?: string },
  contentLocation: string,
  messagePath: string,
  direction: "request" | "response",
): Iterable<Result> {
  const payloadPath = `${messagePath}.payload`;
  const schemaPath = `${payloadPath}.schema`;
  const result = (
    code: Result["code"],
    type: Result["type"],
    text: string,
    specLocation = payloadPath,
    specValue?: unknown,
    mockLocation = contentLocation,
    mockValue: unknown = content.payload,
  ): Result => ({
    code,
    message: text,
    mockDetails: {
      ...baseMockDetails(interactionContext),
      location: mockLocation,
      value: mockValue,
    },
    specDetails: { location: specLocation, value: specValue },
    type,
  });

  const consumer = content.binary;
  const providerFormat = binaryFormatOf(message.payload);

  // The caller has already checked that the consumer's and provider's formats
  // agree.
  if (!consumer && content.payload === undefined) {
    return;
  }
  if (!message.payload) {
    yield result(
      "message.payload.unknown",
      "warning",
      "No schema found for message payload",
      messagePath,
    );
    return;
  }
  if (!consumer || !providerFormat) {
    return;
  }
  const format = FORMAT_NAMES[providerFormat];

  // --- Fail loudly: a binary payload that can't be compared is an error -------
  if (consumer.error) {
    yield result(
      "message.payload.uncomparable",
      "error",
      `The consumer's ${format} payload could not be decoded, so it cannot be compared: ${consumer.error}`,
    );
    return;
  }
  const names = messageNames(message, messagePath);
  const unwrapped = unwrapMultiFormatSchema(message.payload, names);
  if (unwrapped.status === "unsupported" || !unwrapped.schema) {
    const reason =
      unwrapped.status === "unsupported" ? unwrapped.reason : undefined;
    yield result(
      "message.payload.uncomparable",
      "error",
      `The provider's ${format} schema cannot be compared${reason ? `: ${reason}` : ""}`,
      `${payloadPath}.schemaFormat`,
      schemaFormatOf(message.payload),
    );
    return;
  }

  // --- Type identity and the structural pass -----------------------------------
  const reads = direction === "response";
  const source = (message.payload as { schema?: unknown }).schema;
  let problems: Problem[];
  try {
    if (consumer.format === "avro") {
      const consumerRecord = findNamedType(
        parseAvroSchema(consumer.avroSchema),
        consumer.declaredType,
      );
      const providerRecords = recordsOf(parseAvroSchema(source));
      const providerRecord = providerRecords.find((r) =>
        reads ? namesMatch(r, consumerRecord) : namesMatch(consumerRecord, r),
      );
      if (!providerRecord) {
        const carried = providerRecords.map((r) => unqualified(r.name ?? ""));
        yield result(
          "message.payload.type.incompatible",
          "error",
          `The consumer's message is the record ${unqualified(consumerRecord.name ?? "")}, but the provider's ${carried.length > 1 ? `union carries ${carried.join(", ")}` : `is ${carried[0] ?? "not a record"}`}`,
          schemaPath,
          carried,
          contentLocation,
          consumerRecord.name,
        );
        return;
      }
      problems = compareAvroSchemas(
        providerRecord,
        consumerRecord,
        content.payload,
        {
          consumerRole: reads ? "read" : "write",
        },
      );
    } else {
      const providerType = findProtoMessage(source as string, names)!;
      const consumerRoot = loadRoot(consumer.protobuf ?? {});
      const consumerType = consumerRoot.lookupType(consumer.declaredType!);
      const consumerName = stripDot(consumerType.fullName);
      const providerName = stripDot(providerType.fullName);
      if (consumerName !== providerName) {
        yield result(
          "message.payload.type.incompatible",
          "error",
          `The consumer's message is ${consumerName}, but the provider's message is ${providerName}`,
          schemaPath,
          providerName,
          contentLocation,
          consumerName,
        );
        return;
      }
      const usage = usageFromExample(
        consumerType,
        Buffer.from(consumer.content, "base64"),
        newUsage(),
      );
      for (const path of consumer.matchingRulePaths) {
        usageFromRulePath(consumerType, path, usage);
      }
      problems = compareProtobufMessages(
        schemaModel(consumerRoot),
        schemaModel(providerType.root),
        consumerName,
        providerName,
        usage,
        { consumerRole: reads ? "read" : "write", allowFieldRename: false },
      );
    }
  } catch (error) {
    yield result(
      "message.payload.uncomparable",
      "error",
      `The ${format} schemas could not be compared: ${(error as Error).message}`,
      schemaPath,
    );
    return;
  }

  for (const p of problems) {
    yield result(
      p.severity === "error"
        ? "message.payload.incompatible"
        : p.severity === "warning"
          ? "message.payload.risky"
          : "message.payload.unvalidatable",
      p.severity === "error" ? "error" : "warning",
      p.message,
      `${schemaPath}.${p.providerPath}`,
      p.providerValue,
      `${contentLocation}${p.consumerPath ? `.${p.consumerPath}` : ""}`,
      p.consumerValue,
    );
  }

  // --- The value pass, without repeating what the structural pass found -------
  const reported = problems
    .map((p) => normalise(p.consumerPath))
    .filter(Boolean);
  for (const { result: valueResult, path } of validatePayload(
    ajv,
    unwrapped.schema,
    `${payloadPath}${unwrapped.path}`,
    content.payload,
    interactionContext,
    contentLocation,
    direction,
  )) {
    const field = normalise(path);
    const covered = reported.some(
      (r) => field === r || field.startsWith(`${r}.`),
    );
    if (!covered) {
      yield valueResult;
    }
  }
}
