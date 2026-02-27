import * as cheerio from 'cheerio';

async function test(url: string) {
    const response = await fetch(url);
    const text = await response.text();
    const $ = cheerio.load(text);

    const html = $.html();
    const match = html.match(/var ytInitialData = ({.*?});<\/script>/);
    if (match) {
        const data = JSON.parse(match[1]);
        const channelName = data.metadata?.channelMetadataRenderer?.title;
        console.log('Channel:', channelName);

        // Find videos
        let videos = [];
        JSON.stringify(data, (key, value) => {
            if (key === 'gridVideoRenderer' || key === 'videoRenderer' || key === 'richItemRenderer') {
                if (value?.content?.videoRenderer) {
                    videos.push(value.content.videoRenderer);
                } else if (value?.videoId) {
                    videos.push(value);
                }
            }
            return value;
        });

        console.log('Found', videos.length, 'videos');
        if (videos.length) {
            const v = videos[0];
            console.log('ID:', v.videoId);
            console.log('Title:', v.title?.runs?.[0]?.text || v.title?.simpleText);
            console.log('Published:', v.publishedTimeText?.simpleText);
        }
    }
}

test('https://www.youtube.com/@Fireship');
