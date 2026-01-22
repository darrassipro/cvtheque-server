#!/usr/bin/env node

/**
 * Setup Test Database
 * Creates the test database if it doesn't exist
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test environment
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'cvtech_test';

async function setupTestDatabase() {
  let connection;
  
  try {
    console.log('🔧 Setting up test database...');
    console.log(`   Host: ${DB_HOST}:${DB_PORT}`);
    console.log(`   User: ${DB_USER}`);
    console.log(`   Database: ${DB_NAME}`);

    // Connect without database
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
    });

    console.log('✅ Connected to MySQL server');

    // Drop database if exists (clean slate for tests)
    await connection.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    console.log(`🗑️  Dropped existing database: ${DB_NAME}`);

    // Create database
    await connection.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✅ Created test database: ${DB_NAME}`);

    console.log('✅ Test database setup complete!');
  } catch (error: any) {
    console.error('❌ Failed to setup test database:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n⚠️  Cannot connect to MySQL server.');
      console.error('   Make sure MySQL is running and accessible at:');
      console.error(`   ${DB_HOST}:${DB_PORT}`);
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\n⚠️  Access denied.');
      console.error('   Check your MySQL credentials in .env.test:');
      console.error(`   User: ${DB_USER}`);
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

setupTestDatabase();