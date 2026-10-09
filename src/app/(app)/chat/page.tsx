import { requireSession } from '@/auth/session';
import { loadHistory } from '@/chat/service';
import { getLimits } from '@/config/limits';
import { Chat } from './chat';

// Claude tool loops can take a while; applies to the server actions used on this page.
export const maxDuration = 120;

export default async function ChatPage() {
  await requireSession();
  return <Chat initial={await loadHistory()} enabled={getLimits().ai.enabled} />;
}
