async function test() {
    const ids = [
        'UCsBjURrPoezykLs9EqgamOA', // Fireship
        'UCLA_DiR1FfKNvjuUpBHmylQ', // NASA
        'UCBJycsmduvYEL83R_U4JriQ'  // MKBHD
    ];

    for (const id of ids) {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
        const res = await fetch(url);
        console.log(`ID ${id} status:`, res.status);
    }
}
test();
