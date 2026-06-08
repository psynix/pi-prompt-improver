import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands";

export default function responseImproverExtension(pi: ExtensionAPI) {
  registerCommands(pi);
}
