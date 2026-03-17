import { defineConfig } from "tsdown";

export default defineConfig({
	entry: { index: "src/index.ts", register: "src/register.ts" },
	format: ["esm"],
	outDir: "dist",
	clean: true,
	dts: true,
	platform: "node",
});
