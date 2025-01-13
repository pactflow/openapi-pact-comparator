import { SchemaObject } from "ajv";
import { each } from "lodash-es";
import { traverse } from "./utils";

export const transformResponseSchema = (schema: SchemaObject): SchemaObject => {
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
      s.type === "object"
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
        delete ss.additionalProperties;
        if (ss.allOf) {
          // traversal is depth-first; if nested allOf, remove
          // unevaluatedProperties from previously set deeper schema
          delete ss.unevaluatedProperties;
        }
      });
      s.unevaluatedProperties = false;
    }
  });

  // draft-06 onwards converts exclusiveMinimum and exclusiveMaximum to numbers
  traverse(schema, (s) => {
    if (s.exclusiveMaximum) {
      s.exclusiveMaximum = s.maximum;
    }

    if (s.exclusiveMinimum) {
      s.exclusiveMinimum = s.minimum;
    }
  });

  return schema;
};
