import * as cheerio from 'cheerio';

async function test(url: string) {
    console.log('Testing URL:', url);
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }
    const response = await fetch(url);
    const text = await response.text();
    const $ = cheerio.load(text);

    let channelId = $('meta[itemprop="channelId"]').attr('content');
    console.log('Attempt 1 (meta):', channelId);

    if (!channelId) {
        const canonicalLink = $('link[rel="canonical"]').attr('href');
        if (canonicalLink && canonicalLink.includes('/channel/')) {
            channelId = canonicalLink.split('/channel/')[1];
        }
        console.log('Attempt 2 (canonical):', channelId);
    }

    if (!channelId) {
        const htmlContent = $.html();
        const match = htmlContent.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/);
        if (match && match[1]) {
            channelId = match[1];
        }
        console.log('Attempt 3 (regex):', channelId);
    }
    console.log('Final channelId:', channelId);

    if (channelId) {
        console.log('RSS URL:', `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);

        try {
            const rssFetch = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
            console.log('RSS Feed Status:', rssFetch.status);
        } catch (err) {
            console.log('RSS Fetch Error', err);
        }
    }
}

test('https://www.youtube.com/@Fireship');
