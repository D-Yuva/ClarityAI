import React, { useState } from 'react';
import { supabaseClient } from '../lib/supabase';
import { Sparkles } from 'lucide-react';

export default function Auth({ onLogin }: { onLogin: () => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            let { error: authError } = isRegistering
                ? await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: 'https://ai-glimpse.up.railway.app/'
                    }
                })
                : await supabaseClient.auth.signInWithPassword({ email, password });

            if (authError) throw authError;

            // Ensure user_settings exists on register
            if (isRegistering) {
                // Wait for session to be established
                const { data: { session } } = await supabaseClient.auth.getSession();
                if (session) {
                    await supabaseClient.from('user_settings').insert({ user_id: session.user.id });
                }
                alert("Registration successful! Check your email to verify (if enabled) or log in.");
            } else {
                onLogin();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6 w-full">
            <div className="w-full max-w-md bg-white p-10 md:p-12 rounded-3xl shadow-sm border border-stone-200">
                <div className="flex flex-col items-center gap-3 mb-10">
                    <div className="w-14 h-14 bg-red-600 rounded-xl flex items-center justify-center text-white font-bold text-2xl shadow-sm">GA</div>
                    <h1 className="text-3xl font-bold tracking-tight text-stone-900">GlimpseAI</h1>
                    <p className="text-stone-500 text-center mt-1">
                        {isRegistering ? 'Create an account to save your feeds & AI settings.' : 'Welcome back! Sign in to view your feed.'}
                    </p>
                </div>

                {error && <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-700 rounded-xl text-sm font-medium">{error}</div>}

                <form onSubmit={handleAuth} className="space-y-5">
                    <div>
                        <label className="block text-sm font-bold text-stone-700 mb-2">Email address</label>
                        <input
                            type="email"
                            required
                            placeholder="you@example.com"
                            className="w-full px-5 py-3 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-stone-700 mb-2">Password</label>
                        <input
                            type="password"
                            required
                            placeholder="••••••••"
                            minLength={6}
                            className="w-full px-5 py-3 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-stone-900 text-white px-4 py-3.5 flex items-center justify-center rounded-xl font-bold hover:bg-black transition-colors disabled:opacity-50 mt-2"
                    >
                        {loading ? <Sparkles className="animate-spin" size={20} /> : (isRegistering ? 'Create Account' : 'Sign In')}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-stone-100 text-center">
                    <p className="text-sm text-stone-500">
                        {isRegistering ? 'Already have an account?' : "Don't have an account yet?"}
                        <button
                            onClick={() => {
                                setIsRegistering(!isRegistering);
                                setError(null);
                            }}
                            className="ml-2 font-bold text-stone-900 hover:text-red-600 transition-colors"
                        >
                            {isRegistering ? 'Sign In' : 'Sign Up'}
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}
