import * as cheerio from 'cheerio';

async function testVerbose() {
    const videoId = "mjEJwHmZbYc";
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Fetching ${url}...`);
    
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    });
    
    const html = await response.text();
    console.log(`HTML Length: ${html.length}`);

    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
    if (!playerResponseMatch) {
         console.warn(`[ERROR] Could not find player response for ${videoId}`);
         return;
    }
    console.log(`[SUCCESS] Found ytInitialPlayerResponse`);

    let data;
    try {
        data = JSON.parse(playerResponseMatch[1]);
        console.log(`[SUCCESS] Parsed JSON`);
    } catch (e) {
        console.warn(`[ERROR] JSON Parsing failed`);
        return;
    }
    
    const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captions || captions.length === 0) {
        console.warn(`[ERROR] No captions array found in JSON`);
        return;
    }
    console.log(`[SUCCESS] Found ${captions.length} caption tracks`);
    console.log(captions);

    let track = captions.find((c: any) => c.kind === "asr" && c.languageCode === "en") || 
                captions.find((c: any) => c.languageCode === "en") || 
                captions[0];

    if (!track || !track.baseUrl) {
         console.warn(`[ERROR] No valid caption track URL found in selected track`);
         return;
    }
    console.log(`[SUCCESS] Selected Track Base URL: ${track.baseUrl.substring(0, 50)}...`);

    const xmlResponse = await fetch(track.baseUrl);
    const xmlText = await xmlResponse.text();
    console.log(`[SUCCESS] Downloaded XML length: ${xmlText.length}`);

    const $ = cheerio.load(xmlText, { xmlMode: true });
    const transcript: string[] = [];
    
    $('text').each((_, el) => {
        transcript.push($(el).text().trim());
    });
    console.log(`[SUCCESS] Parsed ${transcript.length} text nodes. Total words: ${transcript.join(' ').split(' ').length}`);
}

testVerbose();
