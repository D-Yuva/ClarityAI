async function test() {
    const videoId = "mjEJwHmZbYc";
    
    // The internal youtubei/v1/player API often bypasses the need for complex cookie handling
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FD11...`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            context: {
                client: {
                    hl: "en",
                    gl: "US",
                    clientName: "WEB",
                    clientVersion: "2.20210721.00.00"
                }
            },
            videoId: videoId
        })
    });
    
    // Actually we don't have the API key to use youtubei directly without scraping the page first.
    // Let's scrape the API key from the html first
    const htmlRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const htmlText = await htmlRes.text();
    const apiKeyMatch = htmlText.match(/"INNERTUBE_API_KEY":"(.*?)"/);
    
    if(!apiKeyMatch) return console.log("No API Key");
    
    console.log(`Key: ${apiKeyMatch[1]}`);
    
    const apiRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKeyMatch[1]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            context: {
                client: {
                    hl: "en",
                    gl: "US",
                    clientName: "WEB",
                    clientVersion: "2.20210721.00.00"
                }
            },
            videoId: videoId
        })
    });
    
    const data = await apiRes.json();
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if(!tracks) return console.log("No tracks found in API response.");
    
    console.log(`Found ${tracks.length} tracks from v1/player.`);
    console.log(tracks[0].baseUrl);
    
    const xml = await fetch(tracks[0].baseUrl + '&fmt=xml3');
    console.log(`XML Length: ${(await xml.text()).length}`);
}

test();
