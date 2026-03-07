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
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
    if (!playerResponseMatch) return console.warn("No player response");
    
    let data = JSON.parse(playerResponseMatch[1]);
    const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    let track = captions.find((c: any) => c.kind === "asr" && c.languageCode === "en") || captions[0];

    console.log(`Track URL: ${track.baseUrl}`);
    
    const xmlResponse = await fetch(track.baseUrl + '&fmt=vtt');
    const vttText = await xmlResponse.text();
    console.log(`VTT Format Response:\n${vttText.substring(0, 500)}`);
    
    const xmlResponse3 = await fetch(track.baseUrl + '&fmt=xml3');
    const xml3Text = await xmlResponse3.text();
    console.log(`XML3 Format Response:\n${xml3Text.substring(0, 500)}`);

    const xmlResponseJson = await fetch(track.baseUrl + '&fmt=json3');
    const json3Text = await xmlResponseJson.text();
    console.log(`JSON3 Format Response:\n${json3Text.substring(0, 500)}`);
}

testVerbose();
