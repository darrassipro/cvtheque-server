import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { connectDatabase, syncDatabase } from './models/index.js';
import { logger } from './utils/logger.js';
import { seedSuperAdmin } from './scripts/seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  try {
    // Connect to database
    logger.info('Connecting to database...');
    await connectDatabase();

    // Sync database models (only if SEQUELIZE_SYNC is enabled)
    if (config.database.sync) {
      logger.info('Synchronizing database models...');
      await syncDatabase(false);
    } else {
      logger.info('⏭️  Database sync skipped (SEQUELIZE_SYNC=false in .env)');
    }

    // Seed superadmin if needed
    await seedSuperAdmin();

    // Create Express app
    const app = createApp();

    // Create HTTP server (always available)
    const httpServer = http.createServer(app);
    httpServer.listen(config.server.port, config.server.host, () => {
      logger.info(`🚀 HTTP Server running at http://${config.server.host}:${config.server.port}`);
      logger.info(`📚 API Documentation: http://${config.server.host}:${config.server.port}/api-docs`);
    });

    // Create HTTPS server if certificates exist
    const certPath = config.ssl.certPath || path.resolve(__dirname, '../certs/server.cert');
    const keyPath = config.ssl.keyPath || path.resolve(__dirname, '../certs/server.key');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };

      const httpsServer = https.createServer(httpsOptions, app);
      httpsServer.listen(config.server.httpsPort, config.server.host, () => {
        logger.info(`🔒 HTTPS Server running at https://${config.server.host}:${config.server.httpsPort}`);
      });
    } else {
      logger.warn('⚠️  SSL certificates not found. HTTPS server not started.');
      logger.info(`   Generate certificates with: npm run generate-certs`);
      logger.info(`   Expected paths: ${certPath}, ${keyPath}`);
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`\n${signal} received. Shutting down gracefully...`);
      
      httpServer.close(() => {
        logger.info('HTTP server closed');
      });

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();