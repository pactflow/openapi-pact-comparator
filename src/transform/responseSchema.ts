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

  relaxSchema(schema);

  return schema;
};

const relaxSchema = (schema: SchemaObject): void => {
  traverse(schema, (s) => {
    delete s.minProperties;
    if (!s.oneOf) {
      delete s.required; // oneOf keeps it: discriminator is required to be a valid schema
    }
  });
};
