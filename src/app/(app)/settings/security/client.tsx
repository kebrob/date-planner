'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deletePasskeyAction, signOutEverywhereAction } from '../../actions';

export function AddPasskey() {
  const router = useRouter();
  const [deviceName, setDeviceName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      const optionsRes = await fetch('/api/auth/passkey/register-options', { method: 'POST' });
      if (!optionsRes.ok) {
        const body = (await optionsRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not start registration');
      }
      const response = await startRegistration({ optionsJSON: await optionsRes.json() });
      const res = await fetch('/api/auth/passkey/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceName, response }),
      });
      if (!res.ok) throw new Error('Passkey registration failed');
      setDeviceName('');
      setMessage('Passkey added.');
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Passkey registration failed');
    }
  }

  return (
    <form onSubmit={add} className="flex gap-2">
      <input
        value={deviceName}
        onChange={(e) => setDeviceName(e.target.value)}
        placeholder="Device name, e.g. Robert's iPhone"
        maxLength={60}
        required
        className="flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm"
      />
      <button className="rounded-lg bg-ink px-3 py-2 text-sm text-white hover:bg-ink/85">
        Add passkey
      </button>
      {message && <p className="text-sm text-mist">{message}</p>}
    </form>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.replace('/login');
      }}
      className="self-start text-sm text-mist underline"
    >
      Sign out
    </button>
  );
}

export function DeletePasskey({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Remove passkey "${name}"? Devices signed in with it are signed out.`)) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const result = await deletePasskeyAction(id);
            if (!result.ok) setError(result.error);
            else router.refresh();
          });
        }}
        className="text-sm text-red-600 disabled:opacity-50"
      >
        Remove
      </button>
      {error && (
        <span role="alert" className="text-right text-xs text-mist">
          {error}
        </span>
      )}
    </span>
  );
}

export function SignOutEverywhere() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm('Sign out on all devices, including this one?')) {
          startTransition(() => signOutEverywhereAction());
        }
      }}
      className="self-start text-sm text-mist underline disabled:opacity-50"
    >
      Sign out on all devices
    </button>
  );
}
