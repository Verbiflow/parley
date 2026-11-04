/**
 * Patches Baileys (WhatsApp Web) after install, so linked devices get two things WhatsApp only hands to clients that
 * ask for them (the same patch Hearth carries):
 *
 *  - The call log, both directions: ask for call-log history at link time (`supportCallLogHistory`) and surface it,
 *    plus calls made or taken on another device, as `call-log.set`.
 *  - Private-id ↔ phone-number pairs from the link-time history, as `lid-mapping.set`. WhatsApp increasingly addresses
 *    people by a private `@lid` id; these pairs are how its own apps show a number and name for them.
 *
 * Each edit is idempotent and anchored on exact source text. If an upgrade moves that text, this fails the install
 * instead of silently shipping a WhatsApp list without calls or names.
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
    text: `        callLogRecords: item.callLogRecords || [], // ${MARK}\n        lidMappings: item.phoneNumberToLidMappings || [], // ${MARK}\n`,
  },
  {
    file: "lib/Utils/process-message.js",
    find: "                    const data = await downloadAndProcessHistorySyncNotification(histNotification, options);\n",
    insert: "after",
    text:
      `                    // ${MARK}: call logs and id pairs ride along with history; the buffered history event drops extra fields\n` +
      `                    if (data.callLogRecords?.length) ev.emit('call-log.set', { records: data.callLogRecords });\n` +
      `                    if (data.lidMappings?.length) ev.emit('lid-mapping.set', { mappings: data.lidMappings });\n`,
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

// History chunks sent inline: Baileys tells WhatsApp it accepts them (`inlineInitialPayloadInE2EeMsg: true`) but only
// ever downloads by media key, which inline chunks don't have ("Cannot derive from empty media key"), so they were
// dropped, and with them most one-to-one chats. Read the inline payload when there is one (newer Baileys does this).
edits.push({
  file: "lib/Utils/history.js",
  find: "    const stream = await downloadContentFromMessage(msg, 'md-msg-hist', { options });\n    const bufferArray = [];\n    for await (const chunk of stream) {\n        bufferArray.push(chunk);\n    }\n    let buffer = Buffer.concat(bufferArray);\n",
  insert: "replace",
  text:
    `    // ${MARK}: a chunk sent inline carries no media key; read it instead of downloading\n` +
    `    let buffer;\n` +
    `    if (msg.initialHistBootstrapInlinePayload?.length) {\n` +
    `        buffer = Buffer.from(msg.initialHistBootstrapInlinePayload);\n` +
    `    }\n` +
    `    else {\n` +
    `        const stream = await downloadContentFromMessage(msg, 'md-msg-hist', { options });\n` +
    `        const bufferArray = [];\n` +
    `        for await (const chunk of stream) {\n` +
    `            bufferArray.push(chunk);\n` +
    `        }\n` +
    `        buffer = Buffer.concat(bufferArray);\n` +
    `    }\n`,
})

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
