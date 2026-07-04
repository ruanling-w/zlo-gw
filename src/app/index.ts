import "../env/load-dotenv.js";
import { listenHermesBridge } from "../bridge/hermes/server.js";
import { listenGateway } from "../gateway/server.js";

const gateway = await listenGateway();
const bridge = await listenHermesBridge();

console.log(`[zalo-api-gateway] listening on http://${gateway.config.host}:${gateway.config.port}`);
console.log(`[zalo-hermes-bridge] listening on http://${bridge.config.host}:${bridge.config.port}`);

const shutdown = async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => gateway.server.close((err) => err ? reject(err) : resolve())),
    new Promise<void>((resolve, reject) => bridge.server.close((err) => err ? reject(err) : resolve())),
  ]);
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
