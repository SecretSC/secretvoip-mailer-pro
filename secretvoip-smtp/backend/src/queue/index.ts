import { Queue, QueueEvents } from 'bullmq';
import { bullConnection } from '../redis';

export const CAMPAIGN_QUEUE = 'smtp-campaign';

export interface SendJob {
  recipientId: string;
  campaignId: string;
  userId: string;
}

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
