/**
 * Patches Baileys (WhatsApp Web) after install, so linked devices get the call log, both directions: ask for call-log
 * history at link time (`supportCallLogHistory`) and surface it, plus calls made or taken on another device, as
 * `call-log.set`. (The same patch Hearth carries.)
 *
 * It also keeps the account offline (see the socket.js edits), so the phone keeps getting notifications.
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
// libsignal (Baileys' Signal protocol) prints whole session records — private keys included — to the console whenever
// it opens or closes one. On the server that's the service log. Keep the notices, drop the key material.
const libsignal = dirname(createRequire(join(root, "package.json")).resolve("libsignal/package.json"))
const edits: Array<{ file: string; find: string; insert: "before" | "after" | "replace"; text: string; root?: string }> = [
  ...([
    ['console.warn("Session already closed", session);', 'console.warn("Session already closed"); // parley patch: no keys in logs'],
    ['console.info("Closing session:", session);', 'console.info("Closing session"); // parley patch: no keys in logs'],
    ['console.info("Opening session:", session);', 'console.info("Opening session"); // parley patch: no keys in logs'],
    ['console.info("Removing old closed session:", oldestSession);', 'console.info("Removing old closed session"); // parley patch: no keys in logs'],
  ] as const).map(([find, text]) => ({ file: "src/session_record.js", find, insert: "replace" as const, text, root: libsignal })),
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
  // Keep the account offline so the phone keeps its notifications. Unpatched, every partial `creds.update` (most of
  // them: keys, sessions, app state carry no `me`) reads as a name change and sends a presence with no type, which
  // WhatsApp takes as "available": the number shows online and the phone stops getting pushes (Baileys#2553).
  // Announce only a real new name, and as unavailable.
  {
    file: "lib/Socket/socket.js",
    find: "        if (creds.me?.name !== name) {",
    insert: "replace",
    text: `        if (name && creds.me?.name !== name) { // ${MARK}: only a real new name`,
  },
  {
    file: "lib/Socket/socket.js",
    find: "                attrs: { name: name }",
    insert: "replace",
    text: `                attrs: { name: name.replace(/@/g, ''), type: 'unavailable' } // ${MARK}: never "available"`,
  },
]

let changed = 0
for (const e of edits) {
  const path = join(e.root ?? root, e.file)
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
