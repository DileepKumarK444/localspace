import { execSync } from 'node:child_process';

/** The server serves the built web app, so make sure it matches the current source. */
export default function globalSetup() {
  execSync('npm run build -w @localspace/web', { stdio: 'pipe' });
}
