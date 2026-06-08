import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands";
import { loadConfig } from "./config";

export default function responseImproverExtension(pi: ExtensionAPI) {
  // Validate config at session start so config issues surface early,
  // before the user types /improve for the first time.
  pi.on("session_start", async (_event, ctx) => {
    const { warnings } = await loadConfig();
    for (const warning of warnings) ctx.ui.notify(warning, "warning");
  });

  registerCommands(pi);
}
