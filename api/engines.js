// GET /api/engines → per-engine measurement config + GBP/Place readiness checklists.
// Operators/Phase 2 use this; the verified field paths drive /api/citation later.
import { publicConfig } from '../lib/engines.js';
import { CHECKLISTS, CLIENT_SETUP_CHECKLIST } from '../lib/checklists.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    ...publicConfig(),
    checklists: CHECKLISTS,
    clientSetup: CLIENT_SETUP_CHECKLIST,
    sourced: 'docs/engines + docs/measurement (verified 2026-06-22~23)',
  });
}
