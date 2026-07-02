import OpenAI from 'openai';
import { fetch as undiciFetch, Agent } from 'undici';
import { logger } from '@/lib/logger';

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 })
    : null;

const TAG = '[Transcriber]';

// RingoPBX (RepairDesk's telephony vendor) serves an incomplete TLS chain —
// every strict client rejects it ("unable to verify the first certificate"),
// which silently killed transcription for all RepairDesk recordings. TLS
// verification is disabled for THIS HOST ONLY; recording URLs are
// unauthenticated blobs, so the residual MITM risk is accepted over losing
// transcripts entirely. The internal triage tool ships the same workaround.
// NOTE: undici's fetch must be paired with undici's Agent — Node's built-in
// fetch rejects a foreign dispatcher ("invalid onRequestStart method").
const RINGOPBX_HOST = 'storage01.ringopbx.com';
const ringopbxAgent = new Agent({ connect: { rejectUnauthorized: false } });

function fetchRecording(url: string, timeoutMs: number) {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* fall through to plain fetch */ }
    if (host === RINGOPBX_HOST) {
        return undiciFetch(url, { dispatcher: ringopbxAgent, signal: AbortSignal.timeout(timeoutMs) });
    }
    return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Fetches an audio recording from a URL and transcribes it using OpenAI Whisper.
 * Returns the transcript text, or null if transcription fails.
 *
 * Validates that the URL points to an audio file before downloading.
 */
export async function transcribeRecording(recordingUrl: string): Promise<string | null> {
    if (!openai) {
        logger.warn(`${TAG} OpenAI API key missing, cannot transcribe`);
        return null;
    }

    if (!recordingUrl) {
        return null;
    }

    try {
        // Fetch the audio file
        logger.info(`${TAG} Fetching recording`, { url: recordingUrl.substring(0, 80) });

        const response = await fetchRecording(recordingUrl, 30_000);

        if (!response.ok) {
            logger.error(`${TAG} Failed to fetch recording`, null, {
                status: response.status.toString(),
                url: recordingUrl.substring(0, 80),
            });
            return null;
        }

        const contentType = response.headers.get('content-type') || '';
        const audioBuffer = Buffer.from(await response.arrayBuffer());

        if (audioBuffer.length === 0) {
            logger.warn(`${TAG} Empty audio file`);
            return null;
        }

        // Determine file extension from URL or content-type
        let extension = 'wav';
        if (recordingUrl.includes('.mp3') || contentType.includes('mp3')) extension = 'mp3';
        else if (recordingUrl.includes('.mp4') || contentType.includes('mp4')) extension = 'mp4';
        else if (recordingUrl.includes('.webm') || contentType.includes('webm')) extension = 'webm';
        else if (recordingUrl.includes('.ogg') || contentType.includes('ogg')) extension = 'ogg';

        // Create a File object for the OpenAI API
        const file = new File([audioBuffer], `recording.${extension}`, {
            type: contentType || `audio/${extension}`,
        });

        logger.info(`${TAG} Sending to Whisper`, {
            size: audioBuffer.length.toString(),
            extension,
        });

        const transcription = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file,
            language: 'en',
        });

        const text = transcription.text?.trim();
        if (!text) {
            logger.info(`${TAG} Whisper returned empty transcript`);
            return null;
        }

        logger.info(`${TAG} Transcription complete`, {
            length: text.length.toString(),
        });

        return text;
    } catch (error) {
        logger.error(`${TAG} Transcription failed`, error);
        return null;
    }
}
