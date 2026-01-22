import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import cvRoutes from './cv.routes.js';
import llmConfigRoutes from './llmConfig.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

// API Routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/cvs', cvRoutes);
router.use('/llm-config', llmConfigRoutes);
router.use('/admin', adminRoutes);

export default router;