import { createApp } from "./src/server.mjs";

const app = await createApp({ dev: process.argv.includes("--dev") });
app.server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
app.server.listen(3000, "127.0.0.1", () =>
  console.log("FlowKit is ready at http://127.0.0.1:3000"),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
