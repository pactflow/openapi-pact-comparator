import type Ajv from "ajv/dist/2019";
import type Router from "find-my-way";
import { get } from "lodash-es";
import querystring from "node:querystring";

import type { Interaction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import type { Config } from "#utils/config";
import { isValidRequest } from "#utils/interaction";

export function* compareReqSecurity(
  ajv: Ajv,
  route: Router.FindResult<Router.HTTPVersion.V1>,
  interaction: Interaction,
  index: number,
  config: Config,
): Iterable<Result> {
  const { method, operation, path, securitySchemes } = route.store;
  const requestHeaders = new Headers(
    interaction.request.headers as Record<string, string>,
  );
  const searchParams = querystring.parse(
    route.searchParams as unknown as string,
  );

  if (isValidRequest(interaction)) {
    let isSecured = false;
    const maybeResults: Result[] = [];
    for (const scheme of operation.security || []) {
      if (Object.keys(scheme).length === 0) {
        isSecured = true;
        break;
      }
      for (const schemeName of Object.keys(scheme)) {
        const scheme = securitySchemes[schemeName];
        switch (scheme?.type?.toLowerCase()) {
          case "apikey":
            switch (scheme.in.toLowerCase()) {
              case "header":
                if (requestHeaders.has(scheme.name)) {
                  isSecured = true;
                } else {
                  maybeResults.push({
                    code: "request.authorization.missing",
                    message:
                      "Request Authorization header is missing but is required by the spec file",
                    mockDetails: {
                      ...baseMockDetails(interaction),
                      location: `[root].interactions[${index}].request.headers`,
                      value: get(interaction, "request.headers"),
                    },
                    specDetails: {
                      location: `[root].paths.${path}.${method}`,
                      pathMethod: method,
                      pathName: path,
                      value: operation,
                    },
                    type: "error",
                  });
                }
                requestHeaders.delete(scheme.name);
                break;
              case "query":
                if (searchParams[scheme.name] !== undefined) {
                  isSecured = true;
                } else {
                  maybeResults.push({
                    code: "request.authorization.missing",
                    message:
                      "Request Authorization query is missing but is required by the spec file",
                    mockDetails: {
                      ...baseMockDetails(interaction),
                      location: `[root].interactions[${index}].request.query`,
                      value: get(interaction, "request.query"),
                    },
                    specDetails: {
                      location: `[root].paths.${path}.${method}`,
                      pathMethod: method,
                      pathName: path,
                      value: operation,
                    },
                    type: "error",
                  });
                }
                break;
              case "cookie":
                // FIXME: validate auth cookie
                // needs to be behind quirk mode
                // because SMV passes this without checking
                isSecured = true;
                break;
            }
            break;
          case "basic": {
            const auth = requestHeaders.get("authorization") || "";
            let isValidSchema;
            if (config.get("no-authorization-schema")) {
              isValidSchema = requestHeaders.get("authorization") !== null;
            } else {
              isValidSchema = auth.toLowerCase().startsWith("basic ");
            }

            if (isValidSchema) {
              isSecured = true;
            } else {
              maybeResults.push({
                code: "request.authorization.missing",
                message:
                  "Request Authorization header is missing but is required by the spec file",
                mockDetails: {
                  ...baseMockDetails(interaction),
                  location: `[root].interactions[${index}].request.headers`,
                  value: get(interaction, "request.headers"),
                },
                specDetails: {
                  location: `[root].paths.${path}.${method}`,
                  pathMethod: method,
                  pathName: path,
                  value: operation,
                },
                type: "error",
              });
            }
            break;
          }
          case "http": {
            const auth = requestHeaders.get("authorization") || "";
            let isValidSchema = false;
            if (config.get("no-authorization-schema")) {
              isValidSchema = requestHeaders.get("authorization") !== null;
            } else {
              switch (scheme.scheme.toLowerCase()) {
                case "basic":
                  isValidSchema = auth.toLowerCase().startsWith("basic ");
                  break;
                case "bearer":
                  isValidSchema = auth.toLowerCase().startsWith("bearer ");
                  break;
              }
            }

            if (isValidSchema) {
              isSecured = true;
            } else {
              maybeResults.push({
                code: "request.authorization.missing",
                message:
                  "Request Authorization header is missing but is required by the spec file",
                mockDetails: {
                  ...baseMockDetails(interaction),
                  location: `[root].interactions[${index}].request.headers`,
                  value: get(interaction, "request.headers"),
                },
                specDetails: {
                  location: `[root].paths.${path}.${method}`,
                  pathMethod: method,
                  pathName: path,
                  value: operation,
                },
                type: "error",
              });
            }
            break;
          }
          case "mutualtls":
          case "oauth2":
          case "openidconnect":
            // nothing can be validated, assume meets security requirements
            isSecured = true;
            break;
        }
      }
    }

    if (!isSecured) {
      yield* maybeResults;
    }
  }
}
