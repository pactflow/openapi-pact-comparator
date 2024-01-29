import { SchemaObject } from "ajv";
import { cloneDeep, each } from "lodash-es";
import { traverse } from "./utils";

export const transformRequestSchema = (
  originalSchema: SchemaObject,
): SchemaObject => {
  const schema = cloneDeep(originalSchema);

  // OpenAPI defines allOf to mean the union of all sub-schemas. JSON-Schema
  // defines allOf to mean that *every* sub-schema needs to be satisfied. In
  // draft 2019-09, JSON-Schema added "unevaluatedProperties" to support this
  // behaviour
  traverse(schema, (s) => {
    if (s.allOf) {
      each(s.allOf, (ss) => {
        delete ss.additionalProperties;
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
