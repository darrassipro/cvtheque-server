import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { User, UserRole, UserStatus } from '../models/index.js';
import { AuthenticatedRequest, JWTPayload } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * JWT Authentication Middleware
 * Validates access token from Authorization header or httpOnly cookies
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    let token: string | undefined;
    
    // Try to get token from Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [bearer, headerToken] = authHeader.split(' ');
      if (bearer === 'Bearer' && headerToken) {
        token = headerToken;
      }
    }
    
    // If no Authorization header, try to get from httpOnly cookies
    if (!token && req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Access token required',
        message: 'No authorization header or token cookie provided',
      });
      return;
    }

    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token expired',
        message: 'Access token has expired. Please refresh your token.',
      });
      return;
    }
    
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'Access token is invalid or malformed',
      });
      return;
    }

    logger.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      message: 'An error occurred during authentication',
    });
  }
}

/**
 * Optional Authentication Middleware
 * Attaches user if token exists (from header or cookies) but doesn't require it
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    let token: string | undefined;
    
    // Try to get token from Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [bearer, headerToken] = authHeader.split(' ');
      if (bearer === 'Bearer' && headerToken) {
        token = headerToken;
      }
    }
    
    // If no Authorization header, try to get from httpOnly cookies
    if (!token && req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
        req.user = decoded;
      } catch {
        // Token invalid, but that's okay for optional auth
      }
    }
    next();
  } catch (error) {
    next();
  }
}

/**
 * Check if user account is active
 * Must be used after authenticate middleware
 */
export async function requireActiveAccount(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const user = await User.findByPk(req.user.userId, {
      attributes: ['id', 'status'],
    });

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'User not found',
        message: 'The user account no longer exists',
      });
      return;
    }

    if (user.status !== UserStatus.ACTIVE) {
      res.status(403).json({
        success: false,
        error: 'Account inactive',
        message: `Your account is ${user.status.toLowerCase()}. Please contact an administrator.`,
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Active account check error:', error);
    res.status(500).json({
      success: false,
      error: 'Account verification failed',
    });
  }
}

/**
 * Generate JWT tokens
 */
export function generateTokens(user: User): { accessToken: string; refreshToken: string } {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as string,
  } as jwt.SignOptions);

  const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as string,
  } as jwt.SignOptions);

  return { accessToken, refreshToken };
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): JWTPayload {
  return jwt.verify(token, config.jwt.refreshSecret) as JWTPayload;
}

/**
 * Parse JWT expiry time string to milliseconds
 */
export function parseExpiryToMs(expiry: string): number {
  const unit = expiry.slice(-1);
  const value = parseInt(expiry.slice(0, -1), 10);
  
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return value;
  }
}