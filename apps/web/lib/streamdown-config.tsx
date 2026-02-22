import { createCodePlugin } from "@streamdown/code";
import { vercelDark } from "./vercel-themes";

export const streamdownPlugins = {
  code: createCodePlugin({
    themes: [vercelDark, vercelDark],
  }),
};
