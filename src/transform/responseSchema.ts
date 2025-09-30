import { SchemaObject } from "ajv";
import { traverseWithDereferencing as traverse } from "#utils/schema";

export const transformResponseSchema = (
  schema: SchemaObject,
  noTransformNonNullableResponseSchema: boolean,
): SchemaObject => {
  // a provider must provide a superset of what the consumer asks for
  // additionalProperties expected in pact response are disallowed
  traverse(schema, (s) => {
    if (
      (typeof s.additionalProperties === "undefined" ||
        s.additionalProperties === true) &&
      !s.oneOf &&
      !s.allOf &&
      !s.anyOf &&
      s.type &&
      s.type === "object" &&
      (noTransformNonNullableResponseSchema ? !s.nullable : true)
    ) {
      s.additionalProperties = false;
    }
  });

  // a consumer may only use a subset of the provider *response* any field
  // marked as required in OAS, should be considered optional for pact testing
  traverse(schema, (s) => {
    if (s.oneOf) {
      return; // discriminator is required to be a valid schema
    }
    delete s.required;
  });

  return schema;
};
