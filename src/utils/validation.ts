import Ajv, { AnySchema, ValidateFunction } from "ajv";

export const getValidateFunction = (
  ajv: Ajv,
  schemaId: string,
  create: () => AnySchema,
): ValidateFunction => {
  let validate = ajv.getSchema(schemaId);
  if (!validate) {
    ajv.addSchema(create(), schemaId);
    validate = ajv.getSchema(schemaId);
  }

  return validate as ValidateFunction;
};
