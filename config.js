// To get access to environment variables stored in .env
require('dotenv').config();

// Environment variables (add validation?)
exports.dbUrl = process.env.DATABASE_URL || 3000;

// JWT signing key
exports.secretKey = process.env.SECRET_KEY || 'changeme';
exports.bcryptCostFactor = 10;