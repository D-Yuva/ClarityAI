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
                ? await supabaseClient.auth.signUp({ email, password })
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
        <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-stone-200 max-w-sm w-full">
                <div className="flex items-center gap-2 mb-8 justify-center">
                    <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">TD</div>
                    <h1 className="text-2xl font-bold tracking-tight">TubeDigest</h1>
                </div>

                <h2 className="text-xl font-bold mb-6 text-center">
                    {isRegistering ? 'Create your account' : 'Sign in to continue'}
                </h2>

                {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

                <form onSubmit={handleAuth} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Email</label>
                        <input
                            type="email"
                            required
                            className="w-full px-4 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Password</label>
                        <input
                            type="password"
                            required
                            minLength={6}
                            className="w-full px-4 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-black text-white px-4 py-3 flex items-center justify-center rounded-xl font-medium hover:bg-stone-800 disabled:opacity-50"
                    >
                        {loading ? <Sparkles className="animate-spin" /> : (isRegistering ? 'Sign Up' : 'Sign In')}
                    </button>
                </form>

                <p className="mt-6 text-center text-sm text-stone-500">
                    {isRegistering ? 'Already have an account?' : 'New here?'}
                    <button
                        onClick={() => setIsRegistering(!isRegistering)}
                        className="ml-2 font-medium text-black hover:underline"
                    >
                        {isRegistering ? 'Sign in' : 'Create an account'}
                    </button>
                </p>
            </div>
        </div>
    );
}
