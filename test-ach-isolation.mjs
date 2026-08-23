import { readFileSync, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";

const APP_ID = "2358720";
const APPDATA = "C:\\Users\\einey.J4F\\AppData\\Roaming";
const crackSave = `${APPDATA}\\GSE Saves\\${APP_ID}\\achievements.json`;
const officialAch = `${APPDATA}\\com.einey.lumaforge\\achievements\\schema\\steam-official\\${APP_ID}\\achievements.json`;
const officialSum = `${APPDATA}\\com.einey.lumaforge\\achievements\\schema\\steam-official\\${APP_ID}\\summary.json`;
const steamAch = `${APPDATA}\\com.einey.lumaforge\\achievements\\schema\\steam\\${APP_ID}\\achievements.json`;
const steamSum = `${APPDATA}\\com.einey.lumaforge\\achievements\\schema\\steam\\${APP_ID}\\summary.json`;

function md5(f) { return existsSync(f) ? createHash("md5").update(readFileSync(f)).digest("hex") : "MISSING"; }
function log(c, m) { const C = {red:"\x1b[31m",green:"\x1b[32m",yellow:"\x1b[33m",cyan:"\x1b[36m",white:"\x1b[37m",gray:"\x1b[90m",magenta:"\x1b[35m",reset:"\x1b[0m"}; console.log(`${C[c]||""}${m}${C.reset}`); }

log("cyan", "\n=== BASELINE ===");
const b = { oA: md5(officialAch), oS: md5(officialSum), sA: md5(steamAch), sS: md5(steamSum) };
log("white", `  steam-official/ach: ${b.oA}  sum: ${b.oS}`);
log("white", `  steam/ach: ${b.sA}  sum: ${b.sS}`);

log("yellow", "\n=== MODIFY CRACK SAVE ===");
const raw = JSON.parse(readFileSync(crackSave, "utf8"));
raw["TEST_TRUE"] = { earned: true, earned_time: Math.floor(Date.now() / 1000) };
writeFileSync(crackSave, JSON.stringify(raw, null, 2));
log("magenta", "\n>>> CLICK REFRESH (↻) IN LUMAFORGE NOW <<<\n");

let elapsed = 0, offChanged = false, stChanged = false;
while (elapsed < 90) {
  await new Promise(r => setTimeout(r, 2000));
  elapsed += 2;
  const c = { oA: md5(officialAch), oS: md5(officialSum), sA: md5(steamAch), sS: md5(steamSum) };
  const oCh = c.oA !== b.oA || c.oS !== b.oS;
  const sCh = c.sA !== b.sA || c.sS !== b.sS;

  if (oCh && !offChanged) {
    offChanged = true;
    log("red", `[${elapsed}s] FAIL: steam-official CHANGED!`);
    if (c.oA !== b.oA) log("red", `  ach: ${b.oA} -> ${c.oA}`);
    if (c.oS !== b.oS) { log("red", `  sum: ${b.oS} -> ${c.oS}`); try { log("red", `  content: ${readFileSync(officialSum,"utf8")}`); } catch{} }
  }
  if (sCh && !stChanged) { stChanged = true; log("green", `[${elapsed}s] steam/ CHANGED (ok) ${b.sS} -> ${c.sS}`); }
  if (offChanged) break;
  log("gray", `[${elapsed}s] ${stChanged ? "watching for secondary writes..." : "waiting..."}`);
}

delete raw["TEST_TRUE"];
writeFileSync(crackSave, JSON.stringify(raw, null, 2));
log("yellow", "Crack save restored");

const f = { oA: md5(officialAch), oS: md5(officialSum), sA: md5(steamAch), sS: md5(steamSum) };
log("white", "\n=== VERDICT ===");
log(f.oA !== b.oA || f.oS !== b.oS ? "red" : "green", `  steam-official: ${f.oA !== b.oA || f.oS !== b.oS ? "CHANGED (FAIL)" : "UNCHANGED (PASS)"}`);
log(stChanged ? "green" : "yellow", `  steam/: ${stChanged ? "CHANGED (PASS)" : "unchanged"}`);

if (f.oA !== b.oA || f.oS !== b.oS) { log("red", "\n>>> FAIL <<<"); process.exit(1); }
else if (stChanged) { log("green", "\n>>> PASS <<<"); process.exit(0); }
else { log("yellow", "\n>>> NO CHANGE <<<"); process.exit(2); }
