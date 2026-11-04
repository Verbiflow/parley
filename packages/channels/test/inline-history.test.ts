import assert from "node:assert/strict"
import { test } from "node:test"
import { deflateSync } from "node:zlib"
import { proto, downloadAndProcessHistorySyncNotification } from "@whiskeysockets/baileys"

// WhatsApp sends the first history chunks inline, inside the notification, with no media key. Unpatched Baileys tried to
// download them anyway ("Cannot derive from empty media key") and dropped them, and with them most one-to-one chats.
// Baileys 7 reads the inline payload itself; this guards against a regression.
test("an inline history chunk (no media key) is read, not dropped", async () => {
  const sync = proto.HistorySync.encode({
    syncType: proto.HistorySync.HistorySyncType.RECENT,
    conversations: [{ id: "6591234567@s.whatsapp.net", name: "Priya", conversationTimestamp: 1762200000 }],
  }).finish()
  const notification = proto.Message.HistorySyncNotification.fromObject({
    syncType: proto.Message.HistorySyncType.RECENT,
    initialHistBootstrapInlinePayload: deflateSync(sync),
  })
  const data = await downloadAndProcessHistorySyncNotification(notification, {})
  assert.deepEqual(data.chats.map((c) => c.id), ["6591234567@s.whatsapp.net"])
})
