import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page reads live ledger data, so no page cache is configured.
export default defineCloudflareConfig({});
