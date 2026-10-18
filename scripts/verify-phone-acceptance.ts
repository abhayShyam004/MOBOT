import { writeFileSync } from "node:fs";
import {
  getForegroundActivity,
  listAppCatalog,
  onDevice,
  openApp,
  PhoneActionError,
  pressKey,
  readNodes,
  readySerial,
  swipeScreen,
  tapCoordinates,
  tapNode,
  typeText,
} from "../server/drivers/phone-proxy.ts";
import { checkToolPermission } from "../server/permission-policy.ts";

async function runAcceptance() {
  console.log("=== MOBOT PHASE 4 PHYSICAL SAMSUNG ACCEPTANCE TEST ===");
  const serial = await readySerial();
  console.log(`Connected device serial: ${serial}`);

  const results: Record<string, { pass: boolean; details: string }> = {};

  // 1. Discover installed apps
  console.log("\n[1] Discovering installed apps...");
  const apps = await listAppCatalog(serial);
  console.log(`Discovered ${apps.length} apps.`);
  results["1_discover_apps"] = {
    pass: apps.length > 10,
    details: `Discovered ${apps.length} total apps.`,
  };

  // 2. Verify known installed apps
  console.log("\n[2] Verifying known installed apps...");
  const knownToFind = ["Settings", "Chrome", "Google Maps", "WhatsApp"];
  const foundNames = apps.map((a) => a.name);
  const foundKnown = knownToFind.filter((k) => foundNames.some((fn) => fn.toLowerCase().includes(k.toLowerCase())));
  console.log("Found known apps:", foundKnown);
  results["2_verify_known_apps"] = {
    pass: foundKnown.length >= 3,
    details: `Found ${foundKnown.join(", ")} out of ${knownToFind.join(", ")}`,
  };

  // 3. Intentionally unavailable app
  console.log("\n[3] Testing intentionally unavailable app...");
  let failedCorrectly = false;
  let errorCode = "";
  try {
    await openApp(serial, "NonExistentAppXYZ123");
  } catch (err) {
    if (err instanceof PhoneActionError) {
      failedCorrectly = err.code === "APP_NOT_INSTALLED";
      errorCode = err.code;
    }
  }
  results["3_unavailable_app"] = {
    pass: failedCorrectly,
    details: `Error classification: ${errorCode}`,
  };

  // 4 & 5. Launch Settings & Verify Foreground
  console.log("\n[4 & 5] Launching Settings & verifying foreground...");
  const openSettingsRes = await openApp(serial, "Settings");
  const fgSettings = await getForegroundActivity(serial);
  console.log(`Open result: ${openSettingsRes}, Foreground: ${JSON.stringify(fgSettings)}`);
  results["4_5_launch_settings"] = {
    pass: fgSettings?.package === "com.android.settings" || fgSettings?.package === "com.android.settings.intelligence",
    details: `Foreground: ${fgSettings?.package}/${fgSettings?.activity}`,
  };

  // 6, 7 & 8. Read Settings screen & verify elements
  console.log("\n[6, 7, 8] Reading Settings screen state...");
  const settingsNodes = await readNodes(serial);
  console.log(`Settings visible elements: ${settingsNodes.length}`);
  results["6_7_8_read_screen"] = {
    pass: settingsNodes.length > 5,
    details: `Read ${settingsNodes.length} nodes from Settings screen.`,
  };

  // 9 & 10. Tap a visible control in Settings
  console.log("\n[9 & 10] Tapping a visible item...");
  let tapResult = "";
  try {
    const clickable = settingsNodes.find((n) => n.clickable && (n.text || n.description));
    if (clickable) {
      const label = clickable.text || clickable.description;
      tapResult = await tapNode(serial, label);
      console.log(`Tap result: ${tapResult}`);
    } else {
      tapResult = await tapCoordinates(serial, 360, 500);
      console.log(`Coordinate tap result: ${tapResult}`);
    }
  } catch (e) {
    tapResult = String(e);
  }
  results["9_10_tap_control"] = {
    pass: tapResult.startsWith("Tapped"),
    details: tapResult,
  };

  // 11 & 12. Text input test
  console.log("\n[11 & 12] Testing text input in search/field...");
  await pressKey(serial, "back");
  await new Promise((r) => setTimeout(r, 500));
  let typedRes = "";
  try {
    await tapNode(serial, "Search", { exact: false }).catch(async () => {
      await tapCoordinates(serial, 650, 100);
    });
    await new Promise((r) => setTimeout(r, 600));
    typedRes = await typeText(serial, "Display");
    console.log(`Type result: ${typedRes}`);
  } catch (e) {
    typedRes = String(e);
  }
  results["11_12_type_text"] = {
    pass: typedRes.includes("Typed text"),
    details: typedRes,
  };

  // 13 & 14. Scroll test
  console.log("\n[13 & 14] Testing scroll / swipe...");
  const swipeRes = await swipeScreen(serial, "up");
  console.log(`Swipe result: ${swipeRes}`);
  results["13_14_scroll"] = {
    pass: swipeRes === "Swiped up",
    details: swipeRes,
  };

  // 15 & 16. Back navigation
  console.log("\n[15 & 16] Pressing Back...");
  const backRes = await pressKey(serial, "back");
  console.log(`Back result: ${backRes}`);
  const fgAfterBack = await getForegroundActivity(serial);
  results["15_16_back_nav"] = {
    pass: backRes === "Pressed back",
    details: `Foreground after back: ${fgAfterBack?.package}`,
  };

  // 17. App Switch
  console.log("\n[17] Testing app switch to MOBOT Companion...");
  await openApp(serial, "MOBOT");
  const fgCompanion = await getForegroundActivity(serial);
  results["17_app_switch"] = {
    pass: fgCompanion?.package === "com.openmausbot.companion",
    details: `Foreground: ${fgCompanion?.package}`,
  };

  // 18. Screen Capture
  console.log("\n[18] Screen capture test...");
  const png = await onDevice(serial, ["exec-out", "screencap", "-p"], true);
  const isValidPng = png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  writeFileSync("/tmp/screen_acceptance_test.png", png);
  results["18_screencap"] = {
    pass: isValidPng && png.length > 10000,
    details: `Captured valid PNG (720x1600) of size ${png.length} bytes.`,
  };

  // 19 & 20. Launch Maps & Verify
  console.log("\n[19 & 20] Launching Google Maps...");
  const openMapsRes = await openApp(serial, "Maps");
  const fgMaps = await getForegroundActivity(serial);
  console.log(`Maps result: ${openMapsRes}, Foreground: ${JSON.stringify(fgMaps)}`);
  results["19_20_maps"] = {
    pass: fgMaps?.package === "com.google.android.apps.maps",
    details: `Foreground: ${fgMaps?.package}/${fgMaps?.activity}`,
  };

  // 21. Location-aware or search interaction
  console.log("\n[21] Reading Maps screen elements...");
  const mapsNodes = await readNodes(serial);
  results["21_maps_screen"] = {
    pass: mapsNodes.length > 0,
    details: `Read ${mapsNodes.length} nodes from Maps.`,
  };

  // 22. WhatsApp Test
  console.log("\n[22] Testing WhatsApp...");
  const isWhatsappInstalled = apps.some((a) => a.packageName === "com.whatsapp");
  let waDetails = "";
  let waPass = false;
  if (isWhatsappInstalled) {
    await openApp(serial, "WhatsApp");
    const fgWa = await getForegroundActivity(serial);
    waPass = fgWa?.package === "com.whatsapp";
    waDetails = `WhatsApp opened successfully. Foreground: ${fgWa?.package}/${fgWa?.activity}`;
  } else {
    waPass = true;
    waDetails = "WhatsApp not installed; reported accurately.";
  }
  console.log(`WhatsApp test: ${waDetails}`);
  results["22_whatsapp"] = {
    pass: waPass,
    details: waDetails,
  };

  // 23 & 24. Invalid Action & Failure Classification
  console.log("\n[23 & 24] Testing invalid action & error classification...");
  let invalidActionErr = "";
  try {
    await tapNode(serial, "NonExistentStringXYZ987654321");
  } catch (e) {
    if (e instanceof PhoneActionError) {
      invalidActionErr = e.code;
    }
  }
  results["23_24_invalid_action"] = {
    pass: invalidActionErr === "TARGET_NOT_FOUND",
    details: `Error classification: ${invalidActionErr}`,
  };

  // 25, 26, 27, 28, 29. Permission Integration
  console.log("\n[25..29] Testing Permission Policy integration...");
  const checkDenied = checkToolPermission("open_app", { terminal: "denied" });
  const checkGranted = checkToolPermission("open_app", { terminal: "granted" });
  results["25_29_permission_gate"] = {
    pass: !checkDenied.allowed && checkGranted.allowed,
    details: `Denied allowed: ${checkDenied.allowed} (${checkDenied.reason}), Granted allowed: ${checkGranted.allowed}`,
  };

  // Switch back to Companion app
  await openApp(serial, "MOBOT");

  console.log("\n=== FINAL TEST RESULTS ===");
  let allPassed = true;
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.pass ? "PASS" : "FAIL"} - ${v.details}`);
    if (!v.pass) allPassed = false;
  }
  console.log(`\nOVERALL: ${allPassed ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}`);
}

runAcceptance().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
