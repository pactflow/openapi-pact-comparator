import Router, { type HTTPMethod } from "find-my-way";
import { uniqWith } from "lodash-es";
import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";

import type { Config } from "#utils/config";
import { dereferenceOas } from "#utils/schema";

import { cleanPathParameter } from "./utils/parameters";

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

interface ExtendedOpenAPIV3InfoObject extends OpenAPIV3.InfoObject {
  "x-opc-config-base-path"?: string;
}

type OasRouter = Router.Instance<Router.HTTPVersion.V1>;
type RouteStore = Router.FindResult<Router.HTTPVersion.V1>["store"];

interface RegisteredRoute {
  path: string;
  prefix: string;
  router?: OasRouter;
  store: RouteStore;
}

interface RouteRegistry {
  createRouter: () => OasRouter;
  normalisePath: (path: string) => string;
  routes: Map<string, RegisteredRoute[]>;
}

const registries = new WeakMap<OasRouter, RouteRegistry>();

export function setupRouter(
  oas: OpenAPIV2.Document | OpenAPIV3.Document,
  config: Config,
): OasRouter {
  const createRouter = () =>
    Router({
      caseSensitive: !config.get("case-insensitive"),
      ignoreDuplicateSlashes: config.get("ignore-duplicate-slashes"),
      ignoreTrailingSlash: config.get("ignore-trailing-slash"),
      maxParamLength: 2048, // default = 100
      querystringParser: (s: string): string => s, // don't parse query in router
    });
  // the same steps, in the same order, that the router applies to paths and URLs
  const normalisePath = (path: string) => {
    let normalised = path;
    if (config.get("ignore-duplicate-slashes")) {
      normalised = Router.removeDuplicateSlashes(normalised);
    }
    if (config.get("ignore-trailing-slash")) {
      normalised = Router.trimLastSlash(normalised);
    }
    return config.get("case-insensitive")
      ? normalised.toLowerCase()
      : normalised;
  };
  const router = createRouter();
  const routes: RouteRegistry["routes"] = new Map();
  registries.set(router, { createRouter, normalisePath, routes });
  for (const oasPath in oas.paths) {
    // NB: all path parameters are required in OAS
    const basePath =
      (oas.info as ExtendedOpenAPIV3InfoObject)["x-opc-config-base-path"] ||
      (oas as OpenAPIV2.Document).basePath ||
      "";
    const path =
      basePath +
      oasPath
        .replaceAll(":", "::")
        .replaceAll(/{.*?}/g, cleanPathParameter)
        .replaceAll(/{([.;]?)([^*]+?)\*?}/g, "$1:$2(.+)");
    for (const method in oas.paths[oasPath]) {
      if (!SUPPORTED_METHODS.includes(method.toUpperCase())) {
        continue;
      }
      const operation = (oas.paths[oasPath] as OpenAPIV3.PathItemObject)[
        method as OpenAPIV3.HttpMethods
      ] as OpenAPIV3.OperationObject;
      const parameters = uniqWith(
        [
          ...(operation.parameters || []),
          ...(oas.paths[oasPath].parameters || []),
        ].map((p) =>
          dereferenceOas(p, oas as OpenAPIV3.Document),
        ) as OpenAPIV3.ParameterObject[],
        (a, b) => `${a.name}${a.in}` === `${b.name}${b.in}`,
      );
      if (parameters.length) {
        operation.parameters = parameters;
      }
      (operation as OpenAPIV2.OperationObject).consumes ||= (
        oas as OpenAPIV2.Document
      ).consumes;
      (operation as OpenAPIV2.OperationObject).produces ||= (
        oas as OpenAPIV2.Document
      ).produces;
      operation.security ||= oas.security;
      const routerMethod = method.toUpperCase() as HTTPMethod;
      const routerPath = path.replaceAll(/\*+/g, "*");
      const store = {
        method,
        oas,
        operation,
        path: oasPath,
        securitySchemes:
          (oas as OpenAPIV2.Document).securityDefinitions ||
          (oas as OpenAPIV3.Document).components?.securitySchemes ||
          {},
      };
      router.on(routerMethod, routerPath, () => {}, store);
      if (!routes.has(routerMethod)) {
        routes.set(routerMethod, []);
      }
      routes.get(routerMethod)!.push({
        path: routerPath,
        prefix: normalisePath(routerPath).split(/[:*]/, 1)[0],
        store,
      });
    }
  }
  return router;
}

/**
 * Finds every route other than `excluded` that the URL fits structurally.
 *
 * The router resolves a URL to its single most specific route, so seeing the
 * rest takes one single-route router per route. Only a path parameter failure
 * reaches this code, and a route gets its router the first time a URL shares
 * its literal prefix. The router decodes a percent-encoded path before matching,
 * so such a URL can't be compared to a prefix and every route is checked.
 */
export function findOtherRoutes(
  router: OasRouter,
  method: HTTPMethod,
  url: string,
  excluded: RouteStore,
): Router.FindResult<Router.HTTPVersion.V1>[] {
  const registry = registries.get(router)!;
  const urlPath = url.split(/[?#]/, 1)[0];
  const literalPath = urlPath.includes("%")
    ? undefined
    : registry.normalisePath(urlPath);
  const results: Router.FindResult<Router.HTTPVersion.V1>[] = [];
  for (const route of registry.routes.get(method) || []) {
    if (
      route.store === excluded ||
      (literalPath !== undefined && !literalPath.startsWith(route.prefix))
    ) {
      continue;
    }
    if (!route.router) {
      route.router = registry.createRouter();
      route.router.on(method, route.path, () => {}, route.store);
    }
    const result = route.router.find(method, url);
    if (result) {
      results.push(result);
    }
  }
  return results;
}
