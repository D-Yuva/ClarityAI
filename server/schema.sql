-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create channels table
CREATE TABLE public.channels (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    rss_url TEXT NOT NULL,
    last_checked TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create videos table
CREATE TABLE public.videos (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    channel_id UUID REFERENCES public.channels(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL,
    title TEXT,
    link TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    summary TEXT,
    transcript TEXT,
    video_type TEXT DEFAULT 'longform',
    notified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(channel_id, video_id)
);

-- Create user settings table
CREATE TABLE public.user_settings (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    telegram_bot_token TEXT,
    telegram_chat_id TEXT,
    gemini_api_key TEXT
);

-- Enable RLS
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Policies for Channels
CREATE POLICY "Users can view their own channels" ON public.channels FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own channels" ON public.channels FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own channels" ON public.channels FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own channels" ON public.channels FOR DELETE USING (auth.uid() = user_id);

-- Policies for Videos
CREATE POLICY "Users can view their own videos" ON public.videos FOR SELECT USING (
    channel_id IN (SELECT id FROM public.channels WHERE user_id = auth.uid())
);
CREATE POLICY "Users can insert their own videos" ON public.videos FOR INSERT WITH CHECK (
    channel_id IN (SELECT id FROM public.channels WHERE user_id = auth.uid())
);
CREATE POLICY "Users can update their own videos" ON public.videos FOR UPDATE USING (
    channel_id IN (SELECT id FROM public.channels WHERE user_id = auth.uid())
);
CREATE POLICY "Users can delete their own videos" ON public.videos FOR DELETE USING (
    channel_id IN (SELECT id FROM public.channels WHERE user_id = auth.uid())
);

-- Policies for User Settings
CREATE POLICY "Users can view their own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
