import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import { SchemaObject } from "ajv";
import { cloneDeep, pick } from "lodash-es";
import { traverse } from "./utils";

export const optimiseSchema = (
  originalSchema: SchemaObject,
  components: OpenAPIV3.ComponentsObject,
  definitions: OpenAPIV2.DefinitionsObject,
): SchemaObject => {
  let schema = originalSchema;

  const usedReferences: string[] = [];
  const collectReferences = (s: SchemaObject) => {
    if (s.$ref && !usedReferences.includes(s.$ref)) {
      usedReferences.push(s.$ref);
    }
  };

  traverse(schema, collectReferences, false);
  if (usedReferences.length === 0) {
    // no external references, this is the common case for most inlined schemas
    return schema;
  }

  // at least one reference in root schema
  // inline only used referenced schemas from the root schema
  schema = cloneDeep(originalSchema);
  schema.components = cloneDeep(components);
  schema.definitions = cloneDeep(definitions);
  traverse(schema, collectReferences, true);

  if (schema.components) {
    schema.components.schemas = pick(
      schema.components.schemas,
      usedReferences.map((r) => r.replace("#/components/schemas/", "")),
    );
  }
  schema.definitions = pick(
    schema.definitions,
    usedReferences.map((r) => r.replace("#/definitions/", "")),
  );
  return schema;
};
