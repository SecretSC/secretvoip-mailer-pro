import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../env';

export interface JwtPayload {
  sub: string;          // user id
  username: string;
  role: 'admin' | 'client';
  fpc: boolean;         // force_password_change
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
