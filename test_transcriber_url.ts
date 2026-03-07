import * as cheerio from 'cheerio';

async function testVerbose() {
    const videoId = "mjEJwHmZbYc";
    let url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Fetching ${url}...`);
    
    // Some libraries use unpkg or consent cookies, let's try just standard fetch
    const response = await fetch(url);
    const html = await response.text();
    
    // Often there's an encoded and a decoded version
    const playerResponseMatch = html.match(/"captions":({"playerCaptionsTracklistRenderer":{.*?}})/);
    if (!playerResponseMatch) return console.warn("No captions JSON found");
    
    let captions = JSON.parse(playerResponseMatch[1]).playerCaptionsTracklistRenderer.captionTracks;
    let track = captions[0];
    
    console.log(`Track URL: ${track.baseUrl}`);
    
    // Try to see what happens when we just fetch it
    const res = await fetch(track.baseUrl);
    console.log(`Status: ${res.status}`);
    console.log(`Body Length: ${(await res.text()).length}`);
}

testVerbose();
