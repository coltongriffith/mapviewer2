import { capabilities } from '../../../shared/agentSchema.js';
import { applyCors, handleMethods } from '../guard.js';

export default function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  if (handleMethods(req, res, ['GET'])) return;
  return res.status(200).json(capabilities());
}
