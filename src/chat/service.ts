import { and, asc, desc, eq, gte, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { getGeocoder, getWeatherProvider } from '@/adapters';
import { getSettings } from '@/admin/service';
import {
  chatTools,
  runChat,
  systemPrompt,
  type ChatToolHandlers,
  type ChatTurn,
  MAX_HISTORY_TURNS,
  ToolUserError,
} from '@/ai/chat';
import { createMessageUntil, MODEL } from '@/ai/client';
import { toActivityInsert, withoutDuplicates } from '@/ai/ideas';
import { getLimits } from '@/config/limits';
import { summarizeWeather } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import { activity, chatMessage } from '@/db/schema';
import { getCostGuard } from '@/guard';
import { fromLocal, localParts, toLocalDate, toLocalTime } from '@/lib/time';
import { listUpcoming } from '@/planner/saved';
import { AreaNotFoundError, generatePlan, homePoint, type PlanInput } from '@/planner/service';
import { toPlanView, type PlanView } from '@/planner/view';

export type ChatPlan = { input: PlanInput; view: PlanView };
export type ChatReply = { text: string; plans: ChatPlan[] };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_MESSAGE_LENGTH = 1_000;
// Within the chat page's 120 s function limit, leaving time to store the reply.
const CHAT_TIME_BUDGET_MS = 105_000;

function addDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

function planSummary(view: PlanView, index: number): string {
  const time = (iso: string) => toLocalTime(new Date(iso));
  const items = view.items
    .map(
      (i) =>
        `${time(i.start)}–${time(i.end)} ${i.title}${i.place ? ` at ${i.place.name}` : i.atHome ? ' at home' : ''}`,
    )
    .join('; ');
  const warnings = view.warnings.length ? ` Warnings: ${view.warnings.join(', ')}.` : '';
  return `Plan ${index} (shown to the user as a card): ${items}. Total ~${view.totalCostEur} €.${warnings}`;
}

function handlers(collected: ChatPlan[]): ChatToolHandlers {
  return {
    planDate: async (i) => {
      const home = await getSettings();
      const endDate = i.end_date ?? (i.end_time <= i.start_time ? addDay(i.date) : i.date);
      const input: PlanInput = {
        date: i.date,
        startTime: i.start_time,
        endDate,
        endTime: i.end_time,
        budgetEur: i.budget_eur ?? home.defaultBudgetEur,
        transport: i.transport ?? home.defaultTransport,
        preferences: i.moods,
        food: i.food ?? 'auto',
        cuisine: i.cuisine,
        area: i.area ?? undefined,
        maxDistanceKm: i.max_distance_km,
        requiredStops: i.must_include.map((m) => ({
          title: m.title,
          searchQuery: m.search_query,
          kind: m.kind,
          durationMinutes: m.duration_minutes,
          costEur: m.cost_eur,
        })),
        excludeActivityIds: [],
      };
      const { plan, area } = await generatePlan(input).catch((error: unknown) => {
        if (error instanceof AreaNotFoundError) {
          throw new ToolUserError(
            `Town "${error.query}" not found; ask the user for another name.`,
          );
        }
        throw error;
      });
      const view = toPlanView(plan, homePoint(home), area);
      collected.push({ input, view });
      return planSummary(view, collected.length);
    },
    weather: async (i) => {
      const home = await getSettings();
      const place = i.town ? await getGeocoder().find(i.town) : null;
      if (i.town && !place) {
        throw new ToolUserError(`Town "${i.town}" not found; ask the user for another name.`);
      }
      const location = place?.location ?? { lat: home.homeLat, lng: home.homeLng };
      const from = fromLocal(i.date, '08:00');
      const to = fromLocal(i.date, '22:00');
      const hours = await getWeatherProvider().hourly(location, from, to);
      const w = summarizeWeather(hours, from, to, new Date());
      if (w.reliability === 'none')
        return 'No forecast available for that date (max. 16 days ahead).';
      return `${place?.name ?? home.homeName} on ${i.date}: ${w.dry ? 'mostly dry' : 'rain likely'}, ${Math.round(w.minTempC!)}–${Math.round(w.maxTempC!)} °C${w.reliability === 'low' ? ' (uncertain, more than a week ahead)' : ''}.`;
    },
    findIdeas: async (i) => {
      const filters = [eq(activity.status, 'active')];
      if (i.query) {
        const q = `%${i.query.replace(/[%_]/g, '')}%`;
        filters.push(or(ilike(activity.title, q), ilike(activity.description, q))!);
      }
      if (i.kind === 'home') filters.push(eq(activity.atHome, true));
      else if (i.kind === 'activity') filters.push(eq(activity.category, 'activity'));
      const rows = await getDb()
        .select()
        .from(activity)
        .where(and(...filters))
        .orderBy(asc(activity.title))
        .limit(40);
      const matching = rows
        .filter((r) => (i.kind === 'meal' || i.kind === 'snack' ? r.tags.includes(i.kind) : true))
        .slice(0, 15);
      if (matching.length === 0) return 'No matching ideas in the catalog.';
      return matching
        .map(
          (r) =>
            `${r.title} – ${r.costMinEur}–${r.costMaxEur} €, ${r.durationMinutes} min, ${r.tags.join('/')}`,
        )
        .join('\n');
    },
    saveIdea: async (i) => {
      const existing = (await getDb().select({ title: activity.title }).from(activity)).map(
        (r) => r.title,
      );
      const idea = {
        title: i.title,
        description: i.description,
        kind: i.kind,
        cuisine: i.cuisine,
        tags: i.tags,
        costMinEur: i.cost_min_eur,
        costMaxEur: i.cost_max_eur,
        durationMinutes: i.duration_minutes,
        atHome: i.at_home,
        placeType: i.place_type,
        placeQuery: i.place_query,
        dryOnly: i.dry_only,
        minTempC: null,
        timesOfDay: [],
        seasons: [],
        preparation: null,
      };
      if (withoutDuplicates([idea], existing).length === 0) return `"${i.title}" already exists.`;
      await getDb().insert(activity).values(toActivityInsert(idea, 'claude'));
      return `Saved "${i.title}" as a draft; it appears in the admin area for review.`;
    },
    listPlans: async () => {
      const plans = await listUpcoming();
      if (plans.length === 0) return 'No upcoming saved plans.';
      return plans
        .map(
          (p) =>
            `${toLocalDate(p.startsAt)} ${toLocalTime(p.startsAt)}: ${p.titles.join(' → ')} (~${p.totalCostEur} €)`,
        )
        .join('\n');
    },
  };
}

export async function loadHistory(): Promise<ChatTurn[]> {
  const rows = await getDb()
    .select()
    .from(chatMessage)
    .orderBy(desc(chatMessage.createdAt))
    .limit(50);
  return rows
    .reverse()
    .map((r) => ({ role: r.role as ChatTurn['role'], text: (r.content as { text: string }).text }));
}

/** Removes the latest user message and everything after it, so it can be edited and resent. */
export async function undoLastTurn(): Promise<string | null> {
  const db = getDb();
  const [lastUser] = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.role, 'user'))
    .orderBy(desc(chatMessage.createdAt))
    .limit(1);
  if (!lastUser) return null;
  await db.delete(chatMessage).where(gte(chatMessage.createdAt, lastUser.createdAt));
  return (lastUser.content as { text: string }).text;
}

