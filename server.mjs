import { createApp } from "./src/server.mjs";

const allowedOrigins = [
  ...(process.env.PUBLIC_ORIGINS || "").split(",").filter(Boolean),
  ...[process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter(Boolean).map((host) => `https://${host}`),
];
const app = await createApp({ dev: process.argv.includes("--dev"), allowedOrigins });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
app.server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
app.server.listen(port, host, () =>
  console.log(`FlowKit is ready at http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
