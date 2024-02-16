type ErrorCode =
  | "request.accept.incompatible"
  | "request.authorization.missing"
  | "request.body.incompatible"
  | "request.content-type.incompatible"
  | "request.header.incompatible"
  | "request.path-or-method.unknown"
  | "request.query.incompatible"
  | "response.body.incompatible"
  | "response.body.unknown"
  | "response.content-type.incompatible"
  | "response.header.incompatible"
  | "response.header.unknown"
  | "response.status.unknown";

type WarningCode =
  | "pact-broker.no-pacts-found"
  | "request.accept.unknown"
  | "request.body.unknown"
  | "request.content-type.missing"
  | "request.content-type.unknown"
  | "request.header.unknown"
  | "request.query.unknown"
  | "response.content-type.unknown"
  | "response.header.undefined"
  | "response.status.default";

export interface Result {
  code: ErrorCode | WarningCode;
  message: string;
  mockDetails?: {
    interactionDescription: string | null;
    interactionState: string | null;
    location: string;
    mockFile?: string;
    value: any;
  };
  source: "spec-mock-validation";
  specDetails?: {
    location: string;
    pathMethod: string | null;
    pathName: string | null;
    specFile?: string;
    value: any;
  };
  type: "error" | "warning";
}
