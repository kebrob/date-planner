import { z } from 'zod';
import { MAX_ITEMS } from '@/core/planner/build-plan';
import { PLAN_WARNINGS } from '@/core/planner/types';

const https = z
  .string()
  .max(1000)
  .regex(/^https:\/\/\S+$/, 'https link');
const isoTime = z.iso.datetime({ offset: true });
// Venue websites from providers are sometimes plain http; anything else is dropped, not rejected.
const website = z
  .string()
  .max(1000)
  .regex(/^https?:\/\/\S+$/)
  .optional()
  .catch(undefined);

export const placeSchema = z.object({
  provider: z.enum(['google', 'osm']),
  id: z.string().max(300),
  name: z.string().max(300),
  location: z.object({ lat: z.number(), lng: z.number() }),
  address: z.string().max(500).optional(),
  rating: z.number().optional(),
  openingHours: z
    .union([
      z.object({ alwaysOpen: z.literal(true) }),
      z.object({
        alwaysOpen: z.literal(false),
        periods: z.array(z.object({ start: z.number(), end: z.number() })).max(50),
      }),
    ])
    .nullable(),
  mapsUrl: https.optional(),
  website,
  pricePerPerson: z.object({ min: z.number(), max: z.number().nullable() }).optional(),
});

const trainLegSchema = z.object({
  line: z.string().max(50),
  category: z.string().max(20),
  regional: z.boolean(),
  from: z.object({ eva: z.string().max(20), name: z.string().max(100) }),
  to: z.object({ eva: z.string().max(20), name: z.string().max(100) }),
  stopId: z.string().max(200),
  leaveAt: isoTime,
  plannedDeparture: isoTime,
  departure: isoTime,
  plannedArrival: isoTime,
  arrival: isoTime,
  platform: z.string().max(20).nullable(),
  plannedPlatform: z.string().max(20).nullable(),
  expected: z.boolean().optional(),
});

const legSchema = z.object({
  minutes: z.number(),
  distanceKm: z.number(),
  mode: z.enum(['walk', 'bike', 'car', 'local_transit', 'train']),
  costEur: z.number(),
  train: trainLegSchema.optional(),
  transfers: z.array(trainLegSchema).max(5).optional(),
  from: z.string().max(300),
  to: z.string().max(300),
  directionsUrl: https.nullable(),
  trainUrl: https.nullable(),
});

/** A plan as the client holds it; checked before it is stored. */
export const planViewSchema = z.object({
  format: z.enum(['single', 'evening', 'day']),
  area: z.string().max(100).nullable(),
  items: z
    .array(
      z.object({
        slot: z.enum(['main', 'meal', 'snack']),
        activityId: z.string().max(100),
        title: z.string().max(200),
        description: z.string().max(2000),
        preparation: z.string().max(500).nullable(),
        atHome: z.boolean(),
        place: placeSchema.nullable(),
        placeName: z.string().max(300).nullable(),
        locationHint: z.string().max(200).nullable(),
        alternatives: z.array(placeSchema).max(2),
        travelBefore: legSchema.nullable(),
        start: isoTime,
        end: isoTime,
        costEur: z.number(),
        openingHoursUnknown: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_ITEMS),
  travelHome: legSchema.nullable(),
  totalCostEur: z.number(),
  overBudgetEur: z.number(),
  weather: z.object({
    reliability: z.enum(['good', 'low', 'none']),
    dry: z.boolean().nullable(),
    minTempC: z.number().nullable(),
    maxTempC: z.number().nullable(),
    conditions: z
      .array(z.enum(['rain', 'snow', 'sunny', 'hot', 'cold', 'windy']))
      .max(6)
      .optional(),
  }),
  warnings: z.array(z.enum(PLAN_WARNINGS)).max(PLAN_WARNINGS.length),
});
