import('dotenv/config');
async function run() {
const { supabase } = await import('./server/db.js');
const { data, error } = await supabase.from('videos').select('title, link, channel_id, video_id, thumbnail_url').neq('thumbnail_url', '').limit(5);
console.log(data);
}
run();
