---
"@pactflow/openapi-pact-comparator": minor
---

Add GraphQL support. A GraphQL schema (SDL) can now be used as the provider
contract via the `graphql` option or the `--graphql` CLI flag. Queries,
mutations and subscription messages are compared against the schema: the
consumer's operation must be valid against it, and the recorded response must
contain nothing the provider could not return, while remaining free to select
and record fewer fields.
