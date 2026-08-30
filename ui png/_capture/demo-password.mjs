// The demo account password is a credential: read it from backend/.env (which is
// gitignored) or DEMO_PASSWORD, never hard-code it into a committed script.
import { readFileSync } from 'node:fs';

export function demoPassword() {
  if (process.env.DEMO_PASSWORD) return process.env.DEMO_PASSWORD;
  try {
    const env = readFileSync('C:/Users/natsu/Desktop/Osama/backend/.env', 'utf8');
    const match = env.match(/^DEMO_PASSWORD=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    /* fall through to the error below */
  }
  throw new Error('DEMO_PASSWORD not found - set it in the environment or in backend/.env');
}
