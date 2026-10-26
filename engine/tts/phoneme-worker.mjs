// One espeak instance per language: the phonemizer package keeps the first language it was asked for,
// so every language other than en-us runs in its own worker thread.
import { parentPort, workerData } from 'node:worker_threads';
import { phonemize } from 'phonemizer';

parentPort.on('message', async ({ id, text }) => {
  try {
    parentPort.postMessage({ id, out: await phonemize(text, workerData.lang) });
  } catch (err) {
    parentPort.postMessage({ id, err: err.message });
  }
});
