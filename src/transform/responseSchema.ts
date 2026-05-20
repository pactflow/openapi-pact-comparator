import type { SchemaObject } from "ajv";
import { traverseWithDereferencing as traverse } from "#utils/schema";

export const transformReceivedSchema = (
  schema: SchemaObject,
  // quirks mode: skip additionalProperties=false for non-nullable schemas (legacy OAS compatibility)
  quirks = false,
): SchemaObject => {
  traverse(schema, (s) => {
    if (
      (typeof s.additionalProperties === "undefined" ||
        s.additionalProperties === true) &&
      !s.oneOf &&
      !s.allOf &&
      !s.anyOf &&
      s.type &&
      s.type === "object" &&
      (quirks ? !s.nullable : true)
    ) {
      s.additionalProperties = false;
    }
  });

  stripRequired(schema);

  return schema;
};

const stripRequired = (schema: SchemaObject): void => {
  traverse(schema, (s) => {
    if (s.oneOf) {
      return; // discriminator is required to be a valid schema
    }
    delete s.required;
  });
};
