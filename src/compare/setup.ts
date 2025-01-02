import type { OpenAPIV3 } from "openapi-types";
import Ajv from "ajv/dist/2019";
import addFormats from "ajv-formats";
import Router, { HTTPMethod } from "find-my-way";
import qs from "qs";

export function setupAjv(): Ajv {
  const ajv = new Ajv({
    allErrors: true,
    coerceTypes: true,
    discriminator: true,
    logger: false,
    strictSchema: false,
  });
  addFormats(ajv);
  ajv.addKeyword({
    keyword: "collectionFormat",
    type: "array",
  });

  return ajv;
}

export function setupRouter(
  oas: OpenAPIV3.Document,
): Router.Instance<Router.HTTPVersion.V1> {
  const router = Router({
    ignoreTrailingSlash: true,
    querystringParser: (str: string): unknown => qs.parse(str, { comma: true }),
  });
  for (const oasPath in oas.paths) {
    const path = oasPath.replaceAll(/{(.*?)\}/g, ":$1");
    for (const method in oas.paths[oasPath]) {
      const operation = oas.paths[oasPath][method];
      operation.parameters ||= [];
      router.on(method.toUpperCase() as HTTPMethod, path, () => {}, {
        components: oas.components,
        method,
        operation,
        path: oasPath,
        securitySchemes: oas.components?.securitySchemes || {},
      });
    }
  }
  return router;
}
