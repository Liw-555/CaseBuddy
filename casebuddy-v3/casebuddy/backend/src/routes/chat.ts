import { Router } from 'express';

const router = Router();

// Store sessions in memory (MVP only)
const sessions: Record<string, unknown> = {};

router.get('/sessions', (req, res) => {
  res.json(Object.values(sessions));
});

router.post('/sessions', (req, res) => {
  const session = {
    id: Date.now().toString(),
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  sessions[session.id] = session;
  res.json(session);
});

export default router;