export async function clearHistory(): Promise<void> {
  await getDb().delete(chatMessage);
}

export class ChatDisabledError extends Error {}

export async function sendChatMessage(raw: string): Promise<ChatReply> {
  const message = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).parse(raw);
  const limits = getLimits();
  if (!limits.ai.enabled) throw new ChatDisabledError();

  const now = new Date();
  const deadline = now.getTime() + CHAT_TIME_BUDGET_MS;
  const [home, history] = await Promise.all([getSettings(), loadHistory()]);
  const plans: ChatPlan[] = [];
  const result = await runChat(history.slice(-MAX_HISTORY_TURNS), message, {
    createMessage: createMessageUntil(deadline),
    guard: getCostGuard(),
    model: MODEL,
    tools: chatTools(handlers(plans)),
    system: systemPrompt({
      homeName: home.homeName,
      defaultBudgetEur: home.defaultBudgetEur,
      defaultTransport: home.defaultTransport,
      today: toLocalDate(now),
      weekday: WEEKDAYS[localParts(now).weekday]!,
    }),
    maxIterations: limits.ai.maxToolIterations,
    maxWebSearches: limits.ai.maxWebSearches.chat,
  });

  const text = result.text || (plans.length ? 'Here you go:' : 'Sorry, I have no answer to that.');
  // Only text is stored; plan cards contain provider data that is not kept long-term.
  const at = now;
  await getDb()
    .insert(chatMessage)
    .values([
      { role: 'user', content: { text: message }, createdAt: at },
      { role: 'assistant', content: { text }, createdAt: new Date(at.getTime() + 1) },
    ]);
  return { text, plans };
}
