#!/usr/bin/env node
// Generates PostgREST-compatible JWTs for anon and service_role.
// Usage: node scripts/generate-jwts.mjs <jwt-secret>
// Outputs JSON: { anonJwt, serviceRoleJwt }

import crypto from 'crypto';

const secret = process.argv[2];
if (!secret) {
  console.error('Usage: node scripts/generate-jwts.mjs <jwt-secret>');
  process.exit(1);
}

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const pay    = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${pay}`).digest('base64url');
  return `${header}.${pay}.${sig}`;
}

const result = {
  anonJwt:        makeJwt({ role: 'anon',         iss: 'eventhub' }),
  serviceRoleJwt: makeJwt({ role: 'service_role', iss: 'eventhub' }),
};
console.log(JSON.stringify(result));
