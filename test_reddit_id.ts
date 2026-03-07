import { supabase } from './server/db';
async function test() {
  const { data } = await supabase.from('videos').select('video_id, link').ilike('link', '%reddit.com%').limit(5);
  console.log("Reddit Videos in DB:", data);
}
test();
