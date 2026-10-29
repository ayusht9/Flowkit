import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/stage-deployment.mjs", import.meta.url));
test("deployment pins an exact image digest and refuses tags or Dockerfile injection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flowkit-deployment-"));
  try {
    const image = `docker.io/flowkit/flowkit@sha256:${"a".repeat(64)}`;
    await execute(process.execPath, [script], {
      cwd, env: { ...process.env, IMAGE_REF: image },
    });
    assert.equal(await readFile(join(cwd, ".deployment/Dockerfile.vercel"), "utf8"), `FROM ${image}\n`);
    assert.equal(JSON.parse(await readFile(join(cwd, ".deployment/vercel.json"), "utf8")).framework, "container");
    for (const value of ["docker.io/flowkit/flowkit:latest", `${image}\nRUN echo bad`, ""]) {
      await assert.rejects(execute(process.execPath, [script], {
        cwd, env: { ...process.env, IMAGE_REF: value },
      }));
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
