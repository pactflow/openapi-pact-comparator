---
"@pactflow/openapi-pact-comparator": minor
---

Match V4 interaction types exactly, as pact_models does. An interaction whose
type differs from `Synchronous/HTTP`, `Asynchronous/Messages` or
`Synchronous/Messages` only in case is now skipped, like any unknown type. It
was previously compared. A malformed interaction of that kind no longer fails
the whole pact with a parser error, because it is no longer validated.
