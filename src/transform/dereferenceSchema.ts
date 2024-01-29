import type { OpenAPI } from "openapi-types";
import SwaggerParser from "@apidevtools/swagger-parser";

export const dereferenceSchema = (
  document: OpenAPI.Document,
): Promise<OpenAPI.Document> => {
  return SwaggerParser.validate(document, {
    dereference: {
      circular: "ignore",
    },
  });
};
