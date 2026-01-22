import { Router } from 'express';
import * as llmConfigController from '../controllers/llmConfig.controller.js';
import { authenticate, requireActiveAccount } from '../middleware/auth.js';
import { requireAdmin, requireSuperAdmin } from '../middleware/authorize.js';
import { validate, llmConfigSchemas } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(requireActiveAccount);

/**
 * @swagger
 * /api/llm-config:
 *   get:
 *     summary: List all LLM configurations
 *     tags: [LLM Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of LLM configurations
 */
router.get(
  '/',
  requireAdmin,
  asyncHandler(llmConfigController.listLLMConfigs)
);

/**
 * @swagger
 * /api/llm-config/providers:
 *   get:
 *     summary: Get available LLM providers
 *     tags: [LLM Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available providers
 */
router.get(
  '/providers',
  requireAdmin,
  asyncHandler(llmConfigController.getAvailableProviders)
);

/**
 * @swagger
 * /api/llm-config/{id}:
 *   get:
 *     summary: Get LLM configuration by ID
 *     tags: [LLM Configuration]
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
 *         description: LLM configuration details
 *       404:
 *         description: Configuration not found
 */
router.get(
  '/:id',
  requireAdmin,
  validate({ params: llmConfigSchemas.params }),
  asyncHandler(llmConfigController.getLLMConfig)
);

/**
 * @swagger
 * /api/llm-config:
 *   post:
 *     summary: Create a new LLM configuration
 *     tags: [LLM Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - provider
 *               - model
 *             properties:
 *               name:
 *                 type: string
 *               provider:
 *                 type: string
 *               model:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *               temperature:
 *                 type: number
 *               maxTokens:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Configuration created successfully
 */
router.post(
  '/',
  requireSuperAdmin,
  validate({ body: llmConfigSchemas.create }),
  asyncHandler(llmConfigController.createLLMConfig)
);

/**
 * @swagger
 * /api/llm-config/{id}:
 *   put:
 *     summary: Update an LLM configuration
 *     tags: [LLM Configuration]
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
 *               name:
 *                 type: string
 *               model:
 *                 type: string
 *               temperature:
 *                 type: number
 *     responses:
 *       200:
 *         description: Configuration updated successfully
 */
router.put(
  '/:id',
  requireSuperAdmin,
  validate({ params: llmConfigSchemas.params, body: llmConfigSchemas.update }),
  asyncHandler(llmConfigController.updateLLMConfig)
);

/**
 * @swagger
 * /api/llm-config/{id}:
 *   delete:
 *     summary: Delete an LLM configuration
 *     tags: [LLM Configuration]
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
 *         description: Configuration deleted successfully
 */
router.delete(
  '/:id',
  requireSuperAdmin,
  validate({ params: llmConfigSchemas.params }),
  asyncHandler(llmConfigController.deleteLLMConfig)
);

/**
 * @swagger
 * /api/llm-config/{id}/set-default:
 *   post:
 *     summary: Set configuration as default
 *     tags: [LLM Configuration]
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
 *         description: Default configuration updated
 */
router.post(
  '/:id/set-default',
  requireSuperAdmin,
  validate({ params: llmConfigSchemas.params }),
  asyncHandler(llmConfigController.setDefaultLLMConfig)
);

/**
 * @swagger
 * /api/llm-config/{id}/test:
 *   post:
 *     summary: Test an LLM configuration
 *     tags: [LLM Configuration]
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
 *         description: Test result
 */
router.post(
  '/:id/test',
  requireAdmin,
  validate({ params: llmConfigSchemas.params }),
  asyncHandler(llmConfigController.testLLMConfig)
);

export default router;