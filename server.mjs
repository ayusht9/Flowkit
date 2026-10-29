import { createApp } from "./src/server.mjs";

const app = await createApp({ dev: process.argv.includes("--dev") });
const port = Number(process.env.PORT || 3000);
app.server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
app.server.listen(port, "127.0.0.1", () =>
  console.log(`FlowKit is ready at http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
