import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const component = await readFile(
  new URL("../app/components/PersonalWorkOS.tsx", import.meta.url),
  "utf8",
);
const vercelConfig = JSON.parse(
  await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
);

test("uses the standard Next.js build expected by Vercel", () => {
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(vercelConfig.framework, "nextjs");
});

test("does not depend on the ChatGPT Sites runtime", () => {
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  assert.equal(allDependencies.vinext, undefined);
  assert.equal(allDependencies.wrangler, undefined);
  assert.equal(allDependencies["@cloudflare/vite-plugin"], undefined);
});

test("keeps tasks in browser storage without deployment secrets", () => {
  assert.match(component, /window\.localStorage/);
  assert.doesNotMatch(component, /process\.env/);
});
