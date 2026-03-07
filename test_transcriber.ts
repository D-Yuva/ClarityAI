import { getTranscript } from './server/transcriber.js';

async function test() {
    const url = "https://www.youtube.com/watch?v=mjEJwHmZbYc";
    console.log(`Testing transcript extraction for: ${url}`);
    const transcript = await getTranscript(url);
    
    if (transcript) {
        console.log(`Success! Extracted ${transcript.length} characters.`);
        console.log(`Preview: "${transcript.substring(0, 150)}..."`);
    } else {
        console.log("Failed to extract transcript. Returned empty string.");
    }
}

test();
