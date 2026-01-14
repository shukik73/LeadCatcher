
export default function AuthError() {
    return (
        <div className="flex h-screen items-center justify-center">
            <div className="text-center">
                <h1 className="text-2xl font-bold mb-2">Authentication Error</h1>
                <p className="text-slate-500">Could not log you in. The link might have expired.</p>
                <a href="/login" className="text-blue-600 hover:underline mt-4 block">Back to Login</a>
            </div>
        </div>
    )
}
