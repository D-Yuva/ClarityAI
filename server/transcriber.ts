import * as cheerio from 'cheerio';

export async function getTranscript(videoUrl: string): Promise<string> {
    try {
        // Extract video ID from URL
        let videoId = '';
        const match = videoUrl.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/|\/v\/|\/e\/|watch\?v=|&v=)([a-zA-Z0-9_-]{11})/);
        if (match) {
            videoId = match[1];
        } else if (videoUrl.length === 11) {
            videoId = videoUrl;
        } else {
            console.warn(`Could not extract video ID from ${videoUrl}`);
            return "";
        }

        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const html = await response.text();

        // Find the player response JSON
        const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
        if (!playerResponseMatch) {
            console.warn(`Could not find player response for ${videoId}`);
            return "";
        }

        const data = JSON.parse(playerResponseMatch[1]);
        const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (!captions || captions.length === 0) {
            console.warn(`No captions found for ${videoId}`);
            return "";
        }

        // Try to find auto-generated track first, fallback to standard track
        let track = captions.find((c: any) => c.kind === "asr" && c.languageCode === "en") || 
                    captions.find((c: any) => c.languageCode === "en") || 
                    captions[0];

        if (!track || !track.baseUrl) {
             console.warn(`No valid caption track URL for ${videoId}`);
             return "";
        }

        // Fetch XML Captions
        const xmlResponse = await fetch(track.baseUrl);
        const xmlText = await xmlResponse.text();

        // Parse XML to Text using cheerio
        const $ = cheerio.load(xmlText, { xmlMode: true });
        const transcript: string[] = [];
        
        $('text').each((_, el) => {
            transcript.push($(el).text().trim());
        });

        // Some characters like &#39; are html encoded by YouTube XML
        return transcript.join(' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

    } catch (error: any) {
        console.warn(`Could not fetch transcript for ${videoUrl}:`, error.message);
        return "";
    }
}
