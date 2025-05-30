import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";

const isSwagger2 = (oas: OpenAPIV2.Document): boolean =>
  Object.prototype.hasOwnProperty.call(oas, "swagger") &&
  typeof oas.swagger === "string" &&
  oas.swagger === "2.0";

const isOpenApi3 = (oas: OpenAPIV3.Document): boolean =>
  Object.prototype.hasOwnProperty.call(oas, "openapi") &&
  typeof oas.openapi === "string" &&
  oas.openapi.indexOf("3.") === 0;

export const parse = (oas: OpenAPIV2.Document | OpenAPIV3.Document): void => {
  if (
    !isSwagger2(oas as OpenAPIV2.Document) &&
    !isOpenApi3(oas as OpenAPIV3.Document)
  ) {
    throw new ParserError();
  }

  // FIXME: ideally, we validate the document here
};

export class ParserError extends Error {
  constructor() {
    super("Malformed OpenAPI file");
  }
}
