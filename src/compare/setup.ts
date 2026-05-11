import Ajv, { type Options } from "ajv/dist/2019.js";
import addFormats from "ajv-formats";

export function setupAjv(options: Options): Ajv {
  const ajv = new Ajv(options);
  addFormats(ajv);
  ajv.addKeyword({
    keyword: "collectionFormat",
    type: "array",
  });

  return ajv;
}
