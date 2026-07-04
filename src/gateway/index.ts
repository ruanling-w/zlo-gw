import "../env/load-dotenv.js";
import { listenGateway } from "./server.js";

const gateway = await listenGateway();

console.log(`[zalo-api-gateway] listening on http://${gateway.config.host}:${gateway.config.port}`);

const shutdown = async () => {
  await new Promise<void>((resolve, reject) => {
    gateway.server.close((err) => err ? reject(err) : resolve());
  });
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
