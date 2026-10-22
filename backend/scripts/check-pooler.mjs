import '../supabaseClient.js';
import { pingDbPooler, rawDbUrl, normalizePoolerUrl } from '../dbPooler.js';

const raw = rawDbUrl();
const parsed = new URL(raw.replace(/^postgres:/i, 'postgresql:'));
const shape = {
  user_form: parsed.username.includes('.') ? 'postgres.ref' : parsed.username,
  database: parsed.pathname,
  port: parsed.port,
  password_len: (parsed.password || '').length,
  quoted: raw.startsWith("'") || raw.startsWith('"'),
};
const ping = await pingDbPooler();
console.log(JSON.stringify({ shape, notes: normalizePoolerUrl(raw).notes, ping }));
