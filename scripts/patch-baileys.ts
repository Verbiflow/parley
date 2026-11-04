/**
 * Patches Baileys (WhatsApp Web) after install, so linked devices get the call log, both directions: ask for call-log
 * history at link time (`supportCallLogHistory`) and surface it, plus calls made or taken on another device, as
 * `call-log.set`. (The same patch Hearth carries.)
 *
 * Baileys 7 does the rest itself: private-id <-> phone-number pairs (`lidPnMappings`, `lid-mapping.update`) and
 * history chunks sent inline. Those patches are gone.
 *
 * Each edit is idempotent and anchored on exact source text. If an upgrade moves that text, this fails the install
 * instead of silently shipping a WhatsApp list without calls.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const root = dirname(require.resolve("@whiskeysockets/baileys/package.json"))
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }

const MARK = "parley patch"
const edits: Array<{ file: string; find: string; insert: "before" | "after" | "replace"; text: string }> = [
  {
    file: "lib/Utils/validate-connection.js",
    find: "supportCallLogHistory: false,",
    insert: "replace",
    text: `supportCallLogHistory: true, // ${MARK}`,
  },
  {
    file: "lib/Utils/history.js",
    find: "        syncType: item.syncType,",
    insert: "before",
    text: `        callLogRecords: item.callLogRecords || [], // ${MARK}\n`,
  },
  {
    file: "lib/Utils/process-message.js",
    find: "                    const data = await downloadAndProcessHistorySyncNotification(histNotification, options, logger);\n",
    insert: "after",
    text:
      `                    // ${MARK}: call logs ride along with history; the buffered history event drops extra fields\n` +
      `                    if (data.callLogRecords?.length) ev.emit('call-log.set', { records: data.callLogRecords });\n`,
  },
  {
    file: "lib/Utils/chat-utils.js",
    find: "    else if (action?.pushNameSetting) {",
    insert: "before",
    text:
      `    else if (action?.callLogAction?.callLogRecord) { // ${MARK}: a call made or taken on another device\n` +
      `        ev.emit('call-log.set', { records: [action.callLogAction.callLogRecord] });\n    }\n`,
  },
]

let changed = 0
for (const e of edits) {
  const path = join(root, e.file)
  const src = readFileSync(path, "utf8")
  if (src.includes(e.text.trim().split("\n")[0]!)) continue
  if (src.split(e.find).length !== 2) {
    throw new Error(`patch-baileys: can't find the expected code in ${e.file} (baileys ${version}). Update scripts/patch-baileys.ts for this version.`)
  }
  const next = e.insert === "replace" ? src.replace(e.find, e.text) : e.insert === "before" ? src.replace(e.find, e.text + e.find) : src.replace(e.find, e.find + e.text)
  writeFileSync(path, next)
  changed++
}
console.log(`patch-baileys: baileys ${version} ${changed ? `patched (${changed} edits)` : "already patched"}`)
