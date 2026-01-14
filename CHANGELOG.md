# @pactflow/openapi-pact-comparator

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
