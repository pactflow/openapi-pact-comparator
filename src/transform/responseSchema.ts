import { SchemaObject } from "ajv";
import { each, get } from "lodash-es";
import {
  splitPath,
  traverseWithDereferencing as traverse,
} from "#utils/schema";

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

  // OpenAPI defines allOf to mean the union of all sub-schemas. JSON-Schema
  // defines allOf to mean that *every* sub-schema needs to be satisfied. In
  // draft 2019-09, JSON-Schema added "unevaluatedProperties" to support this
  // behaviour
  traverse(schema, (s) => {
    if (s.allOf) {
      each(s.allOf, (ss) => {
        let subschema = ss;
        if (subschema.$ref) {
          subschema = get(schema, splitPath(subschema.$ref));
        }
        delete subschema.additionalProperties;
        if (subschema.allOf) {
          // traversal is depth-first; if nested allOf, remove
          // unevaluatedProperties from previously set deeper schema
          delete subschema.unevaluatedProperties;
        }
      });
      s.unevaluatedProperties = false;
    }
  });

  return schema;
};
