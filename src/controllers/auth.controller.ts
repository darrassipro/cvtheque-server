import { Response } from 'express';
import { Op } from 'sequelize';
import { User, UserStatus, UserRole, RefreshToken } from '../models/index.js';
import { AuthenticatedRequest } from '../types/index.js';
import { generateTokens, verifyRefreshToken, parseExpiryToMs } from '../middleware/auth.js';
import { logAuthEvent } from '../middleware/audit.js';
import { AppError, ConflictError, UnauthorizedError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Register a new user
 */
export async function register(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { email, password, firstName, lastName } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new ConflictError('A user with this email already exists');
  }

  // Create user
  const user = await User.create({
    email,
    password,
    firstName,
    lastName,
    role: UserRole.USER, // default member
    status: UserStatus.ACTIVE, // activate immediately for demo
  });

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user);

  // Store refresh token
  await RefreshToken.create({
    token: refreshToken,
    userId: user.id,
    expiresAt: new Date(Date.now() + parseExpiryToMs(config.jwt.refreshExpiresIn)),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  logger.info(`New user registered: ${user.email}`);

  // Set httpOnly cookie for access token
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
  });

  // Set httpOnly cookie for refresh token
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: {
      user: user.toJSON(),
      accessToken,
      refreshToken,
      expiresIn: config.jwt.expiresIn,
    },
  });
}

/**
 * Login user
 */
export async function login(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { email, password } = req.body;

  // Find user
  const user = await User.findOne({ where: { email } });
  if (!user) {
    await logAuthEvent(req, 'LOGIN' as any, undefined, false, { email, reason: 'User not found' });
    throw new UnauthorizedError('Invalid email or password');
  }

  // Check password
  const isValidPassword = await user.comparePassword(password);
  if (!isValidPassword) {
    await logAuthEvent(req, 'LOGIN' as any, user.id, false, { reason: 'Invalid password' });
    throw new UnauthorizedError('Invalid email or password');
  }

  // Check user status
  if (user.status === UserStatus.SUSPENDED) {
    await logAuthEvent(req, 'LOGIN' as any, user.id, false, { reason: 'Account suspended' });
    throw new UnauthorizedError('Your account has been suspended. Please contact support.');
  }

  if (user.status === UserStatus.INACTIVE) {
    await logAuthEvent(req, 'LOGIN' as any, user.id, false, { reason: 'Account inactive' });
    throw new UnauthorizedError('Your account is inactive. Please contact support.');
  }

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user);

  // Store refresh token
  await RefreshToken.create({
    token: refreshToken,
    userId: user.id,
    expiresAt: new Date(Date.now() + parseExpiryToMs(config.jwt.refreshExpiresIn)),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Update last login
  await user.update({
    lastLoginAt: new Date(),
    lastLoginIp: req.ip,
  });

  await logAuthEvent(req, 'LOGIN' as any, user.id, true);

  // Set httpOnly cookie for access token
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
  });

  // Set httpOnly cookie for refresh token
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: user.toJSON(),
      accessToken,
      refreshToken,
      expiresIn: config.jwt.expiresIn,
    },
  });
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  console.log('[Refresh] Request received', {
    body: req.body,
    cookies: req.cookies,
    headers: {
      authorization: req.headers.authorization ? 'present' : 'missing',
      'content-type': req.headers['content-type'],
    },
  });

  // Get refresh token from body or httpOnly cookie
  const token = req.body?.refreshToken || req.cookies?.refreshToken;

  console.log('[Refresh] Token source:', {
    fromBody: !!req.body?.refreshToken,
    fromCookie: !!req.cookies?.refreshToken,
    token: token ? `${token.substring(0, 20)}...` : 'missing',
  });

  if (!token) {
    console.log('[Refresh] No refresh token provided');
    throw new UnauthorizedError('Refresh token not provided');
  }

  // Find and validate refresh token
  const storedToken = await RefreshToken.findOne({
    where: { token },
    include: [{ model: User, as: 'user' }],
  });

  console.log('[Refresh] Stored token found:', !!storedToken);

  if (!storedToken || !storedToken.isValid()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const user = await User.findByPk(storedToken.userId);
  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new UnauthorizedError('User account is not active');
  }

  // Revoke old token
  await storedToken.update({ revokedAt: new Date() });

  // Generate new tokens
  const { accessToken, refreshToken } = generateTokens(user);

  // Store new refresh token
  await RefreshToken.create({
    token: refreshToken,
    userId: user.id,
    expiresAt: new Date(Date.now() + parseExpiryToMs(config.jwt.refreshExpiresIn)),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Set new tokens in httpOnly cookies
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.expiresIn,
    },
  });
}

/**
 * Logout user
 */
export async function logout(req: AuthenticatedRequest, res: Response): Promise<void> {
  const authHeader = req.headers.authorization;

  if (req.user) {
    // Revoke all refresh tokens for this user from this device
    const whereClause: any = {
      userId: req.user.userId,
      revokedAt: { [Op.eq]: null }
    };

    // Only filter by user-agent if it's present
    const userAgent = req.headers['user-agent'];
    if (userAgent) {
      whereClause.userAgent = userAgent;
    }

    await RefreshToken.update(
      { revokedAt: new Date() },
      { where: whereClause }
    );

    await logAuthEvent(req, 'LOGOUT' as any, req.user.userId, true);
  }

  // Clear httpOnly cookies
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/' });

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}

/**
 * Logout from all devices
 */
export async function logoutAll(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  // Revoke all refresh tokens for this user
  await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { userId: req.user.userId, revokedAt: { [Op.eq]: null } as any } }
  );

  await logAuthEvent(req, 'LOGOUT' as any, req.user.userId, true, { logoutAll: true });

  res.json({
    success: true,
    message: 'Logged out from all devices',
  });
}

/**
 * Get current user profile
 */
export async function getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  const user = await User.findByPk(req.user.userId);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  res.json({
    success: true,
    data: user.toJSON(),
  });
}

/**
 * Update current user profile
 */
export async function updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  const user = await User.findByPk(req.user.userId);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const { firstName, lastName, avatar } = req.body;

  await user.update({
    ...(firstName && { firstName }),
    ...(lastName && { lastName }),
    ...(avatar !== undefined && { avatar }),
  });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: user.toJSON(),
  });
}

/**
 * Change password
 */
export async function changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  const user = await User.findByPk(req.user.userId);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const { currentPassword, newPassword } = req.body;

  // Verify current password
  const isValid = await user.comparePassword(currentPassword);
  if (!isValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Update password (hook will hash it)
  await user.update({ password: newPassword });

  // Revoke all refresh tokens
  await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { userId: user.id, revokedAt: { [Op.eq]: null } as any } }
  );

  res.json({
    success: true,
    message: 'Password changed successfully. Please log in again.',
  });
}