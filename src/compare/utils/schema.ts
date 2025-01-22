import type { OpenAPIV3 } from "openapi-types";
import type { SchemaObject } from "ajv";
import { get } from "lodash-es";

export const dereferenceOas = (
  schema: SchemaObject,
  oas: OpenAPIV3.Document,
) =>
  schema.$ref ? get(oas, schema.$ref.replace(/\//g, ".").substring(2)) : schema;
