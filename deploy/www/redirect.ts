// Written with AI assistance (Claude Code). See README "Use of AI tools".
// www.playescapevelocity.com: one address for everyone, so www sends visitors to the main domain
// (same path and query). A tiny Worker of its own (deploy/www/wrangler.jsonc); it never changes, so it
// is deployed by hand: npx wrangler deploy -c deploy/www/wrangler.jsonc

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.hostname = 'playescapevelocity.com';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
};
