import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

const fixturesDir = path.join(__dirname, "fixtures");
const cliPath = path.join(__dirname, "..", "cli.ts");
const tsxCli = require.resolve("tsx/cli");

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
});
