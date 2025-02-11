import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import Ajv, { Options } from "ajv/dist/2019.js";
import addFormats from "ajv-formats";
import Router, { HTTPMethod } from "find-my-way";
import { cleanPathParameter } from "./utils/parameters";

export function setupAjv(options: Options): Ajv {
  const ajv = new Ajv(options);
  addFormats(ajv);
  ajv.addKeyword({
    keyword: "collectionFormat",
    type: "array",
  });

  return ajv;
}
const SUPPORTED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
];

export function setupRouter(
  oas: OpenAPIV2.Document | OpenAPIV3.Document,
): Router.Instance<Router.HTTPVersion.V1> {
  const router = Router({
    ignoreTrailingSlash: true,
    querystringParser: (s: string): string => s, // don't parse query in router
  });
  for (const oasPath in oas.paths) {
    // NB: all path parameters are required in OAS
    const path =
      ((oas as OpenAPIV2.Document).basePath || "") +
      oasPath
        .replaceAll(/{.*?}/g, cleanPathParameter)
        .replaceAll(/{([.;]?)([^*]+?)\*?}/g, "$1:$2");
    for (const method in oas.paths[oasPath]) {
      if (!SUPPORTED_METHODS.includes(method.toUpperCase())) {
        continue;
      }
      const operation = (oas.paths[oasPath] as OpenAPIV3.PathItemObject)[
        method as OpenAPIV3.HttpMethods
      ] as OpenAPIV3.OperationObject;
      operation.security ||= oas.security;
      operation.parameters = [
        ...(operation.parameters || []),
        ...(oas.paths[oasPath].parameters || []),
      ];
      router.on(method.toUpperCase() as HTTPMethod, path, () => {}, {
        method,
        oas,
        operation,
        path: oasPath,
        securitySchemes:
          (oas as OpenAPIV2.Document).securityDefinitions ||
          (oas as OpenAPIV3.Document).components?.securitySchemes ||
          {},
      });
    }
  }
  return router;
}
