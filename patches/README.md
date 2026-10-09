Contains patches from:
https://github.com/vwong/ajv/tree/fix/coerce-whitespace-strings ->
https://github.com/ajv-validator/ajv/pull/2297
https://github.com/vwong/ajv/tree/feat/support-discriminator-mapping

It looks like AJV is basically abandoned, so we have to patch them locally.

avro-js: removes the undeclared `underscore` dependency (the package fails to
load without it), from https://github.com/apache/avro/pull/3974 (AVRO-4350).
Drop this patch once that is released.
