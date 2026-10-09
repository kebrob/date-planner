// Usage: npm run auth:hash-password  — prompts without echo and prints the value for AUTH_PASSWORD_HASH.
import { hashPassword } from '../src/auth/password.ts';

function readHidden(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve) => {
    let input = '';
    stdin.on('data', (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          process.stderr.write('\n');
          resolve(input);
          return;
        }
        if (char === '\u0003') process.exit(130);
        input = char === '\u007f' ? input.slice(0, -1) : input + char;
      }
    });
  });
}

const password = await readHidden('Emergency password (min. 16 characters): ');
if (password.length < 16) {
  console.error('Password too short.');
  process.exit(1);
}
const hash = await hashPassword(password);
console.log(hash);
console.error(
  '\nVercel: paste the value above as is.\n.env.local: Next.js expands "$" in env files – escape it:\n' +
    `AUTH_PASSWORD_HASH=${hash.replaceAll('$', '\\$')}`,
);
