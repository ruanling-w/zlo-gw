import "../../env/load-dotenv.js";
import { listenHermesBridge } from "./server.js";

const bridge = await listenHermesBridge();
console.log(`[zalo-hermes-bridge] listening on http://${bridge.config.host}:${bridge.config.port}`);

const shutdown = async () => {
  await new Promise<void>((resolve, reject) => {
    bridge.server.close((err) => err ? reject(err) : resolve());
  });
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
