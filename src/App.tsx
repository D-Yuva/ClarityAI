import React, { useState, useEffect } from 'react';
import { Trash2, Plus, Settings, ExternalLink, RefreshCw, Sparkles, Key, LogOut, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { supabaseClient } from './lib/supabase';
import Auth from './components/Auth';
import { Session } from '@supabase/supabase-js';

interface Channel {
  id: string;
  name: string;
  url: string;
  last_checked: string;
}

interface Video {
  id: string;
  title: string;
  channels?: { name: string };
  summary: string;
  link: string;
  published_at: string;
  video_type?: 'short' | 'longform';
  transcript?: string;
  qaHistory?: { question: string, answer: string }[];
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div className="min-h-screen bg-stone-100 flex items-center justify-center">Loading...</div>;

  if (!session) {
    return <Auth onLogin={() => { }} />;
  }

  return <Dashboard session={session} />;
}

function Dashboard({ session }: { session: Session }) {
  const [activeTab, setActiveTab] = useState<'feed' | 'channels' | 'settings'>('feed');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [newChannelUrl, setNewChannelUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
  const [isSummarizing, setIsSummarizing] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState<string | null>(null);
  const [questions, setQuestions] = useState<{ [videoId: string]: string }>({});

  const [settings, setSettings] = useState({
    telegram_bot_token: '',
    telegram_chat_id: '',
    gemini_api_key: ''
  });

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([fetchChannels(), fetchVideos(), fetchSettings()]);
      } catch (err) {
        console.error("Initialization error:", err);
      }
    };
    init();

    // Poll for new videos every 30s
    const interval = setInterval(fetchVideos, 30000);
    return () => clearInterval(interval);
  }, []);

  const saveApiKeyLocally = (key: string) => {
    setUserApiKey(key);
    localStorage.setItem('GEMINI_API_KEY', key);
    setSettings(prev => ({ ...prev, gemini_api_key: key }));
  };

  // Auto-generation disabled: User wants to manually generate summaries

  const generateSummary = async (video: Video) => {
    if (!userApiKey) {
      if (isSummarizing === video.id) {
        alert("Please enter your Gemini API Key in Settings first!");
        setActiveTab('settings');
      }
      return;
    }

    setIsSummarizing(video.id);
    try {
      const ai = new GoogleGenAI({ apiKey: userApiKey });
      const prompt = `
        Analyze the following link (video or post) and provide a concise, engaging summary (under 50 words).
        Focus on what the viewer or reader will learn or experience.
        Title: ${video.title}
        Link: ${video.link}

        Content/Transcript:
        ${video.transcript || video.summary || "No content available. Infer strictly from title."}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const summaryText = response.text || "Could not generate summary.";

      setVideos(prev => prev.map(v => v.id === video.id ? { ...v, summary: summaryText } : v));

      // Use backend API to save summary AND trigger telegram notification
      await fetch(`/api/videos/${video.id}/summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ summary: summaryText })
      });

    } catch (err: any) {
      console.error("Summarization failed:", err);
    } finally {
      setIsSummarizing(null);
    }
  };

  const askQuestion = async (video: Video) => {
    if (!userApiKey) {
      alert("Please enter your Gemini API Key in Settings first!");
      setActiveTab('settings');
      return;
    }

    const questionText = questions[video.id]?.trim();
    if (!questionText) return;

    setIsAsking(video.id);
    try {
      const ai = new GoogleGenAI({ apiKey: userApiKey });
      const prompt = `
        You are GlimpseAI, an expert technical assistant designed to analyze transcripts and post contents. 
        A user is asking a question about the content titled: "${video.title}".

        INSTRUCTIONS:
        1. Base your answer STRICTLY and EXCLUSIVELY on the provided transcript/content below. Do NOT use outside knowledge or hallucinate details.
        2. If the user asks for a summary, deep dive, or general overview: Provide a concise, engaging summary focusing on what the viewer will learn or experience.
        3. If the user asks a specific question: Find the answer in the transcript/content. Be highly specific, info-dense, and provide exact facts or quotes.
        4. If the transcript/content DOES NOT contain the answer to a specific question, you MUST reply exactly with: "The content does not mention this." Do not attempt to guess.

        User Input: "${questionText}"

        --- CONTENT START ---
        ${video.transcript || video.summary || "No content available."}
        --- CONTENT END ---
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const answerText = response.text || "Could not generate answer.";

      setVideos(prev => prev.map(v => {
        if (v.id === video.id) {
          return {
            ...v,
            qaHistory: [...(v.qaHistory || []), { question: questionText, answer: answerText }]
          };
        }
        return v;
      }));

      // Clear input
      setQuestions(prev => ({ ...prev, [video.id]: "" }));

    } catch (err: any) {
      console.error("Q&A failed:", err);
      alert("Failed to answer question. Check console.");
    } finally {
      setIsAsking(null);
    }
  };

  const getVideoType = (video: Video): 'short' | 'longform' => {
    if (video.video_type) return video.video_type;
    if (video.title.toLowerCase().includes('#shorts')) return 'short';
    if (video.link.includes('/shorts/')) return 'short';
    return 'longform';
  };

  const fetchChannels = async () => {
    const { data } = await supabaseClient.from('channels').select('*').order('created_at', { ascending: false });
    if (data) setChannels(data);
  };

  const fetchVideos = async () => {
    const { data, error } = await supabaseClient
      .from('videos')
      .select('*, channels(name)')
      .order('published_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error("Supabase error fetching videos:", error);
    }

    if (data) setVideos(data as any[]);
  };

  const fetchSettings = async () => {
    const { data, error } = await supabaseClient.from('user_settings').select('*').eq('user_id', session.user.id).maybeSingle();
    if (data) {
      setSettings(prev => ({
        ...prev,
        telegram_bot_token: data.telegram_bot_token || '',
        telegram_chat_id: data.telegram_chat_id || '',
        gemini_api_key: data.gemini_api_key || ''
      }));
      if (data.gemini_api_key && !userApiKey) {
        saveApiKeyLocally(data.gemini_api_key);
      }
    }
  };

  const addChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelUrl) return;
    setIsLoading(true);
    try {
      // Must use backend to parse RSS feed securely avoiding CORS
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ url: newChannelUrl })
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setNewChannelUrl('');
      fetchChannels();
      setTimeout(fetchVideos, 2000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteChannel = async (id: string) => {
    if (!confirm('Are you sure?')) return;
    await supabaseClient.from('channels').delete().eq('id', id);
    fetchChannels();
    fetchVideos();
  };

  const saveSettingsToCloud = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabaseClient.from('user_settings').upsert({
      user_id: session.user.id,
      ...settings,
      gemini_api_key: userApiKey // ensure local key is synced to cloud for backend use
    });
    if (error) {
      console.error("Save settings error:", error);
      alert("Failed to save settings: " + error.message);
      return;
    }
    alert('Settings saved to cloud!');
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const triggerRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      await fetchVideos();
      await fetchChannels();
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-stone-50 text-stone-900 font-sans">
      <header className="w-full bg-white border-b border-stone-200 sticky top-0 z-10 flex justify-center">
        <div className="w-full max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold">GA</div>
            <h1 className="text-xl font-bold tracking-tight">GlimpseAI</h1>
          </div>
          <nav className="flex gap-1 bg-stone-100 p-1 rounded-lg">
            {['feed', 'channels', 'settings'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === tab
                  ? 'bg-white text-black shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
                  }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="w-full max-w-3xl mx-auto px-4 py-8 flex flex-col">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <p>{error}</p>
            <button onClick={() => window.location.reload()} className="ml-auto text-sm underline hover:text-red-900">Retry</button>
          </div>
        )}
        <AnimatePresence mode="wait">
          {activeTab === 'feed' && (
            <motion.div
              key="feed"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Latest Summaries</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={triggerRefresh}
                    disabled={isRefreshing}
                    className="p-2 hover:bg-stone-200 rounded-full transition-colors disabled:opacity-50"
                    title="Check for new videos now"
                  >
                    <RefreshCw size={20} className={isRefreshing ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {videos.length === 0 ? (
                <div className="text-center py-12 text-stone-500 bg-white rounded-2xl border border-stone-200">
                  <p className="mb-4">No videos yet.</p>
                  <button
                    onClick={() => setActiveTab('channels')}
                    className="text-red-600 font-medium hover:underline"
                  >
                    Add some channels to get started →
                  </button>
                </div>
              ) : (
                <div className="grid gap-6">
                  {videos.map((video) => (
                    <article key={video.id} className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-wider text-red-600 mb-1 block">
                            {video.channels?.name || 'Unknown'}
                          </span>
                          <h3 className="text-lg font-bold leading-tight">
                            <a href={video.link} target="_blank" rel="noreferrer" className="hover:underline">
                              {video.title}
                            </a>
                          </h3>
                        </div>
                        <a href={video.link} target="_blank" rel="noreferrer" className="text-stone-400 hover:text-red-600">
                          <ExternalLink size={18} />
                        </a>
                      </div>
                      {video.summary && !video.summary.includes('unavailable') && !video.summary.includes('pending') && !video.summary.includes('failed') && (
                        <div className="bg-stone-50 p-4 rounded-xl text-sm text-stone-700 leading-relaxed border border-stone-100 my-3">
                          {video.summary}
                        </div>
                      )}

                      {/* Q&A Section */}
                      <div className="mt-4 border-t border-stone-100 pt-4">
                        <div className="text-sm font-bold text-stone-800 mb-2 flex items-center gap-2">
                          <Sparkles size={14} className="text-purple-600" /> Ask AI about this content
                        </div>

                        {/* Q&A History */}
                        {video.qaHistory && video.qaHistory.length > 0 && (
                          <div className="mb-3 space-y-3">
                            {video.qaHistory.map((qa, i) => (
                              <div key={i} className="text-sm space-y-1">
                                <div className="font-medium text-stone-700 bg-stone-100 p-2 rounded-lg inline-block">
                                  Q: {qa.question}
                                </div>
                                <div className="text-stone-600 pl-2 border-l-2 border-purple-200 ml-2">
                                  {qa.answer}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Q&A Input */}
                        <div className="flex gap-2 items-center relative">
                          <input
                            type="text"
                            placeholder="E.g., What are the key takeaways?"
                            className="flex-1 text-sm px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-colors"
                            value={questions[video.id] || ''}
                            onChange={(e) => setQuestions(prev => ({ ...prev, [video.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') askQuestion(video);
                            }}
                            disabled={isAsking === video.id || (!video.summary && !video.transcript)}
                          />
                          <button
                            onClick={() => askQuestion(video)}
                            disabled={isAsking === video.id || !questions[video.id]?.trim() || (!video.summary && !video.transcript)}
                            className="bg-purple-600 text-white px-3 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center justify-center shrink-0"
                          >
                            {isAsking === video.id ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                          </button>
                          {(!video.summary || video.summary.includes('unavailable') || video.summary.includes('pending') || video.summary.includes('failed')) && (
                            <button
                              onClick={() => generateSummary(video)}
                              disabled={isSummarizing === video.id}
                              className="bg-purple-100 text-purple-700 px-3 py-2 rounded-lg hover:bg-purple-200 transition-colors disabled:opacity-50 flex items-center gap-1.5 text-xs font-medium shrink-0 whitespace-nowrap"
                            >
                              {isSummarizing === video.id ? (
                                <RefreshCw className="animate-spin" size={14} />
                              ) : (
                                <Sparkles size={14} />
                              )}
                              Generate Summary
                            </button>
                          )}
                        </div>
                        {(!video.summary && !video.transcript) && (
                          <p className="text-xs text-stone-400 mt-1 italic">Transcript unavailable.</p>
                        )}
                      </div>

                      <div className="mt-4 flex items-center gap-2 text-xs text-stone-400">
                        <span>Published: {new Date(video.published_at).toLocaleString()}</span>
                        {getVideoType(video) === 'short' && (
                          <span className="bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded border border-stone-200">Short</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'channels' && (
            <motion.div
              key="channels"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold">Managed Channels</h2>

              <form onSubmit={addChannel} className="flex gap-2">
                <input
                  type="url"
                  placeholder="Paste YouTube Channel or Reddit URL (e.g. reddit.com/r/reactjs)"
                  className="flex-1 px-4 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                  value={newChannelUrl}
                  onChange={(e) => setNewChannelUrl(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="bg-black text-white px-6 py-2 rounded-xl font-medium hover:bg-stone-800 disabled:opacity-50 flex items-center gap-2"
                >
                  {isLoading ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
                  Add
                </button>
              </form>

              <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
                {channels.map((channel, idx) => (
                  <div key={channel.id} className={`p-4 flex items-center justify-between ${idx !== channels.length - 1 ? 'border-b border-stone-100' : ''}`}>
                    <div>
                      <h3 className="font-bold">{channel.name}</h3>
                      <a href={channel.url} target="_blank" rel="noreferrer" className="text-xs text-stone-500 hover:underline truncate block max-w-md">
                        {channel.url}
                      </a>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-stone-400">
                        Last checked: {channel.last_checked ? new Date(channel.last_checked).toLocaleTimeString() : 'Never'}
                      </span>
                      <button
                        onClick={() => deleteChannel(channel.id)}
                        className="text-stone-400 hover:text-red-600 p-2"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
                {channels.length === 0 && (
                  <div className="p-8 text-center text-stone-500">
                    No channels added yet.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Cloud Settings</h2>
                <button
                  onClick={() => supabaseClient.auth.signOut()}
                  className="text-stone-500 hover:text-red-600 flex items-center gap-2 px-3 py-1 border border-stone-300 rounded-lg text-sm bg-white"
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>

              <form onSubmit={saveSettingsToCloud} className="space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold uppercase">Required for AI</div>
                    <h3 className="text-lg font-bold">Gemini API Key</h3>
                  </div>
                  <p className="text-sm text-stone-600 mb-4">
                    To generate AI summaries, you need to provide your own Google Gemini API Key.
                    It is synced to your cloud account to process summaries in the background even when you are offline.
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                      <input
                        type="password"
                        placeholder="Paste your Gemini API Key here"
                        className="w-full pl-10 pr-4 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        value={userApiKey}
                        onChange={(e) => saveApiKeyLocally(e.target.value)}
                      />
                    </div>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="bg-stone-100 text-stone-700 px-4 py-2 rounded-xl font-medium hover:bg-stone-200 flex items-center gap-2 whitespace-nowrap"
                    >
                      Get Key <ExternalLink size={16} />
                    </a>
                  </div>
                </div>


                <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-lg font-bold">Telegram Notifications</h3>
                  </div>

                  {settings.telegram_chat_id ? (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-800 text-sm mb-6 flex items-start gap-3">
                      <div className="text-xl">✅</div>
                      <div>
                        <p className="font-bold mb-1">Telegram Connected!</p>
                        <p className="opacity-90">Your account is successfully linked. Curated video summaries will be sent automatically to your Telegram.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-stone-600 mb-6 bg-stone-50 p-6 rounded-xl border border-stone-200">
                      <div className="flex items-start gap-4">
                        <div className="bg-blue-100 text-blue-600 p-3 rounded-full hidden sm:block">
                          <Send size={24} />
                        </div>
                        <div>
                          <p className="font-bold text-lg mb-2 text-stone-800">1-Click Setup</p>
                          <p className="mb-4 text-stone-600 text-base">Click the button below to securely connect your Telegram account.</p>
                          {session?.user?.id && (
                            <a
                              href={`https://t.me/${import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'GlimpseAI_Bot'}?start=${session.user.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-[#2AABEE] text-white px-6 py-3 rounded-xl font-bold hover:bg-[#229ED9] inline-flex items-center gap-2 transition-colors"
                            >
                              <Send size={18} /> Connect Telegram
                            </a>
                          )}
                          <p className="text-xs text-stone-500 mt-4 leading-relaxed">
                            <strong>Important:</strong> Telegram will ask you to open the app. Be sure to click the big <strong>"Start"</strong> button at the bottom of the chat to complete the link!
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="pt-2 flex flex-col sm:flex-row gap-2 border-t border-stone-100 mt-4 pt-4">
                    <button
                      type="submit"
                      className="bg-black text-white px-6 py-2 rounded-xl font-medium hover:bg-stone-800 w-full sm:w-auto"
                    >
                      Save Settings
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!settings.telegram_chat_id) {
                          alert('Please connect your Telegram first using the button above!');
                          return;
                        }
                        try {
                          const res = await fetch('/api/test-notification', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${session.access_token}` }
                          });
                          const data = await res.json();
                          if (res.ok && data.success) {
                            alert('Test sent successfully! Check your Telegram.');
                          } else {
                            alert(`Failed to send test. Telegram Error: ${data.error || 'Unknown error'}`);
                          }
                        } catch (e: any) {
                          alert(`Error sending test message: ${e.message}`);
                        }
                      }}
                      className="bg-white text-black border border-stone-300 px-6 py-2 rounded-xl font-medium hover:bg-stone-50 w-full sm:w-auto"
                    >
                      Test Connection
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
