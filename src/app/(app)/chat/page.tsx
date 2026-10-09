import { requireSession } from '@/auth/session';
import { loadHistory } from '@/chat/service';
import { getLimits } from '@/config/limits';
import { ChatScreen } from './chat-screen';

// Claude tool loops can take a while; applies to the server actions used on this page.
export const maxDuration = 120;

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const { q } = await searchParams;
  return (
    <ChatScreen
      history={await loadHistory()}
      enabled={getLimits().ai.enabled}
      initialQuery={q?.slice(0, 1000)}
    />
  );
}
