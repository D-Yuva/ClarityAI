async function test() {
    const url = `https://rsshub.app/youtube/channel/UCsBjURrPoezykLs9EqgamOA`;
    console.log('Fetching', url);
    try {
        const res = await fetch(url);
        console.log('Status RSSHub:', res.status);
        const text = await res.text();
        console.log('Bytes RSSHub:', text.length);
    } catch (err) {
        console.error(err);
    }
}
test();
