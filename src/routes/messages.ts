import { Router } from 'express';
import { pool } from '../db';
import { AuthedRequest, requireAuth } from '../middleware/auth';

const router = Router();

function pairUserIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function resolveAvatarUrl(avatarUrl: string | null, baseUrl: string): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http')) return avatarUrl;
  return `${baseUrl}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
}

async function isDmAllowed(userA: string, userB: string): Promise<boolean> {
  const result = await pool!.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM dm_requests
       WHERE status = 'accepted'
         AND (
           (requester_id = $1 AND recipient_id = $2)
           OR (requester_id = $2 AND recipient_id = $1)
         )
     ) AS ok`,
    [userA, userB]
  );
  return result.rows[0]?.ok ?? false;
}

async function getOrCreateConversation(userA: string, userB: string): Promise<string> {
  const [userLow, userHigh] = pairUserIds(userA, userB);
  const existing = await pool!.query<{ id: string }>(
    `SELECT id FROM conversations WHERE user_low = $1 AND user_high = $2`,
    [userLow, userHigh]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await pool!.query<{ id: string }>(
    `INSERT INTO conversations (user_low, user_high)
     VALUES ($1, $2)
     RETURNING id`,
    [userLow, userHigh]
  );
  return created.rows[0].id;
}

router.get('/requests', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const me = req.auth!.userId;
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    const incoming = await pool.query<{
      id: string;
      requester_id: string;
      requester_username: string;
      requester_avatar_url: string | null;
      created_at: string;
    }>(
      `SELECT
         r.id,
         r.requester_id,
         u.username AS requester_username,
         u.avatar_url AS requester_avatar_url,
         r.created_at
       FROM dm_requests r
       JOIN users u ON u.id = r.requester_id
       WHERE r.recipient_id = $1 AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
      [me]
    );

    const outgoing = await pool.query<{
      id: string;
      recipient_id: string;
      recipient_username: string;
      recipient_avatar_url: string | null;
      status: string;
      created_at: string;
    }>(
      `SELECT
         r.id,
         r.recipient_id,
         u.username AS recipient_username,
         u.avatar_url AS recipient_avatar_url,
         r.status,
         r.created_at
       FROM dm_requests r
       JOIN users u ON u.id = r.recipient_id
       WHERE r.requester_id = $1 AND r.status IN ('pending', 'declined')
       ORDER BY r.created_at DESC`,
      [me]
    );

    res.json({
      incoming: incoming.rows.map((row) => ({
        id: row.id,
        userId: row.requester_id,
        username: row.requester_username,
        avatarUrl: resolveAvatarUrl(row.requester_avatar_url, baseUrl),
        createdAt: row.created_at,
      })),
      outgoing: outgoing.rows.map((row) => ({
        id: row.id,
        userId: row.recipient_id,
        username: row.recipient_username,
        avatarUrl: resolveAvatarUrl(row.recipient_avatar_url, baseUrl),
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('dm requests list failed:', err);
    res.status(500).json({ error: 'Failed to load message requests' });
  }
});

router.get('/status/:userId', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const me = req.auth!.userId;
  const otherUserId = String(req.params.userId);

  if (otherUserId === me) {
    res.status(400).json({ error: 'Invalid user' });
    return;
  }

  try {
    const otherUser = await pool.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [
      otherUserId,
    ]);
    if (!otherUser.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const allowed = await isDmAllowed(me, otherUserId);
    if (allowed) {
      res.json({ status: 'accepted' });
      return;
    }

    const request = await pool.query<{
      id: string;
      requester_id: string;
      recipient_id: string;
      status: string;
    }>(
      `SELECT id, requester_id, recipient_id, status
       FROM dm_requests
       WHERE (requester_id = $1 AND recipient_id = $2)
          OR (requester_id = $2 AND recipient_id = $1)
       ORDER BY created_at DESC
       LIMIT 1`,
      [me, otherUserId]
    );

    const row = request.rows[0];
    if (!row || row.status === 'declined') {
      res.json({ status: 'none', requestId: row?.status === 'declined' ? row.id : undefined });
      return;
    }

    if (row.status === 'accepted') {
      res.json({ status: 'accepted', requestId: row.id });
      return;
    }

    if (row.requester_id === me) {
      res.json({ status: 'pending_outgoing', requestId: row.id });
      return;
    }

    res.json({ status: 'pending_incoming', requestId: row.id });
  } catch (err) {
    console.error('dm status failed:', err);
    res.status(500).json({ error: 'Failed to load message status' });
  }
});

router.post('/requests/:userId', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const me = req.auth!.userId;
  const recipientId = String(req.params.userId);

  if (recipientId === me) {
    res.status(400).json({ error: 'You cannot message yourself' });
    return;
  }

  try {
    const recipient = await pool.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [
      recipientId,
    ]);
    if (!recipient.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (await isDmAllowed(me, recipientId)) {
      res.status(400).json({ error: 'You can already message this player' });
      return;
    }

    const existing = await pool.query<{ id: string; status: string; requester_id: string }>(
      `SELECT id, status, requester_id
       FROM dm_requests
       WHERE (requester_id = $1 AND recipient_id = $2)
          OR (requester_id = $2 AND recipient_id = $1)
       ORDER BY created_at DESC
       LIMIT 1`,
      [me, recipientId]
    );

    const row = existing.rows[0];
    if (row?.status === 'pending') {
      if (row.requester_id === me) {
        res.status(400).json({ error: 'Request already sent' });
        return;
      }
      res.status(400).json({
        error: 'This player already sent you a request. Check your Messages to approve it.',
      });
      return;
    }

    const upserted = await pool.query<{ id: string; status: string; created_at: string }>(
      `INSERT INTO dm_requests (requester_id, recipient_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (requester_id, recipient_id)
       DO UPDATE SET status = 'pending', responded_at = NULL, created_at = NOW()
       RETURNING id, status, created_at`,
      [me, recipientId]
    );

    res.status(201).json({
      request: {
        id: upserted.rows[0].id,
        status: upserted.rows[0].status,
        createdAt: upserted.rows[0].created_at,
      },
    });
  } catch (err) {
    console.error('dm request create failed:', err);
    res.status(500).json({ error: 'Failed to send message request' });
  }
});

router.post('/requests/:requestId/respond', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const me = req.auth!.userId;
  const requestId = String(req.params.requestId);
  const action = String(req.body?.action ?? '').trim();

  if (action !== 'accept' && action !== 'decline') {
    res.status(400).json({ error: 'action must be accept or decline' });
    return;
  }

  try {
    const request = await pool.query<{
      id: string;
      requester_id: string;
      recipient_id: string;
      status: string;
    }>(`SELECT id, requester_id, recipient_id, status FROM dm_requests WHERE id = $1`, [
      requestId,
    ]);

    const row = request.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    if (row.recipient_id !== me) {
      res.status(403).json({ error: 'Only the recipient can respond to this request' });
      return;
    }

    if (row.status !== 'pending') {
      res.status(400).json({ error: 'This request was already handled' });
      return;
    }

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    await pool.query(
      `UPDATE dm_requests SET status = $1, responded_at = NOW() WHERE id = $2`,
      [newStatus, requestId]
    );

    if (action === 'accept') {
      await getOrCreateConversation(row.requester_id, row.recipient_id);
    }

    res.json({ status: newStatus, requestId: row.id });
  } catch (err) {
    console.error('dm request respond failed:', err);
    res.status(500).json({ error: 'Failed to respond to request' });
  }
});

router.get('/inbox', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const me = req.auth!.userId;
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    const result = await pool.query<{
      conversation_id: string;
      other_user_id: string;
      other_username: string;
      other_avatar_url: string | null;
      last_body: string;
      last_created_at: string;
      unread_count: string;
    }>(
      `SELECT
         c.id AS conversation_id,
         CASE WHEN c.user_low = $1 THEN c.user_high ELSE c.user_low END AS other_user_id,
         u.username AS other_username,
         u.avatar_url AS other_avatar_url,
         lm.body AS last_body,
         lm.created_at AS last_created_at,
         COALESCE(unread.count, 0)::text AS unread_count
       FROM conversations c
       JOIN users u ON u.id = CASE WHEN c.user_low = $1 THEN c.user_high ELSE c.user_low END
       JOIN LATERAL (
         SELECT body, created_at
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) lm ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS count
         FROM messages
         WHERE conversation_id = c.id
           AND sender_id <> $1
           AND read_at IS NULL
       ) unread ON TRUE
       WHERE (c.user_low = $1 OR c.user_high = $1)
         AND EXISTS (
           SELECT 1 FROM dm_requests dr
           WHERE dr.status = 'accepted'
             AND (
               (dr.requester_id = $1 AND dr.recipient_id = CASE WHEN c.user_low = $1 THEN c.user_high ELSE c.user_low END)
               OR (dr.recipient_id = $1 AND dr.requester_id = CASE WHEN c.user_low = $1 THEN c.user_high ELSE c.user_low END)
             )
         )
       ORDER BY c.updated_at DESC`,
      [me]
    );

    res.json({
      conversations: result.rows.map((row) => ({
        conversationId: row.conversation_id,
        userId: row.other_user_id,
        username: row.other_username,
        avatarUrl: resolveAvatarUrl(row.other_avatar_url, baseUrl),
        lastMessage: row.last_body,
        lastMessageAt: row.last_created_at,
        unreadCount: parseInt(row.unread_count, 10) || 0,
      })),
    });
  } catch (err) {
    console.error('messages inbox failed:', err);
    res.status(500).json({ error: 'Failed to load inbox' });
  }
});

router.get('/with/:userId', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const me = req.auth!.userId;
  const otherUserId = String(req.params.userId);

  if (otherUserId === me) {
    res.status(400).json({ error: 'You cannot message yourself' });
    return;
  }

  try {
    const otherUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1`,
      [otherUserId]
    );
    if (!otherUser.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!(await isDmAllowed(me, otherUserId))) {
      res.status(403).json({ error: 'Message request must be approved before chatting' });
      return;
    }

    const conversationId = await getOrCreateConversation(me, otherUserId);

    await pool.query(
      `UPDATE messages SET read_at = NOW()
       WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [conversationId, me]
    );

    const messages = await pool.query<{
      id: string;
      sender_id: string;
      body: string;
      created_at: string;
    }>(
      `SELECT id, sender_id, body, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [conversationId]
    );

    res.json({
      conversationId,
      messages: messages.rows.map((row) => ({
        id: row.id,
        senderId: row.sender_id,
        body: row.body,
        createdAt: row.created_at,
        isMine: row.sender_id === me,
      })),
    });
  } catch (err) {
    console.error('messages thread failed:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.post('/with/:userId', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const me = req.auth!.userId;
  const otherUserId = String(req.params.userId);
  const body = String(req.body?.body ?? '').trim();

  if (!body) {
    res.status(400).json({ error: 'Message body is required' });
    return;
  }

  if (body.length > 2000) {
    res.status(400).json({ error: 'Message is too long' });
    return;
  }

  if (otherUserId === me) {
    res.status(400).json({ error: 'You cannot message yourself' });
    return;
  }

  try {
    const otherUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1`,
      [otherUserId]
    );
    if (!otherUser.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!(await isDmAllowed(me, otherUserId))) {
      res.status(403).json({ error: 'Message request must be approved before chatting' });
      return;
    }

    const conversationId = await getOrCreateConversation(me, otherUserId);

    const inserted = await pool.query<{
      id: string;
      sender_id: string;
      body: string;
      created_at: string;
    }>(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, body, created_at`,
      [conversationId, me, body]
    );

    await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);

    const row = inserted.rows[0];
    res.status(201).json({
      message: {
        id: row.id,
        senderId: row.sender_id,
        body: row.body,
        createdAt: row.created_at,
        isMine: true,
      },
    });
  } catch (err) {
    console.error('messages send failed:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
