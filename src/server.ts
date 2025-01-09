import http from "node:http";
import yaml from "js-yaml";
import { compare } from "./compare";

const PORT = process.env.PORT || 3000;

const parse = (spec: string) => {
  try {
    return JSON.parse(spec);
  } catch {
    return yaml.load(spec);
  }
};

const server = http.createServer((request, response) => {
  const buffer = [];

  response.setHeader("Content-Type", "application/x-ndjson; charset=UTF-8");
  response.setHeader("Transfer-Encoding", "chunked");
  request
    .on("data", (chunk) => {
      buffer.push(chunk);
    })
    .on("end", async () => {
      const files = Buffer.concat(buffer)
        .toString("binary")
        .split(/------.*/)
        .filter((part) => !!~part.indexOf("form-data;"))
        .map((part) => {
          const [name, filename] = part
            .match(/"(.*?)"/g)
            .map((name) => name.replace(/\"/g, ""));
          const data = part
            .split("\r\n\r\n")
            .slice(1)
            .join("\r\n\r\n")
            .slice(0, -2);

          return { name, filename, data };
        })
        .filter((f) => f.data);

        const oas = files.find(f => f.name === "oas");
        const pact = files.find(f => f.name === "pact");

      for await (const result of compare(parse(oas.data), parse(pact.data))) {
        response.write(JSON.stringify(result));
      }
      response.end();
    });
});

server.listen(PORT);
