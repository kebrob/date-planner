'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data;
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  const loginWithPasskey = () =>
    run(async () => {
      const optionsJSON = await post('/api/auth/passkey/login-options');
      await post('/api/auth/passkey/login', await startAuthentication({ optionsJSON }));
    });

  const loginWithPassword = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      await post('/api/auth/password', { password });
    });
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 p-6">
      <h1 className="text-center text-3xl font-semibold">Date Planner</h1>

      <button
        onClick={loginWithPasskey}
        disabled={busy}
        className="rounded-full bg-ink px-5 py-3.5 font-medium text-white disabled:opacity-50 hover:bg-ink/85"
      >
        Sign in with passkey
      </button>

      <details className="text-sm">
        <summary className="cursor-pointer text-mist">Use emergency password</summary>
        <form onSubmit={loginWithPassword} className="mt-3 flex flex-col gap-3">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-line bg-transparent px-3 py-2"
            placeholder="Password"
            required
          />
          <button
            disabled={busy}
            className="rounded-lg border border-line px-3 py-2 hover:bg-cream"
          >
            Sign in
          </button>
        </form>
      </details>

      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </main>
  );
}
