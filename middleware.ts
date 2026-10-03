import publicAssets from './public-assets.json' with { type: 'json' };

// Runs before Vercel's static-file lookup, without changing vercel.json.
// Keep data/templates in the function bundles; never serve them as raw files.
export const config = {
    matcher: '/:path*',
    runtime: 'nodejs',
};

const publicPaths = new Set([
    '/',
    ...publicAssets.staticFiles.map(file => '/' + file),
    ...publicAssets.pageRoutes,
]);

export default function middleware(request: Request) {
    let path: string;
    try {
        const decoded = decodeURIComponent(new URL(request.url).pathname);
        // Reject ambiguous double encoding instead of allowing a later layer
        // to decode a different path. Public filenames contain no percent signs.
        if (decoded.includes('%')) throw new Error('Ambiguous path');
        path = new URL('https://internal.invalid' + decoded.replace(/\\/g, '/'))
            .pathname.replace(/\/+$/, '') || '/';
    } catch {
        return new Response('Not found', { status: 404 });
    }

    // Existing API handlers retain all authentication/publication filtering.
    // An undefined response lets Vercel continue to its existing routes.
    if (publicPaths.has(path) || path.startsWith('/api/')) return;

    return new Response('Not found', {
        status: 404,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}