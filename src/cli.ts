import fsPromises from "node:fs/promises";
import fs from "node:fs";
import yaml from "js-yaml";
import { Comparator } from "./compare";

const NEW_LINE = "\r\n";

const readAndParse = async (filename: string) => {
  const file = await fsPromises.readFile(filename, { encoding: "utf-8" });
  try {
    return JSON.parse(file);
  } catch {
    return yaml.load(file);
  }
};

async function run() {
  const oas = await readAndParse(process.argv[2]);

  const comparator = new Comparator(oas);
  await comparator.validate();

  for (const filename of process.argv.slice(3)) {
    const pact = await readAndParse(filename);
    const writer = fs.createWriteStream(`${filename}.results.ndjson`, {
      encoding: "utf-8",
    });
    for await (const result of comparator.compare(pact)) {
      writer.write(JSON.stringify(result));
      writer.write(NEW_LINE);
    }
    writer.end("");
  }
}

run();
