import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// A digest-only FROM lets Vercel run the image tested by CI without rebuilding the app.
const image = process.env.IMAGE_REF || "";
if (!/^docker\.io\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_.-]*@sha256:[a-f0-9]{64}$/.test(image))
  throw new Error("IMAGE_REF must be a Docker Hub repository pinned to a sha256 digest.");
const directory = resolve(".deployment");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "Dockerfile.vercel"), `FROM ${image}\n`);
await writeFile(resolve(directory, "vercel.json"), JSON.stringify({
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: "container",
}));
console.log(`Prepared deployment for ${image}`);
