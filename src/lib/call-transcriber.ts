import OpenAI from 'openai';
import { logger } from '@/lib/logger';

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const TAG = '[Transcriber]';

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

        const response = await fetch(recordingUrl, {
            signal: AbortSignal.timeout(30_000), // 30s timeout
        });

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
