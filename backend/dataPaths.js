import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Local scratch dir. Render and Vercel disks are wiped on restart; Supabase is the database. */
export function getDataDir() {
  if (process.env.VERCEL) {
    return path.join('/tmp', 'schootype-data');
  }
  return path.join(__dirname, 'data');
}
