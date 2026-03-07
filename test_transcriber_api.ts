async function test() {
    const videoId = "mjEJwHmZbYc";
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Fetching ${url}...`);
    
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)'
        }
    });
    
    const html = await response.text();
    
    const captionsMatch = html.match(/"captionTracks":\[(.*?)\]/);
    if (captionsMatch) {
       console.log('Found Raw Tracks');
    } else {
       console.log('No Tracks at all');
    }
}
test();
