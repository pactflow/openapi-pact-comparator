# @pactflow/openapi-pact-comparator

## 2.0.0

### Major Changes

- d359c1a: Add AsyncAPI 3.x support for async and synchronous message contract testing

  ## Breaking Changes
  - **`Comparator` constructor** — previously accepted a single positional OAS document argument (`new Comparator(oas)`); now accepts an options object (`new Comparator({ oas?, asyncapi? })`). At least one of `oas` or `asyncapi` must be provided.
  - **CLI** — the OAS file path was previously a required positional argument (`opc <oas> <pact...>`); it is now a named option (`opc --oas <path> <pact...>`). Use `--asyncapi <path>` instead of or alongside `--oas` to pass an AsyncAPI document.

  ## New Features
  - **`Asynchronous/Messages`** — validates async Pact v4 interactions against the corresponding AsyncAPI 3.x operation, checking payload and headers against all messages defined on that operation.
  - **`Synchronous/Messages`** — validates synchronous (request + response) Pact v4 interactions. The request is validated against the operation's messages; the response is validated against the messages defined in `operation.reply`.
  - Both interaction types use `operationId` only for matching — a message is considered matched if the interaction payload and headers are compatible with _any_ message defined on the operation; no `messageId` is needed in the pact file.
  - Full `$ref` resolution for message payload and header schemas, including `components/schemas` and `components/messages`.

  ## New Result Codes

  | Code                       | Type    | Description                                                                    |
  | -------------------------- | ------- | ------------------------------------------------------------------------------ |
  | `message.matched`          | info    | The interaction matched a message in the spec                                  |
  | `message.no.match`         | error   | No message in the operation matched the interaction, with per-candidate causes |
  | `message.reply.missing`    | error   | The referenced operation has no `reply` field (sync interactions only)         |
  | `message.response.missing` | warning | A sync interaction defines no responses to validate                            |

### Minor Changes

- 2e05886: Internally mutate schema to make working with oneOf/discriminator more consistent with OpenAPI

## 1.15.0

### Minor Changes

- 19f19cc: Dereference schemas when merging/flattening allOf

## 1.14.0

### Minor Changes

- cbfce24: Downgrade `request.body.unknown` from `error` to `warning`

## 1.13.1

### Patch Changes

- 5aa22db: Bump package due to AJV CVE https://github.com/advisories/GHSA-2g4f-4pwh-qvx6

## 1.13.0

### Minor Changes

- d1b0aac: Support Pact-V3 without any interactions

## 1.12.1

### Patch Changes

- e7e7333: Fix bin path in package.json

## 1.12.0

### Minor Changes

- e9b06dc: Support URLs for OAS and Pact file arguments
  - CLI now accepts http:// and https:// URLs for both OAS and Pact files
  - Fixed exit code overflow by capping at 255

### Patch Changes

- 1385c14: Export Results interface

## 1.11.0

### Minor Changes

- dce7a82: Optionally allow case-insensitive path matching

### Patch Changes

- d6e9e91: Resolve $ref before comparing response body.

## 1.10.0

### Minor Changes

- 33920bb: Support colons in path

## 1.9.0

### Minor Changes

- 94fc70f: Remove warnings about unsupported interaction types

## 1.8.1

### Patch Changes

- ef22f35: Add mockDetails location to non-HTTP interactions/messages

## 1.8.0

### Minor Changes

- 1d35775: Throws warning when pact contains non-http interactions

## 1.7.1

### Patch Changes

- bfbd1da: Preserve indexes of http/synchronous interactions

## 1.7.0

### Minor Changes

- 5954df0: Mutate schema to properly support OAD allOf

### Patch Changes

- aa0e0a6: Remove discriminator.mapping (again)

## 1.6.1

### Patch Changes

- 34fd8ca: Recursively cleanup discriminators

## 1.6.0

### Minor Changes

- ecd0fe6: Tolerate schemas with discriminators but missing oneOf
- 0f03c0f: Support patterned response status codes

## 1.5.1

### Patch Changes

- dd96925: Gracefully handle bad schema references
- 56d13d1: Handle security schemes case insensitively

## 1.5.0

### Minor Changes

- 33b94e4: Ignore discriminator.mapping in comparison

## 1.4.0

### Minor Changes

- d47416d: Add CLI tool

## 1.3.0

### Minor Changes

- d081434: Remove swagger-parser validation as it is very slow

## 1.2.0

### Minor Changes

- 17103d0: Handle URI encoding in OAS references

## 1.1.0

### Minor Changes

- f502e8e: Support customisable basePath in OAS3

## 1.0.0

### Major Changes

- 6e77564: Release v1

## 0.0.2

### Patch Changes

- b433af8: Remove patch-package from postinstall
