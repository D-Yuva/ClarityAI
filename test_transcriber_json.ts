import * as cheerio from 'cheerio';

async function testVerbose() {
    const videoId = "mjEJwHmZbYc";
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Fetching ${url}...`);
    
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)'
        }
    });
    
    const html = await response.text();
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
    if (!playerResponseMatch) return console.warn("No player response");
    
    let data = JSON.parse(playerResponseMatch[1]);
    const captions = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    console.log(`Found ${captions.length} tracks.`);
    
    for (const track of captions) {
        console.log(`\nTesting track: ${track.name?.simpleText} (${track.kind})`);
        
        try {
            // Try json3 mapping
             const jsonRes = await fetch(track.baseUrl + '&fmt=json3');
             const jsonData = await jsonRes.json();
             
             if (jsonData.events && jsonData.events.length > 0) {
                 const firstWords = jsonData.events.slice(0, 3).map((e: any) => e.segs?.[0]?.utf8 || '').join(' ');
                 console.log(` [SUCCESS JSON3] Length: ${jsonData.events.length}. First words: ${firstWords}`);
             } else {
                 console.log(` [FAILED JSON3] Empty events list`);
             }
        } catch (e: any) {
            console.log(` [ERROR JSON3] ${e.message}`);
        }
        
    }
}

testVerbose();
