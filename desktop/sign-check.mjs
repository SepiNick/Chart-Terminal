// Runs before the signed Windows build: stops early, with the fix, when no signing certificate is configured.
// electron-builder signs on its own when CSC_LINK (or WIN_CSC_LINK) is set; Azure Trusted Signing is the other supported route.
const env = process.env;
const pfx = (env.WIN_CSC_LINK || env.CSC_LINK) && (env.WIN_CSC_KEY_PASSWORD || env.CSC_KEY_PASSWORD);
const azure = env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET;
if (!pfx && !azure) {
  console.error(`No signing certificate configured. Set one of:
  CSC_LINK=<path or https URL of your .pfx>  and  CSC_KEY_PASSWORD=<its password>
  AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (Azure Trusted Signing; add win.azureSignOptions to package.json)
See desktop/SIGNING.md.`);
  process.exit(1);
}
