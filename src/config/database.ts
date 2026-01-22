import { Sequelize, Options } from 'sequelize';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

function getSequelizeConfig(): Sequelize {
  logger.info(`Connecting to MySQL database at: ${config.database.host}:${config.database.port}/${config.database.name}`);

  const sequelizeConfig: Options = {
    host: config.database.host,
    port: config.database.port,
    dialect: config.database.dialect,
    logging: config.env === 'development' ? (msg) => logger.debug(msg) : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    },
    dialectOptions: {
      charset: 'utf8mb4',
      dateStrings: true,
      typeCast: true,
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  };

  return new Sequelize(
    config.database.name,
    config.database.user,
    config.database.password,
    sequelizeConfig
  );
}

let sequelize = getSequelizeConfig();

export async function connectDatabase(): Promise<void> {
  try {
    // If sequelize was previously closed, recreate it
    try {
      await sequelize.authenticate();
    } catch (e) {
      sequelize = getSequelizeConfig();
      await sequelize.authenticate();
    }
    logger.info(`✅ Database connection established successfully (MySQL)`);
  } catch (error) {
    logger.error('❌ Unable to connect to database:', error);
    logger.warn('⚠️ Make sure MySQL is running and the database exists.');
    logger.warn(`  Host: ${config.database.host}:${config.database.port}`);
    logger.warn(`  Database: ${config.database.name}`);
    logger.warn(`  User: ${config.database.user}`);
    throw error;
  }
}

export async function syncDatabase(force = false): Promise<void> {
  try {
    await sequelize.sync({
      force,
      alter: !force && config.env === 'development'
    });
    logger.info('✅ Database synchronized successfully');
  } catch (error) {
    logger.error('❌ Database sync failed:', error);
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  try {
    await sequelize.close();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection:', error);
    throw error;
  }
}

export { sequelize };