async function testOembedImage() {
    const rs = await fetch('https://www.reddit.com/r/pics/top.json?limit=1', { headers: { 'User-Agent': 'ClarityAI/1.0' } });
    const topJson = await rs.json();
    const url = 'https://www.reddit.com' + topJson.data.children[0].data.permalink;
    console.log('Testing image post:', url);

    const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(oembedUrl, { headers: { 'User-Agent': 'ClarityAI/1.0' } });
    const json = await response.json();
    console.log('oEmbed JSON:', JSON.stringify(json, null, 2));
}

testOembedImage();
