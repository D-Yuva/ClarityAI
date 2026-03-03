import { supabase } from './server/db';
async function test() {
  const { data, error } = await supabase.from('videos').select('video_id, link, thumbnail_url').not('thumbnail_url', 'is', null).limit(5);
  console.log(JSON.stringify(data, null, 2));
}
test();
