import { Queue, QueueEvents } from 'bullmq';
import { bullConnection } from '../redis';

export const CAMPAIGN_QUEUE = 'smtp-campaign';

export interface SendJob {
  recipientId: string;
  campaignId: string;
  userId: string;
}

console.log('QUEUE INIT name=' + CAMPAIGN_QUEUE);

export const campaignQueue = new Queue<SendJob>(CAMPAIGN_QUEUE, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 86400 },
  },
});

export const campaignEvents = new QueueEvents(CAMPAIGN_QUEUE, { connection: bullConnection });

// Track QueueEvents connection state for diagnostics
export const queueEventsState: { ready: boolean; lastError?: string; lastErrorAt?: number } = { ready: false };
campaignEvents.on('error', (err: any) => {
  queueEventsState.ready = false;
  queueEventsState.lastError = err?.message ?? String(err);
  queueEventsState.lastErrorAt = Date.now();
  console.error('QUEUE EVENTS ERROR', err);
});
campaignEvents.waitUntilReady().then(() => {
  queueEventsState.ready = true;
  console.log('QUEUE EVENTS READY');
}).catch((err) => {
  queueEventsState.lastError = err?.message ?? String(err);
  queueEventsState.lastErrorAt = Date.now();
  console.error('QUEUE EVENTS NOT READY', err);
});
