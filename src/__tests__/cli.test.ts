import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixturesDir = path.join(__dirname, "fixtures");
const cliPath = path.join(__dirname, "..", "cli.ts");
const tsxCli = require.resolve("tsx/cli");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const filePath = path.join(fixturesDir, req.url!);
    try {
      const content = readFileSync(filePath);
      res.writeHead(200);
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => server.close());

const runCli = (
  oasPath: string,
  pactPath: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [tsxCli, cliPath, oasPath, pactPath],
      {
        cwd: fixturesDir,
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 0, stdout, stderr });
    });
  });
};

describe("CLI integration", () => {
  it("should exit with code 0 when no errors are found", async () => {
    const { exitCode, stdout } = await runCli(
      path.join("example-petstore-valid", "oas.yaml"),
      path.join("example-petstore-valid", "pact.json"),
    );

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("[]");
  });

  it("should exit with non-zero code when errors are found", async () => {
    const { exitCode, stdout } = await runCli(
      path.join("example-petstore-invalid", "oas.yaml"),
      path.join("example-petstore-invalid", "pact.json"),
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain('"type":"error"');
    expect(stdout).toContain('"code":"response.status.unknown"');
  });

  it("should fetch OAS and Pact from URLs", async () => {
    const oasUrl = `${baseUrl}/example-petstore-valid/oas.yaml`;
    const pactUrl = `${baseUrl}/example-petstore-valid/pact.json`;

    const { exitCode, stdout } = await runCli(oasUrl, pactUrl);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("[]");
  });
});
