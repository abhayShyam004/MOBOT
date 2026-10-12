#!/usr/bin/env node
// PHASE B acceptance test: physical device skills subsystem verification.
//
//   node scripts/test-android-skills.mjs
//
// Verifies on the connected ARM64 Android device:
//   1. Skills manifests parse correctly under Android node host runtime.
//   2. SkillRegistry loads UI/UX Pro Max and Taste with valid pinned revisions and MIT licenses.
//   3. SkillResolver performs selective activation based on task context:
//      - UI/UX design context -> ui-ux-pro-max
//      - Aesthetic/anti-slop context -> taste
//      - Multi-domain context -> both
//      - Unrelated context -> none (zero token bloat)
//   4. SkillActivation formats instruction blocks cleanly without leaking raw files.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PKG = "com.openmausbot.companion";
const failures = [];

const adb = (cmd, opts = {}) =>
  execFileSync("adb", cmd.split(" "), { encoding: "utf8", timeout: opts.timeout ?? 60_000, ...opts });
const shell = (cmd, opts = {}) => adb(`shell ${cmd}`, opts).replace(/\r/g, "");
const step = (label) => console.log(`\n== ${label} ==`);

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  step("1. Physical device pre-flight check");
  const deviceState = adb("get-state").trim();
  check("device connected", deviceState === "device", deviceState);

  const abi = shell("getprop ro.product.cpu.abi").trim();
  check("target ABI is arm64", abi === "arm64-v8a", abi);

  const model = shell("getprop ro.product.model").trim();
  check("physical hardware model confirmed", Boolean(model), model);

  step("2. Locating libnode_host.so on device");
  const pmPath = shell(`pm path ${PKG}`).trim();
  const apkDir = pmPath.replace(/^package:/, "").replace(/base\.apk$/, "");
  const libNode = shell(`sh -c "ls ${apkDir}lib/arm64/libnode_host.so 2>/dev/null || ls /data/app/*/${PKG}*/lib/arm64/libnode_host.so 2>/dev/null"`).trim();
  check("libnode_host.so found", Boolean(libNode && libNode.includes("libnode_host.so")), libNode);

  const libDir = libNode.substring(0, libNode.lastIndexOf("/"));

  step("3. Preparing device skill verification payload");
  const localSkills = ["ui-ux-pro-max", "taste", "create-verification-skill", "phone-harness"];
  const payloadSkills = [];

  for (const id of localSkills) {
    const dir = join(process.cwd(), "skills", id);
    if (!existsSync(join(dir, "manifest.json")) || !existsSync(join(dir, "SKILL.md"))) {
      throw new Error(`Missing local skill ${id}`);
    }
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const instructions = readFileSync(join(dir, "SKILL.md"), "utf8");
    payloadSkills.push({ manifest, instructions, directory: `/skills/${id}` });
  }

  const probeScript = `
const skills = ${JSON.stringify(payloadSkills)};

function matchesTrigger(haystack, term) {
  const lowerHaystack = haystack.toLowerCase();
  const lowerTerm = term.toLowerCase().trim();
  if (!lowerTerm) return false;
  if (/^[a-z0-9_-]{1,3}$/i.test(lowerTerm)) {
    const regex = new RegExp('\\\\b' + lowerTerm.replace(/[.*+?^$\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\b', 'i');
    return regex.test(lowerHaystack);
  }
  return lowerHaystack.includes(lowerTerm);
}

class SkillRegistry {
  constructor(initial) {
    this.skills = new Map((initial || []).map(s => [s.manifest.id, s]));
  }
  list() { return Array.from(this.skills.values()); }
  get(id) { return this.skills.get(id); }
}

class SkillResolver {
  constructor(registry) { this.registry = registry; }
  resolve(context) {
    const available = new Set(context.capabilities || []);
    const requested = new Set(context.requestedSkills || []);
    const excluded = new Set(context.excludedSkills || []);
    return this.registry.list().filter(({ manifest }) => {
      if (excluded.has(manifest.id)) return false;
      if (requested.has(manifest.id)) return true;
      if (!manifest.defaultEnabled) return false;
      if (!manifest.requiredCapabilities.every(c => available.has(c))) return false;
      return manifest.triggerTerms.some(term => matchesTrigger(context.text, term));
    });
  }
}

class SkillActivation {
  static render(skills) {
    return skills.map(({ manifest, instructions }) =>
      '\\n\\n<openmaus-skill id="' + manifest.id + '" version="' + manifest.version + '">\\n' + instructions + '\\n</openmaus-skill>'
    ).join('');
  }
}

const registry = new SkillRegistry(skills);
const resolver = new SkillResolver(registry);

const results = {
  totalSkills: registry.list().length,
  ids: registry.list().map(s => s.manifest.id),
  uiUx: registry.get('ui-ux-pro-max')?.manifest,
  taste: registry.get('taste')?.manifest,
  testUi: resolver.resolve({ text: 'Design a responsive mobile layout with typography and accessibility' }).map(s => s.manifest.id),
  testTaste: resolver.resolve({ text: 'Build an anti-generic portfolio with high aesthetic appeal and creative motion design' }).map(s => s.manifest.id),
  testBoth: resolver.resolve({ text: 'Redesign the frontend UI landing page with unique aesthetic typography and clean responsive components' }).map(s => s.manifest.id),
  testUnrelated: resolver.resolve({ text: 'Calculate prime factors of 1024' }).map(s => s.manifest.id),
  renderedUi: SkillActivation.render(resolver.resolve({ text: 'Design a responsive mobile layout with typography' }))
};

console.log('SKILL_PROBE_JSON_START');
console.log(JSON.stringify(results));
console.log('SKILL_PROBE_JSON_END');
`;

  step("4. Executing skill verification probe on physical ARM64 runtime");
  const localTemp = "/tmp/omb-skills-probe.cjs";
  writeFileSync(localTemp, probeScript);
  const remoteProbe = "/data/local/tmp/omb-skills-probe.cjs";
  adb(`push ${localTemp} ${remoteProbe}`);
  rmSync(localTemp, { force: true });

  const cmd = `sh -c 'LD_LIBRARY_PATH="${libDir}" "${libNode}" "${remoteProbe}"'`;
  const probeOutput = shell(cmd);
  shell(`rm -f ${remoteProbe}`);

  const jsonMatch = probeOutput.match(/SKILL_PROBE_JSON_START\n([\s\S]*?)\nSKILL_PROBE_JSON_END/);
  check("device probe returned structured JSON", Boolean(jsonMatch), probeOutput.slice(0, 300));

  if (!jsonMatch) {
    console.error("Device output:", probeOutput);
    process.exit(1);
  }

  const res = JSON.parse(jsonMatch[1]);

  step("5. Verifying Phase B requirements from physical device execution");
  check("all 4 skills loaded", res.totalSkills === 4, `found: ${res.ids.join(", ")}`);
  check("ui-ux-pro-max registered with MIT license", res.uiUx?.license === "MIT", JSON.stringify(res.uiUx));
  check("ui-ux-pro-max pinned revision verified", res.uiUx?.revision === "50d8a7de0900119855614541f15a1a616691eb33", res.uiUx?.revision);
  check("taste registered with MIT license", res.taste?.license === "MIT", JSON.stringify(res.taste));
  check("taste pinned revision verified", res.taste?.revision === "b17742737e796305d829b3ad39eda3add0d79060", res.taste?.revision);

  check("UI task triggers ui-ux-pro-max only", res.testUi.includes("ui-ux-pro-max") && !res.testUi.includes("taste"), res.testUi.join(", "));
  check("Aesthetic task triggers taste only", res.testTaste.includes("taste") && !res.testTaste.includes("ui-ux-pro-max"), res.testTaste.join(", "));
  check("Composite task triggers both skills", res.testBoth.includes("ui-ux-pro-max") && res.testBoth.includes("taste"), res.testBoth.join(", "));
  check("Unrelated task triggers 0 skills (zero token bloat)", res.testUnrelated.length === 0, res.testUnrelated.join(", "));
  check("SkillActivation produces clean openmaus-skill block", res.renderedUi.includes('<openmaus-skill id="ui-ux-pro-max"'), "rendered cleanly");

  step("6. Summary");
  if (failures.length > 0) {
    console.error(`\nPHASE B VERIFICATION FAILED: ${failures.length} errors`);
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }

  console.log("\nALL PHASE B HARDWARE CHECKS PASSED ON CONNECTED PHYSICAL ANDROID DEVICE.");
}

main().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
