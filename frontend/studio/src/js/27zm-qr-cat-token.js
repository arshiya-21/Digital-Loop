/*! SandMan Digital Loop Studio — 27zm-qr-cat-token.js
 *  Category QR stickers work like machine QR stickers (21-machine-cards.js):
 *  · every category has its own unguessable token (c.qr), minted when it is made so its QR exists at once, confirmed by
 *    the server when the loop is saved, and never changed;
 *  · with the Digital Loop server behind the studio the sticker opens <address>/c/<token> — a small phone page of its
 *    own (no sign-in, no studio), showing that category's readings live from the database;
 *  · without a server (a standalone file) the old <address>#cat=<id> link still works.
 *  The server register is kept in step by the SandMan layer (maintenance.mjs › registerEquipment). */

function qcEnsureTokens(list) {
  const seen = new Set();
  (list || qcDoc()).forEach(c => {
    if (!c.qr || seen.has(c.qr) || !/^[A-Za-z0-9_-]{16,64}$/.test(c.qr)) c.qr = mcNewToken();
    seen.add(c.qr);
  });
}
{
  const prev = qcUrl;
  qcUrl = function (c, base) {
    if (!window.DL_CARD_BASE || !c) return prev.apply(this, arguments);
    if (!c.qr) c.qr = mcNewToken();
    return mcRoot(base || mcBase()) + '/c/' + c.qr;
  };
}
/* what the server register is given: one entry per saved category */
function qcSyncPayload() {
  qcEnsureTokens();
  return qcDoc().map(c => ({ key: c.id, name: c.name || 'Untitled', color: c.color || '', desc: c.desc || '', tags: (c.tags || []).slice(), token: c.qr }));
}
/* the server's tokens are the real ones */
function qcApplyTokens(cards) {
  (cards || []).forEach(k => {
    const c = qcDoc().find(x => String(x.id) === String(k.key));
    if (c && !k.retired && c.qr !== k.token) c.qr = k.token;
  });
}
