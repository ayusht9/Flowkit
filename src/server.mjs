import { createServer } from "node:http";
import { readFile, readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createWorkflowRegistry } from "./workflow.mjs";
import { validatePipeline, runPipeline } from "./pipeline.mjs";
import { catalog } from "./catalog.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const maxBodyBytes = 29 * 1024 * 1024;

export async function findPandoc() {
  if (process.env.PANDOC_PATH) return process.env.PANDOC_PATH;
  // shortcut: portable Windows install for local demos; deployments should configure PANDOC_PATH.
  try {
    const entries = await readdir(join(root, ".tools"), {
      withFileTypes: true,
    });
    for (const entry of entries
      .filter((item) => item.isDirectory() && item.name.startsWith("pandoc-"))
      .sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { numeric: true }),
      )) {
      const candidate = join(root, ".tools", entry.name, "pandoc.exe");
      try {
        await access(candidate);
        return candidate;
      } catch {
        /* Try the next installation. */
      }
    }
  } catch {
    /* Use PATH when no portable installation exists. */
  }
  return "pandoc";
}

async function readJson(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw Object.assign(new Error("Expected an application/json request."), {
      status: 415,
    });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes)
      throw Object.assign(new Error("Files must be 20 MiB or smaller."), {
        status: 413,
      });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON request."), { status: 400 });
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function compact(result) {
  const serialize = (output) => ["document", "image", "audio", "video"].includes(output?.type) ? {
    type: output.type, value: { ...output.value, data: Buffer.from(output.value.data).toString("base64") },
  } : output;
  return {
    ...result,
    output: serialize(result.output),
    nodes: result.nodes.map(({ output, ...state }) => ({
      ...state,
      ...(output?.type === "document"
        ? {
            output: {
              type: "document",
              value: {
                source: output.value.name,
                size: output.value.data.byteLength,
              },
            },
          }
        : ["image", "audio", "video"].includes(output?.type)
          ? { output: { type: output.type, value: { ...output.value, data: undefined, size: output.value.data.byteLength } } }
          : { output }),
    })),
  };
}

export async function createApp({ executable, imageExecutable, ffmpeg, ffprobe, dev = false, allowedOrigins = [] } = {}) {
  const origins = new Map();
  for (const value of allowedOrigins) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value || url.username || url.password)
      throw new TypeError("Deployment origins must be exact HTTP(S) origins without paths.");
    const entries = origins.get(url.host) || new Set();
    entries.add(url.origin);
    origins.set(url.host, entries);
  }
  const registry = createWorkflowRegistry({
    executable: executable || (await findPandoc()),
    imageExecutable,
    ffmpeg, ffprobe,
  });
  let busy = false;
  let vite;
  const server = createServer(async (request, response) => {
    const host = request.headers.host || "";
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const accepted = origins.get(host) || new Set();
    if (!local && !accepted.size)
      return json(response, 403, { error: "Host is not configured for this deployment." });
    if (request.headers.origin &&
        !(local && request.headers.origin === `http://${host}`) &&
        !accepted.has(request.headers.origin))
      return json(response, 403, {
        error: "Cross-origin requests are not allowed.",
      });
    const path = new URL(request.url, `http://${host}`).pathname;
    try {
      if (request.method === "GET" && path === "/api/health")
        return json(response, 200, { status: "ok" });
      if (request.method === "GET" && path === "/api/operations")
        return json(response, 200, { operations: catalog });
      if (request.method === "GET" && path === "/api/sample") {
        const data = await readFile(
          join(root, "examples/fixtures/sample.html"),
        );
        return json(response, 200, {
          name: "sample.html",
          data: data.toString("base64"),
          size: data.length,
        });
      }
      if (request.method === "POST" && path === "/api/run") {
        if (busy)
          return json(response, 429, {
            error: "Another workflow is running. Try again when it finishes.",
          });
        busy = true;
        const controller = new AbortController();
        response.on("close", () => controller.abort());
        try {
          const body = await readJson(request);
          if (
            !body?.pipeline ||
            !Array.isArray(body.pipeline.nodes) ||
            body.pipeline.nodes.length > 20 ||
            !Array.isArray(body.pipeline.edges) ||
            body.pipeline.edges.length > 20
          ) {
            throw new TypeError("Provide a workflow with 1–20 nodes.");
          }
          const ordered = validatePipeline(body.pipeline, registry);
          const roots = ordered.filter((node) => !body.pipeline.edges.some((edge) => edge.target === node.id));
          if (
            roots.some((node) => catalog.find((item) => item.type === node.type)?.group !== "Input") ||
            ordered.filter((node) => catalog.find((item) => item.type === node.type)?.group === "Input").length !== roots.length ||
            catalog.find((item) => item.type === ordered.at(-1).type)?.group !== "Output"
          ) {
            throw new TypeError(
              "Connect every upload node through a compatible workflow to one preview node.",
            );
          }
          const provided = body.inputs || (roots.length === 1 && body.input ? { [roots[0].id]: body.input } : null);
          if (!provided || typeof provided !== "object" || Array.isArray(provided) || Object.keys(provided).length !== roots.length)
            throw new TypeError("Upload one file for every Upload node.");
          const inputs = {};
          let totalBytes = 0;
          for (const root of roots) {
            const input = provided[root.id];
            if (!input || typeof input.name !== "string" || typeof input.data !== "string" || !input.data.length ||
                input.data.length > 28 * 1024 * 1024 || Buffer.from(input.data, "base64").toString("base64") !== input.data)
              throw new TypeError("Upload one valid file for every Upload node.");
            const value = { name: input.name, data: Buffer.from(input.data, "base64") };
            totalBytes += value.data.byteLength;
            registry.get(root.type).validateInput(value);
            inputs[root.id] = { type: registry.get(root.type).inputType, value };
          }
          if (totalBytes > 20 * 1024 * 1024) throw new TypeError("Uploaded files must total 20 MiB or less.");
          response.writeHead(200, {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          const send = (data) => {
            if (!response.destroyed)
              response.write(`${JSON.stringify(data)}\n`);
          };
          const result = await runPipeline(body.pipeline, registry, {
            inputs,
            signal: controller.signal,
            onEvent: send,
          });
          send({ type: "result", result: compact(result) });
          response.end();
        } finally {
          busy = false;
        }
        return;
      }
      if (path.startsWith("/api/"))
        return json(response, 404, { error: "Unknown endpoint." });
      if (vite) return vite.middlewares(request, response);
      if (request.method !== "GET" && request.method !== "HEAD")
        return json(response, 405, { error: "Method not allowed." });
      const dist = join(root, "dist");
      const file =
        path === "/"
          ? join(dist, "index.html")
          : resolve(dist, `.${decodeURIComponent(path)}`);
      if (!file.startsWith(`${dist}${sep}`))
        return json(response, 404, { error: "Not found." });
      const content = await readFile(file);
      const mime =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        }[extname(file)] || "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": mime,
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      json(response, error.status || (error.code === "ENOENT" ? 404 : 400), {
        error:
          error.code === "ENOENT"
            ? "File not found. Run npm run build before npm start."
            : error.message,
      });
    }
  });
  server.requestTimeout = 60_000;
  if (dev) {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      root,
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
  }
  return {
    server,
    close: async () => {
      await vite?.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
