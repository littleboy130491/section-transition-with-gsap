import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const order = [
  "src/utils/common.js",
  "src/core/State.js",
  "src/core/Config.js",
  "src/core/Events.js",
  "src/core/GSAPAdapter.js",
  "src/core/SceneBackgroundEngine.js",
  "src/assets/FrameCache.js",
  "src/assets/AssetManager.js",
  "src/renderers/SequenceRenderer.js",
  "src/renderers/VideoRenderer.js",
  "src/input/GestureDetector.js",
  "src/input/ScrollLockManager.js",
  "src/input/InputManager.js",
  "src/drivers/ScrubDriver.js",
  "src/drivers/ScrollTriggerDriver.js",
  "src/drivers/SnapGlideController.js",
  "src/drivers/TakeoverDriver.js",
  "src/core/ContentAnimator.js",
  "src/core/GSAPContentTimeline.js",
  "src/core/TransitionRuntime.js",
  "src/core/Manager.js",
  "src/index.js"
];

function stripModuleSyntax(code) {
  return code
    .replace(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export\s+(const|class|function)\s+/gm, "$1 ")
    .replace(/^export\s+\{[^}]+\};?\s*$/gm, "");
}

const body = order
  .map((rel) => {
    const code = fs.readFileSync(path.join(here, rel), "utf8");
    return `\n/* ===== ${rel} ===== */\n${stripModuleSyntax(code)}\n`;
  })
  .join("\n");

const bundle = `/**
 * SectionTransition v0.6.3
 * Generated from /src by build.mjs. Do not hand-edit this file.
 */
(function (global) {
  "use strict";
${body}
  global.SectionTransition = SectionTransition;
})(window);
`;

const out = path.join(here, "dist/section-transition.js");
fs.writeFileSync(out, bundle);

// Native ESM entrypoint for package/module consumers. Source files are shipped
// with the package, so this thin entry preserves the canonical module graph.
const esmOut = path.join(here, "dist/section-transition.mjs");
fs.writeFileSync(esmOut, `export { SectionTransition } from "../src/index.js";\n`);

// Convenience ESM entry for bundlers: imports the peer GSAP dependency and
// registers ScrollTrigger automatically. The classic browser build intentionally
// does not bundle GSAP; load gsap + ScrollTrigger before SectionTransition.
const gsapEsmOut = path.join(here, "dist/section-transition-gsap.mjs");
fs.writeFileSync(gsapEsmOut, `import { gsap } from "gsap";\nimport { ScrollTrigger } from "gsap/ScrollTrigger";\nimport { SectionTransition } from "../src/index.js";\nSectionTransition.useGSAP(gsap, ScrollTrigger);\nexport { SectionTransition };\n`);

// Parse-only validation. Browser globals are not executed.
new vm.Script(bundle, { filename: "section-transition.js" });

console.log(`Built ${out}`);
console.log(`Built ${esmOut}`);
console.log(`Built ${gsapEsmOut}`);
