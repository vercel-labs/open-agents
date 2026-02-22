import { createCodePlugin } from "@streamdown/code";
import { vercelDark, vercelLight } from "./vercel-themes";

export const streamdownPlugins = {
  code: createCodePlugin({
    themes: [vercelLight, vercelDark],
  }),
};
