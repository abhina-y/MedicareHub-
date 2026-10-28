import jwt from 'jsonwebtoken';
import { User } from '../models.js';

export function authenticate(req, res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.auth = jwt.verify(token, process.env.JWT_SECRET); return next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

export const allow = (...roles) => (req, res, next) => roles.includes(req.auth.role)
  ? next() : res.status(403).json({ error: 'You do not have permission to perform this action' });

export async function activeUser(req, res, next) {
  const user = await User.findOne({ userId: req.auth.userId, status: 'ACTIVE' });
  if (!user) return res.status(401).json({ error: 'Account is inactive or unavailable' });
  req.user = user;
  next();
}
