import { YoutubeTranscript } from 'youtube-transcript';

export async function getTranscript(videoUrl: string): Promise<string> {
    try {
        const transcript = await YoutubeTranscript.fetchTranscript(videoUrl);
        return transcript.map(t => t.text).join(' ');
    } catch (error: any) {
        console.warn(`Could not fetch transcript for ${videoUrl}:`, error.message);
        return "";
    }
}
