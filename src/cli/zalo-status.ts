import "../env/load-dotenv.js";
import { getCredentialsPath, getGatewayDataDir } from "../client/credentials.js";
import { getCurrentUid, hasStoredCredentials, isAuthenticated, loginWithCredentials } from "../client/zalo-client.js";

async function main(): Promise<void> {
  const status = {
    hasStoredCredentials: hasStoredCredentials(),
    authenticated: isAuthenticated(),
    currentUid: getCurrentUid(),
    dataDir: getGatewayDataDir(),
    credentialsPath: getCredentialsPath(),
  };

  if (!status.hasStoredCredentials) {
    console.log(JSON.stringify({ ...status, status: "missing_credentials" }, null, 2));
    process.exitCode = 1;
    return;
  }

  try {
    const api = await loginWithCredentials();
    const account = await api.fetchAccountInfo().catch(() => undefined);
    console.log(JSON.stringify({
      hasStoredCredentials: true,
      authenticated: true,
      currentUid: getCurrentUid(),
      dataDir: getGatewayDataDir(),
      credentialsPath: getCredentialsPath(),
      status: "connected",
      account,
    }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({
      ...status,
      status: "invalid_credentials",
      error: err instanceof Error ? err.message : String(err),
    }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[zalo-api-gateway] Status check failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
