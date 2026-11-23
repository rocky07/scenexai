// Local AI prompt server: POST /api/ask { prompt, system?, model? } -> { jobId, response }
// Jobs run one at a time through a Redis queue and are answered by Ollama on this machine.
import express from 'express';
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { Ollama } from 'ollama';

// Listens on 3000. The EC2 instance reaches it through the reverse SSH tunnel:
//   ssh ... -R 13000:127.0.0.1:3000 ubuntu@<EC2 IP>
// so the Scenex AI server's LOCAL_AI_URL=http://127.0.0.1:13000/api/ask lands here.
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'qwen2.5:3b';
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS || 120_000);
const QUEUE_NAME = 'ollama-inference';

const app = express();
app.use(express.json({ limit: '1mb' }));

const ollama = new Ollama({ host: OLLAMA_HOST });

// BullMQ needs a separate Redis connection for each of these. The worker and the event listener
// both block while they wait, so sharing one connection makes job-finished events get lost.
const makeConn = () =>
  new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    maxRetriesPerRequest: null,
  });

const aiQueue = new Queue(QUEUE_NAME, { connection: makeConn() });
const queueEvents = new QueueEvents(QUEUE_NAME, { connection: makeConn() });
await queueEvents.waitUntilReady();

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { prompt, system, model } = job.data;
    const response = await ollama.chat({
      model: model || DEFAULT_MODEL,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
      stream: false,
    });
    return response.message.content;
  },
  { connection: makeConn(), concurrency: 1 },
);

worker.on('ready', () => console.log('Worker ready'));
worker.on('active', (job) => console.log(`Job ${job.id} started`));
worker.on('completed', (job) => console.log(`Job ${job.id} done`));
worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err.message));
worker.on('error', (err) => console.error('Worker error:', err.message));

app.post('/api/ask', async (req, res) => {
  const { prompt, system, model, delayMs = 0 } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const job = await aiQueue.add(
      'generate',
      { prompt, system, model },
      { delay: Number(delayMs) || 0, removeOnComplete: 50, removeOnFail: 100 },
    );
    // Give up after JOB_TIMEOUT_MS instead of holding the request open forever.
    const result = await job.waitUntilFinished(queueEvents, JOB_TIMEOUT_MS);
    res.json({ jobId: job.id, response: result });
  } catch (error) {
    console.error('Ask failed:', error.message);
    res.status(502).json({ error: error.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Local AI prompt server on http://${HOST}:${PORT}/api/ask (Ollama at ${OLLAMA_HOST})`);
});
