---
"@pactflow/openapi-pact-comparator": minor
---

Emit `request.body.unvalidatable`, `response.body.unvalidatable`, and `message.payload.unvalidatable` warnings when a Pact interaction includes a body with a content type that OPC cannot introspect (e.g. `application/xml`, `image/png`, `application/protobuf`). Previously these bodies were silently skipped, making it impossible to distinguish "validated and passed" from "not validated at all". When no body is present, behaviour is unchanged.
