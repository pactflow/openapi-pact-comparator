import type { OpenAPIV3 } from "openapi-types";
import { SchemaObject } from "ajv";
import { cloneDeep, get, set } from "lodash-es";
import { dereferenceOas, splitPath, traverse } from "#utils/schema";

// draft-06 onwards converts exclusiveMinimum and exclusiveMaximum to numbers
const convertExclusiveMinMax = (s: SchemaObject) => {
  if (s.exclusiveMaximum === true) {
    s.exclusiveMaximum = s.maximum;
    delete s.maximum;
  }

  if (s.exclusiveMaximum === false) {
    delete s.exclusiveMaximum;
  }

  if (s.exclusiveMinimum === true) {
    s.exclusiveMinimum = s.minimum;
    delete s.minimum;
  }

  if (s.exclusiveMinimum === false) {
    delete s.exclusiveMinimum;
  }
};

const cleanupDiscriminators = (s: SchemaObject) => {
  // no-op from a validation perspective
  if (s.discriminator?.mapping) {
    delete s.discriminator.mapping;
  }

  if (s.discriminator && !s.oneOf) {
    delete s.discriminator;
  }
}

export const minimumSchema = (
  originalSchema: SchemaObject,
  oas: OpenAPIV3.Document,
): SchemaObject => {
  const refToAdd: string[] = [];
  const refAdded: string[] = [];

  const collectReferences = (s: SchemaObject) => {
    if (s.$ref && !refToAdd.includes(s.$ref) && !refAdded.includes(s.$ref)) {
      refToAdd.push(s.$ref);
    }
  };

  const handleNullableSchema = (s: SchemaObject) => {
    if (s.$ref) {
      if (s.nullable && !s.type) {
        s.type = dereferenceOas(s, oas).type;
      }
      return;
    }

    if (s.nullable && !s.type) {
      s.type = "object";
    }

    if (s.nullable && !Array.isArray(s.type)) {
      s.type = [s.type, "null"];
    }
  };

  const schema = cloneDeep(originalSchema);
  delete schema.description;
  delete schema.example;
  traverse(schema, cleanupDiscriminators);
  traverse(schema, collectReferences);
  traverse(schema, handleNullableSchema);
  traverse(schema, convertExclusiveMinMax);

  while (refToAdd.length) {
    const ref = refToAdd.shift() as string;
    const path = splitPath(ref);
    refAdded.push(ref);

    const subschema = cloneDeep(get(oas, path, {}));
    delete subschema.description;
    delete subschema.example;
    traverse(subschema, collectReferences);
    traverse(subschema, handleNullableSchema);
    traverse(subschema, convertExclusiveMinMax);

    set(schema, path, subschema);
  }

  return schema;
};
