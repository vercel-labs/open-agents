import { createCodePlugin } from "@streamdown/code";
import { vercelLight, vercelDark } from "./vercel-themes";

export const streamdownPlugins = {
  code: createCodePlugin({
    themes: [vercelLight, vercelDark],
  }),
};
