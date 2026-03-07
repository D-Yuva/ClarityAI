import { YoutubeTranscript } from 'youtube-transcript';

async function test() {
    const url = "https://www.youtube.com/watch?v=mjEJwHmZbYc";
    console.log(`Testing youtube-transcript...`);
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(url);
      console.log(`Success! Extracted ${transcript.length} parts.`);
    } catch (e) {
      console.log('Failed', e.message);
    }
}

test();
