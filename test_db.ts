import { supabase } from './server/db';
async function test() {
  console.log("Supabase config:", process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY ? "key exists" : "missing");
  const { data, error } = await supabase.from('videos').select('title, link, channel_id, video_id, thumbnail_url, video_type').limit(10);
  console.log(error || data);
}
test();
