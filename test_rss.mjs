import Parser from 'rss-parser';

async function testRSS() {
    const rssUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA';

    // Test 1: Standard fetch
    try {
        const res1 = await fetch(rssUrl);
        console.log('Standard fetch status:', res1.status);
    } catch (err) {
        console.log('Standard fetch failed', err.message);
    }

    // Test 2: Fetch with headers
    try {
        const res2 = await fetch(rssUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        });
        console.log('Header fetch status:', res2.status);
    } catch (err) {
        console.log('Header fetch failed', err.message);
    }

    // Test 3: rss-parser with customHeaders
    try {
        const parser = new Parser({
            customFields: {
                item: ['yt:videoId', 'media:group']
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        });
        const feed = await parser.parseURL(rssUrl);
        console.log('rss-parser with headers success! Title:', feed.title);
    } catch (err) {
        console.log('rss-parser with headers failed:', err.message);
    }
}

testRSS();
