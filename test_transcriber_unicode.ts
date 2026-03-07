import * as cheerio from 'cheerio';

async function testVerbose() {
    const videoId = "mjEJwHmZbYc";
    let url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Fetching ${url}...`);
    
    // Simulate what python requests does exactly
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.5',
        }
    });
    
    const html = await response.text();
    
    // Exact match from standard implementation
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
    if (!playerResponseMatch) return console.warn("No player response");
    
    let data;
    try {
        data = JSON.parse(playerResponseMatch[1]);
    } catch(e) {
        return console.error("JSON parse failed", e.message);
    }
    
    const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if (!captions) return console.log("No captionTracks array");
    
    console.log(`Found ${captions.length} tracks.`);
    
    for (const track of captions) {
        console.log(`\nURL: ${track.baseUrl}`);
        
        let trackUrl = track.baseUrl;
        
        // Sometimes signatures get escaped differently in python vs JS parsing.
        // Let's decode unicode explicitly just in case it's double escaped
        trackUrl = trackUrl.replace(/\\u0026/g, '&');
        
        const xmlResponse = await fetch(trackUrl + '&fmt=xml3');
        const xmlText = await xmlResponse.text();
        console.log(` XML Length: ${xmlText.length}`);
        if(xmlText.length > 0) {
           console.log(` Preview: ${xmlText.substring(0, 100)}`);
        }
    }
}

testVerbose();
