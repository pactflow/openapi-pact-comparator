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

import { compareSchemas as compareAvroSchemas } from "./avroRules";
import { compareMessages as compareProtobufMessages } from "./protobufRules";

// The structural pass of an Avro or Protobuf comparison: the consumer's own
// schema (embedded in the pact by the plugin) is compared with the provider's,
// as the consumer's decoder will read the provider's bytes: Protobuf by field
// and enum number, Avro by writer/reader schema resolution. It reports what it
// finds independently of the value pass, which validates the consumer's decoded
// example against the provider's schema converted to JSON Schema.
//
// It only reports what it knows: when the consumer's payload or either schema
// can't be decoded or parsed, it stays silent, and the value pass explains why
// that payload couldn't be validated.

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

const stripDot = (name: string) => name.replace(/^\./, "");

export function* compareBinaryStructure(
  message: Message,
  content: { payload: unknown; binary?: BinaryPayload; decodeError?: string },
  names: string[],
  interactionContext: { description?: string; providerState?: string },
  contentLocation: string,
  messagePath: string,
  direction: "request" | "response",
): Iterable<Result> {
  const consumer = content.binary;
  if (!consumer || !message.payload) {
    return;
  }
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

  // The caller has already checked that the consumer's and provider's formats
  // agree.
  const providerFormat = binaryFormatOf(message.payload);
  if (!providerFormat || content.decodeError) {
    return;
  }
  const format = FORMAT_NAMES[providerFormat];

  const unwrapped = unwrapMultiFormatSchema(message.payload, names);
  if (unwrapped.status === "unsupported" || !unwrapped.schema) {
    return;
  }

  // --- Type identity and the structural comparison ----------------------------
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
        { consumerRole: reads ? "read" : "write" },
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
      "message.payload.unvalidatable",
      "warning",
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
}
