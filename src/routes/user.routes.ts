import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { authenticate, requireActiveAccount } from '../middleware/auth.js';
import { authorize, requireAdmin, requireSuperAdmin } from '../middleware/authorize.js';
import { validate, userSchemas } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadAvatar } from '../middleware/upload.js';
import { UserRole } from '../models/index.js';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(requireActiveAccount);

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get current user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user's profile
 */
router.get(
  '/profile',
  asyncHandler(userController.getProfile)
);

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Update current user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.put(
  '/profile',
  validate({ body: userSchemas.updateProfile }),
  asyncHandler(userController.updateProfile)
);

// Upload / update profile avatar (multipart/form-data with field "avatar")
router.post(
  '/profile/avatar',
  uploadAvatar,
  asyncHandler(userController.uploadProfileAvatar)
);

/**
 * @swagger
 * /api/users/profile/cv:
 *   get:
 *     summary: Get current user's CV information
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's CV information
 */
router.get(
  '/profile/cv',
  asyncHandler(userController.getProfileCV)
);

/**
 * @swagger
 * /api/users/profile/cv:
 *   put:
 *     summary: Update current user's CV information
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               location:
 *                 type: string
 *               education:
 *                 type: array
 *               experience:
 *                 type: array
 *               skills:
 *                 type: object
 *               languages:
 *                 type: array
 *     responses:
 *       200:
 *         description: CV information updated successfully
 */
router.put(
  '/profile/cv',
  validate({ body: userSchemas.updateCV }),
  asyncHandler(userController.updateProfileCV)
);

/**
 * @swagger
 * /api/users/profile/cvs:
 *   get:
 *     summary: List all user's CVs (completed and archived)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's CVs
 */
router.get(
  '/profile/cvs',
  asyncHandler(userController.listUserCVs)
);

/**
 * @swagger
 * /api/users/profile/cvs/{cvId}/default:
 *   put:
 *     summary: Set a CV as default
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cvId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: CV set as default
 */
router.put(
  '/profile/cvs/:cvId/default',
  asyncHandler(userController.setDefaultCV)
);

/**
 * @swagger
 * /api/users/profile/cvs/{cvId}:
 *   delete:
 *     summary: Delete a CV
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cvId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: CV deleted
 */
router.delete(
  '/profile/cvs/:cvId',
  asyncHandler(userController.deleteCV)
);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List all users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of users
 */
router.get(
  '/',
  authorize([UserRole.MODERATOR]),
  validate({ query: userSchemas.query }),
  asyncHandler(userController.listUsers)
);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details
 *       404:
 *         description: User not found
 */
router.get(
  '/:id',
  authorize([UserRole.MODERATOR]),
  validate({ params: userSchemas.params }),
  asyncHandler(userController.getUser)
);

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               role:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *       409:
 *         description: Email already exists
 */
router.post(
  '/',
  requireAdmin,
  validate({ body: userSchemas.create }),
  asyncHandler(userController.createUser)
);

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update a user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 *       404:
 *         description: User not found
 */
router.put(
  '/:id',
  requireAdmin,
  validate({ params: userSchemas.params, body: userSchemas.update }),
  asyncHandler(userController.updateUser)
);

/**
 * @swagger
 * /api/users/{id}/role:
 *   patch:
 *     summary: Update user role
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *     responses:
 *       200:
 *         description: User role updated
 *       403:
 *         description: Cannot assign this role
 */
router.patch(
  '/:id/role',
  requireAdmin,
  validate({ params: userSchemas.params, body: userSchemas.updateRole }),
  asyncHandler(userController.updateUserRole)
);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete a user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       404:
 *         description: User not found
 */
router.delete(
  '/:id',
  requireAdmin,
  validate({ params: userSchemas.params }),
  asyncHandler(userController.deleteUser)
);

/**
 * @swagger
 * /api/users/{id}/activate:
 *   post:
 *     summary: Activate a user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User activated
 */
router.post(
  '/:id/activate',
  requireAdmin,
  validate({ params: userSchemas.params }),
  asyncHandler(userController.activateUser)
);

/**
 * @swagger
 * /api/users/{id}/suspend:
 *   post:
 *     summary: Suspend a user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User suspended
 */
router.post(
  '/:id/suspend',
  requireAdmin,
  validate({ params: userSchemas.params }),
  asyncHandler(userController.suspendUser)
);

export default router;